import { NextRequest, NextResponse } from 'next/server';

// In-memory store — will be replaced with SpacetimeDB reducer in Phase 2
const g = globalThis as typeof globalThis & { __pulse_signals?: { sessionId: string; signalType: string; audienceId: string; ts: number }[] };
if (!g.__pulse_signals) g.__pulse_signals = [];
const signals = g.__pulse_signals;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.sessionId || !body?.signalType || !body?.audienceId) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  signals.push({ sessionId: body.sessionId, signalType: body.signalType, audienceId: body.audienceId, ts: Date.now() });

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  const result = sessionId ? signals.filter(s => s.sessionId === sessionId) : signals;
  return NextResponse.json(result);
}
