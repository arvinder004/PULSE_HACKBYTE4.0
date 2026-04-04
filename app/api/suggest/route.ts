import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';
import Suggestion from '@/lib/models/Suggestion';
import { runSuggester } from '@/lib/agents/runner';
import { buildSuggesterPrompt } from '@/lib/agents/suggester';

// ── Constants ─────────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === 'production';

// Rate limiting: max requests per session per window
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000; // 1 minute

// Max request body size (1 MB)
const MAX_BODY_BYTES = 1_024 * 1_024;

// Max transcript length accepted
const MAX_TRANSCRIPT_CHARS = 6_000;

// ── In-memory rate limit store ────────────────────────────────────────────────
const g = globalThis as typeof globalThis & {
  __suggest_rl?: Map<string, { count: number; windowStart: number }>;
};
if (!g.__suggest_rl) g.__suggest_rl = new Map();
const rlStore = g.__suggest_rl;

function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rlStore.get(key);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rlStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT - 1, resetAt: now + RATE_WINDOW_MS };
  }

  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0, resetAt: entry.windowStart + RATE_WINDOW_MS };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT - entry.count, resetAt: entry.windowStart + RATE_WINDOW_MS };
}

function rateLimitHeaders(remaining: number, resetAt: number) {
  return {
    'X-RateLimit-Limit':     String(RATE_LIMIT),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset':     String(Math.ceil(resetAt / 1000)),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidSessionId(id: string) {
  return /^[a-z0-9]{12}$/.test(id);
}

function isValidSignals(s: unknown): s is Record<string, number> {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  return Object.values(s as object).every(v => typeof v === 'number' && isFinite(v) && v >= 0);
}

/** Strip PII and internal fields before returning to client */
function sanitizeSuggestion(doc: any) {
  return {
    id:        doc._id?.toString?.() ?? doc.id,
    message:   doc.message,
    detail:    doc.detail,
    urgency:   doc.urgency,
    category:  doc.category,
    escalated: (doc.history?.length ?? 0) > 1,
    createdAt: doc.createdAt instanceof Date
      ? doc.createdAt.toISOString()
      : new Date(doc.createdAt).toISOString(),
    // triggerTranscript, sessionId, history — intentionally omitted
  };
}

function broadcastSuggestion(sessionId: string, payload: object) {
  const g = globalThis as any;
  const sseClients: Map<string, Set<ReadableStreamDefaultController>> = g.__pulse_sse_clients;
  if (!sseClients) return;
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const ctrl of clients) {
    try { ctrl.enqueue(msg); } catch { clients.delete(ctrl); }
  }
}

// ── POST — run the Suggester agent ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // 1. Enforce request size limit
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const body = await req.json().catch(() => null);
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : null;

  if (!sessionId || !isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  // 2. Rate limit per session
  const rl = checkRateLimit(`post:${sessionId}`);
  const rlHeaders = rateLimitHeaders(rl.remaining, rl.resetAt);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...rlHeaders, 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  // 3. Validate and sanitize inputs
  const rawTranscript = typeof body?.transcript === 'string' ? body.transcript : '';
  const transcript = rawTranscript.slice(0, MAX_TRANSCRIPT_CHARS);

  const rawSignals = body?.signals;
  const signals: Record<string, number> = isValidSignals(rawSignals) ? rawSignals : {};

  await connectDB();

  const session = await Session.findOne({ sessionId }).lean() as any;
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 }, );
  if (!session.active) return NextResponse.json({ error: 'Session ended' }, { status: 409 });

  // Fetch previous suggestions for escalation context
  const previous = await Suggestion.find({ sessionId })
    .sort({ createdAt: -1 }).limit(20).lean();

  // Fetch classified questions — only safe fields
  const questions = (session.questions ?? [])
    .filter((q: any) => !q.dismissed)
    .map((q: any) => ({
      id:       String(q.id ?? ''),
      text:     String(q.text ?? '').slice(0, 200),
      upvotes:  Number(q.upvotes ?? 0),
      category: q.category ?? undefined,
    }));

  const userMessage = buildSuggesterPrompt({
    sessionId,
    speakerName: session.speakerName,
    topic:       session.topic,
    transcript,
    signals,
    questions,
    previousSuggestions: previous.map((s: any) => ({
      urgency:   s.urgency,
      category:  s.category,
      message:   s.message,
      detail:    s.detail,
      dismissed: s.dismissed,
      createdAt: new Date(s.createdAt).toISOString(),
    })),
  });

  const result = await runSuggester(userMessage);

  if (result.skip) {
    return NextResponse.json({ ok: true, skipped: true }, { headers: rlHeaders });
  }

  // Escalate existing suggestion if needed
  if (result.escalated && previous.length > 0) {
    const prev = previous.find((s: any) => s.category === result.category && !s.dismissed);
    if (prev) {
      await Suggestion.updateOne(
        { _id: (prev as any)._id },
        {
          $set:  { urgency: 'urgent' },
          $push: { history: { urgency: 'urgent', reason: result.escalation_reason, ts: new Date() } },
        }
      );
      broadcastSuggestion(sessionId, {
        type:         'suggestion_escalate',
        suggestionId: (prev as any)._id.toString(),
        urgency:      'urgent',
        reason:       result.escalation_reason,
      });
    }
  }

  // Persist new suggestion
  const doc = await Suggestion.create({
    sessionId,
    message:           result.message,
    detail:            result.detail,
    urgency:           result.urgency,
    category:          result.category,
    triggerTranscript: transcript.slice(0, 400), // stored but never returned
    history: [{ urgency: result.urgency, reason: result.escalated ? result.escalation_reason : 'initial', ts: new Date() }],
  });

  const safe = sanitizeSuggestion(doc);
  const payload = { type: 'suggestion', ...safe };

  broadcastSuggestion(sessionId, payload);

  if (!IS_PROD) {
    console.log('[ArmorIQ][Suggester] suggestion created', {
      sessionId,
      urgency:  doc.urgency,
      category: doc.category,
    });
  }

  return NextResponse.json({ ok: true, suggestion: safe }, { headers: rlHeaders });
}

// ── GET — fetch all suggestions for a session ─────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId || !isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  const rl = checkRateLimit(`get:${sessionId}`);
  const rlHeaders = rateLimitHeaders(rl.remaining, rl.resetAt);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rlHeaders });
  }

  await connectDB();
  const suggestions = await Suggestion.find({ sessionId }).sort({ createdAt: 1 }).lean();

  return NextResponse.json(
    { suggestions: suggestions.map(sanitizeSuggestion) },
    { headers: rlHeaders }
  );
}

// ── PATCH — dismiss a suggestion ──────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const body = await req.json().catch(() => null);
  const sessionId    = typeof body?.sessionId    === 'string' ? body.sessionId.trim()    : null;
  const suggestionId = typeof body?.suggestionId === 'string' ? body.suggestionId.trim() : null;

  if (!sessionId || !isValidSessionId(sessionId) || !suggestionId) {
    return NextResponse.json({ error: 'Missing or invalid params' }, { status: 400 });
  }

  const rl = checkRateLimit(`patch:${sessionId}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  await connectDB();
  await Suggestion.updateOne(
    { _id: suggestionId, sessionId },
    { $set: { dismissed: true, dismissedAt: new Date() } }
  );

  broadcastSuggestion(sessionId, { type: 'suggestion_dismiss', suggestionId });
  return NextResponse.json({ ok: true });
}
