import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Transcript from '@/lib/models/Transcript';

function isValidSessionId(id: string) {
  return /^[a-z0-9]{12}$/.test(id);
}

// POST — append a chunk and rebuild fullText
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    sessionId?: string;
    text?: string;
    ts?: number;
  } | null;

  if (!body?.sessionId || !body?.text?.trim()) {
    return NextResponse.json({ error: 'sessionId and text are required' }, { status: 400 });
  }
  if (!isValidSessionId(body.sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  await connectDB();

  const chunk = { text: body.text.trim(), ts: body.ts ?? Date.now() };

  // Upsert: push chunk, rebuild fullText + wordCount
  const doc = await Transcript.findOneAndUpdate(
    { sessionId: body.sessionId },
    {
      $push: { chunks: chunk },
      $set:  { updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true }
  );

  // Rebuild fullText from all chunks (keep it fresh)
  const fullText = doc.chunks.map((c: any) => c.text).join(' ');
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;
  doc.fullText  = fullText;
  doc.wordCount = wordCount;
  await doc.save();

  console.log('[PULSE][R1][Transcript] flush', { sessionId: body.sessionId, wordCount });
  return NextResponse.json({ ok: true, wordCount, updatedAt: doc.updatedAt });
}

// GET — return fullText + metadata for a session
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  if (!isValidSessionId(sessionId)) return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });

  await connectDB();

  const doc = await Transcript.findOne({ sessionId }).lean();
  if (!doc) return NextResponse.json({ fullText: '', wordCount: 0, updatedAt: null, chunks: [] });

  return NextResponse.json({
    fullText:  doc.fullText,
    wordCount: doc.wordCount,
    updatedAt: doc.updatedAt,
    chunks:    doc.chunks,
  });
}
