import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';
import Suggestion from '@/lib/models/Suggestion';
import { runSuggester } from '@/lib/agents/runner';
import { buildSuggesterPrompt } from '@/lib/agents/suggester';

function isValidSessionId(id: string) {
  return /^[a-z0-9]{12}$/.test(id);
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

// POST — run the Suggester agent and persist the result
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const sessionId = body?.sessionId?.trim?.();

  if (!sessionId || !isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  await connectDB();

  const session = await Session.findOne({ sessionId }).lean() as any;
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!session.active) return NextResponse.json({ error: 'Session ended' }, { status: 409 });

  const transcript: string = (body?.transcript || '').slice(0, 6000);
  const signals: Record<string, number> = body?.signals ?? {};

  // Fetch previous suggestions for escalation context
  const previous = await Suggestion.find({ sessionId })
    .sort({ createdAt: -1 }).limit(20).lean();

  // Fetch classified questions for coverage tracking
  const questions = (session.questions ?? [])
    .filter((q: any) => !q.dismissed)
    .map((q: any) => ({
      id:       q.id,
      text:     q.text,
      upvotes:  q.upvotes ?? 0,
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
    return NextResponse.json({ ok: true, skipped: true });
  }

  // If escalating an existing suggestion, update it in DB
  if (result.escalated && previous.length > 0) {
    const prev = previous.find((s: any) => s.category === result.category && !s.dismissed);
    if (prev) {
      await Suggestion.updateOne(
        { _id: (prev as any)._id },
        {
          $set: { urgency: 'urgent' },
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
    triggerTranscript: transcript.slice(0, 400),
    history: [{ urgency: result.urgency, reason: result.escalated ? result.escalation_reason : 'initial', ts: new Date() }],
  });

  const payload = {
    type:      'suggestion',
    id:        doc._id.toString(),
    message:   doc.message,
    detail:    doc.detail,
    urgency:   doc.urgency,
    category:  doc.category,
    escalated: result.escalated,
    createdAt: doc.createdAt.toISOString(),
  };

  broadcastSuggestion(sessionId, payload);

  console.log('[ArmorIQ][Suggester] suggestion created', {
    sessionId,
    urgency:   doc.urgency,
    category:  doc.category,
    escalated: result.escalated,
  });

  return NextResponse.json({ ok: true, suggestion: payload });
}

// GET — fetch all suggestions for a session
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId || !isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  await connectDB();
  const suggestions = await Suggestion.find({ sessionId }).sort({ createdAt: 1 }).lean();
  return NextResponse.json({ suggestions });
}

// PATCH — dismiss a suggestion
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { sessionId, suggestionId } = body ?? {};

  if (!sessionId || !suggestionId) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  await connectDB();
  await Suggestion.updateOne(
    { _id: suggestionId, sessionId },
    { $set: { dismissed: true, dismissedAt: new Date() } }
  );

  broadcastSuggestion(sessionId, { type: 'suggestion_dismiss', suggestionId });
  return NextResponse.json({ ok: true });
}
