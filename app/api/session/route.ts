import { NextRequest, NextResponse } from 'next/server';
import { generateSessionId } from '@/lib/session';

type Session = { sessionId: string; speakerName: string; topic: string; createdAt: number };

// Survive Next.js HMR hot reloads by attaching to globalThis
const g = globalThis as typeof globalThis & { __pulse_sessions?: Map<string, Session> };
if (!g.__pulse_sessions) g.__pulse_sessions = new Map();
const sessions = g.__pulse_sessions;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.speakerName !== 'string' || typeof body.topic !== 'string') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const sessionId = generateSessionId();
  const createdAt = Date.now();

  // TODO: replace with SpacetimeDB reducer call (create_session) in later phase
  sessions.set(sessionId, {
    sessionId,
    speakerName: body.speakerName,
    topic: body.topic,
    createdAt,
  });

  return NextResponse.json({
    sessionId,
    speakerName: body.speakerName,
    topic: body.topic,
    createdAt,
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json(session);
}
