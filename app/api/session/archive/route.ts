import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';
import SegmentSummary from '@/lib/models/SegmentSummary';
import CoachReport from '@/lib/models/CoachReport';
import Suggestion from '@/lib/models/Suggestion';

/**
 * GET /api/session/archive?sessionId=X
 * Returns persisted signals, questions, segment activity, and coach report from MongoDB.
 * Used by the producer view after a session has ended.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

  await connectDB();
  const [session, segments, coachReport, suggestions] = await Promise.all([
    Session.findOne({ sessionId }).lean() as any,
    SegmentSummary.find({ sessionId }).sort({ windowStart: 1 }).lean(),
    CoachReport.findOne({ sessionId }).lean() as any,
    Suggestion.find({ sessionId }).sort({ createdAt: 1 }).lean(),
  ]);

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Build signal counts from archived signals
  const signalCounts: Record<string, number> = {};
  for (const s of session.signals ?? []) {
    signalCounts[s.type] = (signalCounts[s.type] ?? 0) + 1;
  }

  // Derive mood label from signal balance
  const confused = signalCounts['confused'] ?? 0;
  const clear    = signalCounts['clear']    ?? 0;
  const excited  = signalCounts['excited']  ?? 0;
  const slowDown = signalCounts['slow_down'] ?? 0;
  const total    = confused + clear + excited + slowDown;
  let mood = 'Neutral';
  if (total > 0) {
    const positiveRatio = (clear + excited) / total;
    const confusedRatio = confused / total;
    if (confusedRatio > 0.4)      mood = 'Confused';
    else if (positiveRatio > 0.6) mood = excited > clear ? 'Energised' : 'Clear';
    else if (slowDown > excited)  mood = 'Needs pacing';
    else                          mood = 'Engaged';
  }

  // Build engagement timeline from segment word counts (proxy for activity)
  const engagementBars = segments.map(s => ({
    windowStart: s.windowStart,
    windowEnd:   s.windowEnd,
    wordCount:   s.wordCount ?? 0,
    focusTags:   s.focusTags ?? [],
  }));

  return NextResponse.json({
    active:         session.active,
    signalCounts,
    signals:        session.signals ?? [],
    questions:      (session.questions ?? []).filter((q: any) => !q.dismissed),
    mood,
    engagementBars,
    coachReport: coachReport ? {
      overallSummary:  coachReport.overallSummary,
      topStrengths:    coachReport.topStrengths,
      topImprovements: coachReport.topImprovements,
      segments:        coachReport.segments,
    } : null,
    suggestions: suggestions.map((s: any) => ({
      id:        s._id.toString(),
      message:   s.message,
      detail:    s.detail,
      urgency:   s.urgency,
      category:  s.category,
      escalated: s.history?.length > 1,
      dismissed: s.dismissed,
      createdAt: s.createdAt,
    })),
  });
}
