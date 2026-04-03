import { NextRequest, NextResponse } from 'next/server';

type Question = { id: string; sessionId: string; text: string; audienceId: string; upvotes: number; ts: number };

const g = globalThis as typeof globalThis & { __pulse_questions?: Map<string, Question> };
if (!g.__pulse_questions) g.__pulse_questions = new Map();
const questions = g.__pulse_questions;

// 30s per-user cooldown
const cooldowns = new Map<string, number>();

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

  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  questions.set(id, { id, sessionId, text: text.trim(), audienceId, upvotes: 0, ts: Date.now() });
  cooldowns.set(cooldownKey, Date.now());

  return NextResponse.json({ ok: true, id });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  const result = [...questions.values()]
    .filter(q => !sessionId || q.sessionId === sessionId)
    .sort((a, b) => b.upvotes - a.upvotes || a.ts - b.ts);
  return NextResponse.json(result);
}
