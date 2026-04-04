import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';

type Question = {
  id: string;
  sessionId: string;
  text: string;
  audienceId: string;
  upvotes: number;
  ts: number;
  isPrimary: boolean;
};

const g = globalThis as typeof globalThis & {
  __pulse_questions?: Map<string, Question>;
  __pulse_primary?: Map<string, string>;
};
if (!g.__pulse_questions) g.__pulse_questions = new Map();
if (!g.__pulse_primary)   g.__pulse_primary   = new Map();

const questions  = g.__pulse_questions;
const primaryMap = g.__pulse_primary;
const cooldowns  = new Map<string, number>();

async function getPrimaryAudienceId(sessionId: string): Promise<string | null> {
  if (primaryMap.has(sessionId)) return primaryMap.get(sessionId)!;
  try {
    await connectDB();
    const session = await Session.findOne({ sessionId }).lean() as any;
    const id = session?.primaryAudienceId ?? null;
    if (id) primaryMap.set(sessionId, id);
    return id;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.sessionId || !body?.text || !body?.audienceId) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { sessionId, text, audienceId } = body as { sessionId: string; text: string; audienceId: string };

  if (text.trim().length === 0 || text.length > 200) {
    return NextResponse.json({ error: 'Question must be 1–200 characters' }, { status: 422 });
  }

  const cooldownKey = `${sessionId}:${audienceId}`;
  const lastAt = cooldowns.get(cooldownKey) ?? 0;
  if (Date.now() - lastAt < 30_000) {
    return NextResponse.json({ error: 'Please wait before submitting another question' }, { status: 429 });
  }

  const primaryId = await getPrimaryAudienceId(sessionId);
  const isPrimary = !primaryId || audienceId === primaryId;

  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  questions.set(id, { id, sessionId, text: text.trim(), audienceId, upvotes: 0, ts: Date.now(), isPrimary });
  cooldowns.set(cooldownKey, Date.now());

  return NextResponse.json({ ok: true, id, isPrimary });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId   = searchParams.get('sessionId');
  // ?primaryOnly=1 returns only the primary user's questions
  const primaryOnly = searchParams.get('primaryOnly') === '1';

  let result = [...questions.values()]
    .filter(q => !sessionId || q.sessionId === sessionId);

  if (primaryOnly) {
    result = result.filter(q => q.isPrimary);
  }

  return NextResponse.json(
    result.sort((a, b) => b.upvotes - a.upvotes || a.ts - b.ts)
  );
}

// PATCH — upvote a question by id
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { id, audienceId } = body ?? {};
  if (!id || !audienceId) {
    return NextResponse.json({ error: 'Provide id and audienceId' }, { status: 400 });
  }
  const q = questions.get(id);
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Prevent self-upvote
  if (q.audienceId === audienceId) {
    return NextResponse.json({ error: 'Cannot upvote your own question' }, { status: 403 });
  }

  q.upvotes += 1;
  questions.set(id, q);
  return NextResponse.json({ ok: true, upvotes: q.upvotes });
}

// DELETE — remove a single question by id, or all questions for a session
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id        = searchParams.get('id');
  const sessionId = searchParams.get('sessionId');

  if (id) {
    questions.delete(id);
    return NextResponse.json({ ok: true, deleted: id });
  }

  if (sessionId) {
    let count = 0;
    for (const [key, q] of questions.entries()) {
      if (q.sessionId === sessionId) { questions.delete(key); count++; }
    }
    return NextResponse.json({ ok: true, cleared: count });
  }

  return NextResponse.json({ error: 'Provide id or sessionId' }, { status: 400 });
}
