import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';
import SegmentSummary from '@/lib/models/SegmentSummary';
import { summarizeSegment } from '@/lib/gemini';

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

  if (transcript.length < 40) {
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
    { upsert: true, new: true }
  );

  console.log('[PULSE][Phase4][Summary] saved', {
    sessionId,
    summaryId: doc?._id?.toString?.(),
    words: wordCount,
  });

  return NextResponse.json({
    ok: true,
    summaryId: doc?._id?.toString?.(),
    summary: summary.summary,
    improvement: summary.improvement,
    focusTags: summary.focusTags,
    wordCount,
  });
}
