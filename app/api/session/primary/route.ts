import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';

// GET — return the current primary audienceId for a session
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

  await connectDB();
  const session = await Session.findOne({ sessionId }).lean();
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  return NextResponse.json({ primaryAudienceId: (session as any).primaryAudienceId ?? null });
}

// POST — set the primary audienceId for a session
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { sessionId?: string; audienceId?: string } | null;
  if (!body?.sessionId || !body?.audienceId) {
    return NextResponse.json({ error: 'sessionId and audienceId required' }, { status: 400 });
  }

  await connectDB();
  const session = await Session.findOneAndUpdate(
    { sessionId: body.sessionId },
    { $set: { primaryAudienceId: body.audienceId } },
    { new: true }
  ).lean();

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  console.log('[PULSE][Primary] set', { sessionId: body.sessionId, audienceId: body.audienceId });
  return NextResponse.json({ ok: true, primaryAudienceId: body.audienceId });
}
