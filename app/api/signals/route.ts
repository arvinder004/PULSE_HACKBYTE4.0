import { NextRequest, NextResponse } from 'next/server';

type Signal = {
  sessionId: string;
  signalType: string;
  audienceId: string;
  fingerprint: string;
  weight: number;
  ts: number;
};

// ── In-memory stores (survive HMR via globalThis) ──────────────────────────
const g = globalThis as typeof globalThis & {
  __pulse_signals?: Signal[];
  __pulse_sig_cooldowns?: Map<string, number>;
  __pulse_sse_clients?: Map<string, Set<ReadableStreamDefaultController>>;
};
if (!g.__pulse_signals)      g.__pulse_signals      = [];
if (!g.__pulse_sig_cooldowns) g.__pulse_sig_cooldowns = new Map();
if (!g.__pulse_sse_clients)  g.__pulse_sse_clients  = new Map();

const signals    = g.__pulse_signals;
const cooldowns  = g.__pulse_sig_cooldowns;
const sseClients = g.__pulse_sse_clients;

const COOLDOWN_MS   = 10_000;
const WINDOW_MS     = 60_000; // window for outlier detection
const OUTLIER_STDEV = 2.5;    // z-score threshold

// ── Helpers ────────────────────────────────────────────────────────────────

function broadcast(sessionId: string, data: object) {
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const ctrl of clients) {
    try { ctrl.enqueue(msg); } catch { clients.delete(ctrl); }
  }
}

/** Compute weight for a new signal using z-score outlier detection. */
function computeWeight(sessionId: string, signalType: string): number {
  const now = Date.now();
  const window = signals.filter(
    s => s.sessionId === sessionId && s.signalType === signalType && now - s.ts < WINDOW_MS
  );
  if (window.length < 3) return 1.0;

  // rate = signals per minute per type
  const rates = window.map((_, i, arr) => {
    if (i === 0) return null;
    return 1 / ((arr[i].ts - arr[i - 1].ts) / 60_000);
  }).filter(Boolean) as number[];

  if (rates.length < 2) return 1.0;

  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return 1.0;

  const lastRate = rates[rates.length - 1];
  const z = Math.abs((lastRate - mean) / stdev);

  // Outlier → down-weight; normal → full weight
  return z > OUTLIER_STDEV ? Math.max(0.1, 1 - (z - OUTLIER_STDEV) / 10) : 1.0;
}

// ── POST — receive signal ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.sessionId || !body?.signalType || !body?.audienceId) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { sessionId, signalType, audienceId, fingerprint = audienceId } = body as {
    sessionId: string; signalType: string; audienceId: string; fingerprint?: string;
  };

  // Rate limit — per fingerprint per session
  const rlKey = `${sessionId}:${fingerprint}`;
  const lastAt = cooldowns.get(rlKey) ?? 0;
  if (Date.now() - lastAt < COOLDOWN_MS) {
    return NextResponse.json({ error: 'Too many signals', retryAfter: Math.ceil((lastAt + COOLDOWN_MS - Date.now()) / 1000) }, { status: 429 });
  }
  cooldowns.set(rlKey, Date.now());

  const weight = computeWeight(sessionId, signalType);
  const signal: Signal = { sessionId, signalType, audienceId, fingerprint, weight, ts: Date.now() };
  signals.push(signal);

  broadcast(sessionId, { type: 'signal', signal });

  return NextResponse.json({ ok: true, weight });
}

// ── GET — SSE stream (speaker) or snapshot ────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  const sse = searchParams.get('sse') === '1';

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  // Snapshot mode
  if (!sse) {
    const result = signals.filter(s => s.sessionId === sessionId);
    return NextResponse.json(result);
  }

  // SSE mode
  if (!sseClients.has(sessionId)) sseClients.set(sessionId, new Set());
  const clients = sseClients.get(sessionId)!;

  const stream = new ReadableStream({
    start(ctrl) {
      clients.add(ctrl);
      // Send current counts immediately on connect
      const counts = buildCounts(sessionId);
      ctrl.enqueue(`data: ${JSON.stringify({ type: 'snapshot', counts })}\n\n`);
    },
    cancel(ctrl) {
      clients.delete(ctrl as unknown as ReadableStreamDefaultController);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

function buildCounts(sessionId: string) {
  const counts: Record<string, number> = {};
  for (const s of signals.filter(sig => sig.sessionId === sessionId)) {
    counts[s.signalType] = (counts[s.signalType] ?? 0) + 1;
  }
  return counts;
}
