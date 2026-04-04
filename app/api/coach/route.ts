import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';
import SegmentSummary from '@/lib/models/SegmentSummary';
import CoachReport from '@/lib/models/CoachReport';
import { compileCoachReport } from '@/lib/gemini';

function isValidSessionId(id: string) {
  return /^[a-z0-9]{12}$/.test(id);
}

// GET — return existing coach report if already compiled
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId || !isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  await connectDB();

  const report = await CoachReport.findOne({ sessionId }).lean();
  if (!report) return NextResponse.json({ exists: false }, { status: 404 });

  console.log('[PULSE][Coach] GET existing report', { sessionId, segments: report.segments?.length });
  return NextResponse.json({ exists: true, report });
}

// POST — compile mini-batch summaries into a final coach report, then delete batches
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const sessionId = body?.sessionId?.trim?.();

  if (!sessionId || !isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  console.log('[PULSE][Coach] POST compile request', { sessionId });

  await connectDB();

  // Return cached report if already compiled
  const existing = await CoachReport.findOne({ sessionId }).lean();
  if (existing) {
    console.log('[PULSE][Coach] returning cached report', { sessionId });
    return NextResponse.json({ ok: true, cached: true, report: existing });
  }

  const session = await Session.findOne({ sessionId }).lean();
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const segments = await SegmentSummary.find({ sessionId })
    .sort({ windowStart: 1 })
    .lean();

  console.log('[PULSE][Coach] found mini-batch segments', { sessionId, count: segments.length });

  if (segments.length === 0) {
    return NextResponse.json({ error: 'No segments found — session may be too short' }, { status: 422 });
  }

  const sessionStartMs = segments[0].windowStart;

  const batches = segments.map(s => ({
    windowStart: s.windowStart,
    windowEnd:   s.windowEnd,
    transcript:  s.transcript || '',
    summary:     s.summary || '',
    improvement: s.improvement || '',
    focusTags:   s.focusTags || [],
    signals:     {} as Record<string, number>,
  }));

  console.log('[PULSE][Coach] calling Gemini compileCoachReport', { sessionId, batchCount: batches.length });

  const compiled = await compileCoachReport({
    sessionId,
    speakerName: session.speakerName,
    topic: session.topic,
    sessionStartMs,
    batches,
  });

  console.log('[PULSE][Coach] Gemini compile done', {
    sessionId,
    segments: compiled.segments.length,
    overallLen: compiled.overallSummary.length,
  });

  // Save final report
  const report = await CoachReport.findOneAndUpdate(
    { sessionId },
    {
      $set: {
        speakerName:     session.speakerName,
        topic:           session.topic,
        segments:        compiled.segments,
        overallSummary:  compiled.overallSummary,
        topStrengths:    compiled.topStrengths,
        topImprovements: compiled.topImprovements,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' }
  );

  console.log('[PULSE][Coach] saved report', { sessionId, reportId: report._id?.toString() });

  return NextResponse.json({ ok: true, cached: false, report });
}
