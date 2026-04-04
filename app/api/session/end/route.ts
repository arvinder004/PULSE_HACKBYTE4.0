import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { sessionId?: string; reactivate?: boolean } | null;
  if (!body?.sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

  await connectDB();

  if (body.reactivate) {
    const res = await Session.findOneAndUpdate(
      { sessionId: body.sessionId },
      { $set: { active: true }, $unset: { endedAt: '' } },
      { returnDocument: 'after' }
    ).lean();
    if (!res) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    console.log('[PULSE][Session] reactivated', { sessionId: body.sessionId });
    return NextResponse.json({ ok: true });
  }

  const res = await Session.findOneAndUpdate(
    { sessionId: body.sessionId },
    { $set: { active: false, endedAt: new Date() } },
    { returnDocument: 'after' }
  ).lean();

  if (!res) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  console.log('[PULSE][Phase3][Session] ended', { sessionId: body.sessionId });

  return NextResponse.json({ ok: true });
}
