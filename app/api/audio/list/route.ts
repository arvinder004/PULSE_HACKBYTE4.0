import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) return NextResponse.json({ items: [] });

  const files = await db.collection('audio.files')
    .find({ 'metadata.sessionId': sessionId })
    .sort({ uploadDate: -1 })
    .limit(10)
    .toArray();

  const items = files.map(f => ({
    id: f._id?.toString?.() ?? String(f._id),
    filename: f.filename,
    length: f.length,
    uploadDate: f.uploadDate,
    ts: f.metadata?.ts ?? null,
  }));

  return NextResponse.json({ items });
}
