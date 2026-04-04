import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import TranscriptChunk from '@/lib/models/TranscriptChunk';

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

  const chunks = await TranscriptChunk.find({ sessionId })
    .sort({ chunkIndex: 1 })
    .lean();

  const transcribed = chunks.filter(c => c.status === 'transcribed' && c.text);
  const fullText    = transcribed.map(c => c.text).join(' ').trim();
  const wordCount   = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0;
  const updatedAt   = chunks.length ? chunks[chunks.length - 1].createdAt : null;

  return NextResponse.json({
    fullText,
    wordCount,
    updatedAt,
    totalChunks:      chunks.length,
    transcribedChunks: transcribed.length,
    pendingChunks:    chunks.filter(c => c.status === 'pending').length,
    chunks: chunks.map(c => ({
      chunkIndex: c.chunkIndex,
      startTs:    c.startTs,
      endTs:      c.endTs,
      status:     c.status,
      wordCount:  c.wordCount,
      preview:    c.text?.slice(0, 60),
    })),
  });
}
