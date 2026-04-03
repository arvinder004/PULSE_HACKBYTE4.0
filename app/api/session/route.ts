import { NextRequest, NextResponse } from 'next/server';
import { generateSessionId } from '@/lib/session';
import { verifyToken } from '@/lib/jwt';
import { connectDB } from '@/lib/db';
import SessionModel from '@/lib/models/Session';

async function getUser(req: NextRequest) {
  const token = req.cookies.get('pulse_token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.speakerName || !body?.topic) {
    return NextResponse.json({ error: 'speakerName and topic are required' }, { status: 400 });
  }

  await connectDB();

  const sessionId = generateSessionId();
  const session = await SessionModel.create({
    sessionId,
    speakerId: user.userId,
    speakerName: body.speakerName,
    topic: body.topic,
  });

  return NextResponse.json({
    sessionId: session.sessionId,
    speakerName: session.speakerName,
    topic: session.topic,
    createdAt: session.createdAt,
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

  await connectDB();

  const session = await SessionModel.findOne({ sessionId });
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  return NextResponse.json({
    sessionId: session.sessionId,
    speakerName: session.speakerName,
    topic: session.topic,
    active: session.active,
    createdAt: session.createdAt,
  });
}
