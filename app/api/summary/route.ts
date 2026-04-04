import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';
import SegmentSummary from '@/lib/models/SegmentSummary';
import Suggestion from '@/lib/models/Suggestion';
import { summarizeSegment } from '@/lib/gemini';
import { runSuggester } from '@/lib/agents/runner';
import { buildSuggesterPrompt } from '@/lib/agents/suggester';

type Body = {
  sessionId?: string;
  transcript?: string;
  windowStart?: number;
  windowEnd?: number;
  signals?: Record<string, number> | any;
};

function normalizeSignalCounts(input: any): Record<string, number> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
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

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Body | null;
  const sessionId = body?.sessionId?.trim();
  const transcript = String(body?.transcript || '').trim();

  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  if (!transcript) return NextResponse.json({ error: 'Missing transcript' }, { status: 400 });

  const windowStart = Number(body?.windowStart ?? Date.now() - 60_000);
  const windowEnd = Number(body?.windowEnd ?? Date.now());

  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) {
    return NextResponse.json({ error: 'Invalid window' }, { status: 400 });
  }

  console.log('[PULSE][Phase4][Summary] request', {
    sessionId,
    transcriptLen: transcript.length,
    windowStart,
    windowEnd,
  });

  if (transcript.length < 20) {
    return NextResponse.json({ error: 'Transcript too short' }, { status: 422 });
  }

  await connectDB();

  const session = await Session.findOne({ sessionId }).lean();
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const signals = normalizeSignalCounts(body?.signals);
  const summary = await summarizeSegment({
    sessionId,
    transcript,
    signals,
    speakerName: session.speakerName,
    topic: session.topic,
  });

  const wordCount = transcript.split(/\s+/).filter(Boolean).length;

  const doc = await SegmentSummary.findOneAndUpdate(
    { sessionId, windowStart },
    {
      $set: {
        windowEnd,
        transcript,
        summary: summary.summary,
        improvement: summary.improvement,
        focusTags: summary.focusTags,
        wordCount,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' }
  );

  console.log('[PULSE][Phase4][Summary] saved', {
    sessionId,
    summaryId: doc?._id?.toString?.(),
    words: wordCount,
  });

  // ── Trigger Suggester agent after every 60s summary ──────────────────────
  // Run async — don't block the summary response
  ;(async () => {
    try {
      // Fetch previous suggestions for escalation context
      const previous = await Suggestion.find({ sessionId })
        .sort({ createdAt: -1 }).limit(20).lean();

      // Fetch classified questions for coverage tracking
      const sessionDoc = await Session.findOne({ sessionId }).lean() as any;
      const questions = (sessionDoc?.questions ?? [])
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
      console.log('[PULSE][Suggester] result', { sessionId, skip: result.skip, urgency: result.urgency, category: result.category });

      if (!result.skip) {
        // Escalate existing if needed
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
              type: 'suggestion_escalate',
              suggestionId: (prev as any)._id.toString(),
              urgency: 'urgent',
              reason: result.escalation_reason,
            });
          }
        }

        const doc2 = await Suggestion.create({
          sessionId,
          message:           result.message,
          detail:            result.detail,
          urgency:           result.urgency,
          category:          result.category,
          triggerTranscript: transcript.slice(0, 400),
          history: [{ urgency: result.urgency, reason: result.escalated ? result.escalation_reason : 'initial', ts: new Date() }],
        });

        broadcastSuggestion(sessionId, {
          type:      'suggestion',
          id:        doc2._id.toString(),
          message:   doc2.message,
          detail:    doc2.detail,
          urgency:   doc2.urgency,
          category:  doc2.category,
          escalated: result.escalated,
          createdAt: doc2.createdAt.toISOString(),
        });

        console.log('[PULSE][Suggester] created', { sessionId, urgency: doc2.urgency, category: doc2.category });
      }
    } catch (e) {
      console.error('[PULSE][Suggester] post-summary error', String(e));
    }
  })();

  return NextResponse.json({
    ok: true,
    summaryId: doc?._id?.toString?.(),
    summary: summary.summary,
    improvement: summary.improvement,
    focusTags: summary.focusTags,
    wordCount,
  });
}
