import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/captions — speaker pushes a final caption chunk.
 * Broadcasts it via SSE to all audience clients subscribed to the signals stream.
 *
 * GET /api/captions?sessionId=X — returns recent captions from in-memory buffer.
 */

type CaptionEntry = { id: string; sessionId: string; text: string; ts: number };

const g = globalThis as typeof globalThis & {
  __pulse_captions?: Map<string, CaptionEntry[]>;       // sessionId → recent captions
  __pulse_sse_clients?: Map<string, Set<ReadableStreamDefaultController>>;
};
if (!g.__pulse_captions) g.__pulse_captions = new Map();
const captionStore = g.__pulse_captions;

function broadcast(sessionId: string, data: object) {
  const sseClients = g.__pulse_sse_clients;
  if (!sseClients) return;
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const ctrl of clients) {
    try { ctrl.enqueue(msg); sent++; } catch { clients.delete(ctrl); }
  }
  console.log(`[PULSE][Captions] broadcast to ${sent} clients for session ${sessionId}`);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { sessionId, id, text } = body ?? {};

  if (!sessionId || !text) {
    return NextResponse.json({ error: 'Missing sessionId or text' }, { status: 400 });
  }

  const entry: CaptionEntry = {
    id:        id ?? `${sessionId}:${Date.now()}`,
    sessionId,
    text:      String(text).slice(0, 500),
    ts:        Date.now(),
  };

  // Keep last 100 captions per session in memory
  const existing = captionStore.get(sessionId) ?? [];
  existing.push(entry);
  if (existing.length > 100) existing.splice(0, existing.length - 100);
  captionStore.set(sessionId, existing);

  // Broadcast to all SSE clients (audience + producer)
  broadcast(sessionId, { type: 'caption', id: entry.id, text: entry.text, ts: entry.ts });

  console.log(`[PULSE][Captions] POST sessionId=${sessionId} text="${text.slice(0, 60)}"`);
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

  const captions = captionStore.get(sessionId) ?? [];
  return NextResponse.json({ captions });
}
