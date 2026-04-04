import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import SegmentSummary from '@/lib/models/SegmentSummary';

function isValidSessionId(id: string) {
  return /^[a-z0-9]{12}$/.test(id);
}

// GET — assemble fullText from all transcribed chunks in order
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  if (!isValidSessionId(sessionId)) return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });

  await connectDB();

  const segments = await SegmentSummary.find({ sessionId })
    .sort({ windowStart: 1 })
    .lean();

  const fullText  = segments.map(s => s.transcript || '').join(' ').trim();
  const wordCount = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0;
  const lastSeg = segments[segments.length - 1];
  const updatedAt = lastSeg?.windowEnd
    ? new Date(lastSeg.windowEnd)
    : (lastSeg?.createdAt ?? null);

  return NextResponse.json({
    fullText,
    wordCount,
    updatedAt,
    totalChunks: segments.length,
    transcribedChunks: segments.length,
    pendingChunks: 0,
    chunks: segments.map((s, idx) => ({
      chunkIndex: idx,
      startTs:    s.windowStart,
      endTs:      s.windowEnd,
      status:     'summary',
      wordCount:  s.wordCount,
      text:       s.transcript || '',
      preview:    s.transcript?.slice(0, 60),
    })),
  });
}
