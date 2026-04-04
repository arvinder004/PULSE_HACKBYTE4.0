import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';

type Signal = {
  sessionId: string;
  signalType: string;
  audienceId: string;
  fingerprint: string;
  weight: number;
  ts: number;
  isPrimary: boolean;
};

// ── In-memory stores ───────────────────────────────────────────────────────
const g = globalThis as typeof globalThis & {
  __pulse_signals?: Signal[];
  __pulse_sig_cooldowns?: Map<string, number>;
  __pulse_sse_clients?: Map<string, Set<ReadableStreamDefaultController>>;
  __pulse_primary?: Map<string, string>; // sessionId → primaryAudienceId
};
if (!g.__pulse_signals)       g.__pulse_signals      = [];
if (!g.__pulse_sig_cooldowns) g.__pulse_sig_cooldowns = new Map();
if (!g.__pulse_sse_clients)   g.__pulse_sse_clients  = new Map();
if (!g.__pulse_primary)       g.__pulse_primary      = new Map();

const signals    = g.__pulse_signals;
const cooldowns  = g.__pulse_sig_cooldowns;
const sseClients = g.__pulse_sse_clients;
const primaryMap = g.__pulse_primary;

const COOLDOWN_MS = 10_000;
const SIGNAL_TTL_MS = 45 * 1000; // signals expire after 45 seconds

function broadcast(sessionId: string, data: object) {
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const ctrl of clients) {
    try { ctrl.enqueue(msg); } catch { clients.delete(ctrl); }
  }
}

async function getPrimaryAudienceId(sessionId: string): Promise<string | null> {
  // Check in-memory cache first
  if (primaryMap.has(sessionId)) return primaryMap.get(sessionId)!;
  // Fall back to DB
  try {
    await connectDB();
    const session = await Session.findOne({ sessionId }).lean() as any;
    const id = session?.primaryAudienceId ?? null;
    if (id) primaryMap.set(sessionId, id);
    return id;
  } catch {
    return null;
  }
}

// ── POST — receive signal ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.sessionId || !body?.signalType || !body?.audienceId) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { sessionId, signalType, audienceId, fingerprint = audienceId } = body as {
    sessionId: string; signalType: string; audienceId: string; fingerprint?: string;
  };

  // Rate limit — per fingerprint per session
  const rlKey = `${sessionId}:${fingerprint}`;
  const lastAt = cooldowns.get(rlKey) ?? 0;
  if (Date.now() - lastAt < COOLDOWN_MS) {
    return NextResponse.json({
      error: 'Too many signals',
      retryAfter: Math.ceil((lastAt + COOLDOWN_MS - Date.now()) / 1000),
    }, { status: 429 });
  }
  cooldowns.set(rlKey, Date.now());

  const primaryId = await getPrimaryAudienceId(sessionId);
  const isPrimary = !primaryId || audienceId === primaryId;

  const signal: Signal = { sessionId, signalType, audienceId, fingerprint, weight: 1.0, ts: Date.now(), isPrimary };
  signals.push(signal);

  broadcast(sessionId, { type: 'signal', signal });

  // Persist to MongoDB asynchronously (don't block response)
  const signalId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  connectDB().then(() =>
    Session.updateOne(
      { sessionId },
      { $push: { signals: { id: signalId, type: signalType, audienceId, fingerprint, weight: 1.0, createdAt: new Date() } } }
    )
  ).catch(err => console.error('[PULSE][Signals] MongoDB persist failed', err));

  // After 45s, broadcast a refreshed snapshot so all clients drop this signal
  setTimeout(() => {
    const counts = buildPrimaryCounts(sessionId);
    broadcast(sessionId, { type: 'snapshot', counts });
  }, 45_000);

  return NextResponse.json({ ok: true, isPrimary });
}

// ── GET — SSE stream or snapshot ──────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  const sse       = searchParams.get('sse') === '1';

  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

  // Snapshot mode — returns raw signals for client-side TTL filtering
  if (!sse) {
    const result = signals.filter(s => s.sessionId === sessionId);
    return NextResponse.json(result);
  }

  // SSE mode
  if (!sseClients.has(sessionId)) sseClients.set(sessionId, new Set());
  const clients = sseClients.get(sessionId)!;

  const stream = new ReadableStream({
    start(ctrl) {
      clients.add(ctrl);
      // Send current primary-only counts (within TTL) immediately on connect
      const counts = buildPrimaryCounts(sessionId);
      ctrl.enqueue(`data: ${JSON.stringify({ type: 'snapshot', counts })}\n\n`);
    },
    cancel(ctrl) {
      clients.delete(ctrl as unknown as ReadableStreamDefaultController);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// Only count signals from the primary user (or all if no primary set)
// Signals older than SIGNAL_TTL_MS are excluded
function buildPrimaryCounts(sessionId: string) {
  const primaryId = primaryMap.get(sessionId) ?? null;
  const cutoff    = Date.now() - SIGNAL_TTL_MS;
  const counts: Record<string, number> = {};
  for (const s of signals.filter(sig => sig.sessionId === sessionId && sig.ts >= cutoff)) {
    if (primaryId && !s.isPrimary) continue;
    counts[s.signalType] = (counts[s.signalType] ?? 0) + 1;
  }
  return counts;
}

// ── DELETE — clear all signals for a session ──────────────────────────────
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

  const before = signals.length;
  // Remove all signals for this session in-place
  const toRemove = signals.filter(s => s.sessionId === sessionId);
  toRemove.forEach(s => signals.splice(signals.indexOf(s), 1));

  // Broadcast cleared counts to all SSE listeners
  broadcast(sessionId, { type: 'snapshot', counts: {} });

  console.log('[PULSE][Signals] cleared', before - signals.length, 'signals for', sessionId);
  return NextResponse.json({ ok: true, cleared: before - signals.length });
}
