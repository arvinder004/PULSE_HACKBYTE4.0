import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';

function isValidSessionId(sessionId: string) {
  return /^[a-z0-9]{12}$/.test(sessionId);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { sessionId?: string; interventionId?: string } | null;
  if (!body?.sessionId || !body?.interventionId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  if (!isValidSessionId(body.sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  await connectDB();

  try {
    const res = await Session.updateOne(
      { sessionId: body.sessionId, 'interventions.id': body.interventionId },
      { $set: { 'interventions.$.acknowledged': true } }
    );

    if (res.matchedCount === 0) {
      return NextResponse.json({ error: 'Intervention not found' }, { status: 404 });
    }
    console.log('[PULSE][Phase3][Intervene] ack', { sessionId: body.sessionId, interventionId: body.interventionId });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to ack' }, { status: 500 });
  }

  // Broadcast ack to SSE listeners (optional)
  try {
    const g = globalThis as any;
    const sseClients: Map<string, Set<ReadableStreamDefaultController>> = g.__pulse_sse_clients;
    if (sseClients) {
      const clients = sseClients.get(body.sessionId) ?? new Set();
      const payload = { type: 'intervention_ack', interventionId: body.interventionId };
      const msg = `data: ${JSON.stringify(payload)}\n\n`;
      for (const ctrl of clients) {
        try { ctrl.enqueue(msg); } catch { clients.delete(ctrl); }
      }
    }
  } catch {}

  return NextResponse.json({ ok: true });
}
