import { NextResponse } from 'next/server';
import { connectDB, getGridFSBucket } from '@/lib/db';
import Session from '@/lib/models/Session';
import analyzeIntervention from '@/lib/gemini';
import { synthesizeSpeech } from '@/lib/elevenlabs';

type Body = {
  sessionId: string;
  transcript?: string;
  audioFileId?: string;
  signals?: Record<string, number> | any;
  enableTts?: boolean;
  voiceId?: string;
};

const INTERVENTION_COOLDOWN_MS = 90_000;

function isValidSessionId(sessionId: string) {
  return /^[a-z0-9]{12}$/.test(sessionId);
}

function normalizeSignalCounts(input: any): Record<string, number> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

function broadcastIntervention(sessionId: string, payload: object) {
  const g = globalThis as any;
  const sseClients: Map<string, Set<ReadableStreamDefaultController>> = g.__pulse_sse_clients;
  if (!sseClients) return;
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const ctrl of clients) {
    try { ctrl.enqueue(msg); } catch { clients.delete(ctrl); }
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Body | null;
  if (!body || !body.sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

  if (!isValidSessionId(body.sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  await connectDB();

  const { sessionId, transcript, audioFileId, signals, enableTts, voiceId } = body;
  const counts = normalizeSignalCounts(signals);

  const session = await Session.findOne({ sessionId }).exec();
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (session.active === false) return NextResponse.json({ error: 'Session ended' }, { status: 409 });

  const last = (session.interventions || [])[session.interventions.length - 1];
  if (last && !last.acknowledged) {
    console.log('[PULSE][Phase3][Intervene] pending ack', { sessionId, lastId: last.id });
    return NextResponse.json({
      error: 'Pending acknowledgement',
      interventionId: last.id,
    }, { status: 409 });
  }

  if (last?.createdAt) {
    const msSince = Date.now() - new Date(last.createdAt).getTime();
    if (msSince < INTERVENTION_COOLDOWN_MS) {
      console.log('[PULSE][Phase3][Intervene] cooldown', { sessionId, msSince });
      return NextResponse.json({
        error: 'Cooldown',
        retryAfter: Math.ceil((INTERVENTION_COOLDOWN_MS - msSince) / 1000),
      }, { status: 429 });
    }
  }

  const transcriptTrimmed = (transcript || '').slice(0, 2000);

  console.log('[PULSE][Phase3][Intervene] analyze', {
    sessionId,
    transcriptLen: transcriptTrimmed.length,
    counts,
    enableTts: !!enableTts,
  });

  const result = await analyzeIntervention({ sessionId, transcript: transcriptTrimmed, signals: counts });

  let ttsAudioBase64: string | undefined;
  let ttsContentType: string | undefined;
  let ttsFileId: string | undefined;

  if (enableTts && result.urgency === 'high' && process.env.ELEVENLABS_API_KEY) {
    try {
      const ttsText = `${result.message}. ${result.suggestion || ''}`.trim().slice(0, 300);
      const { audioBuffer, contentType } = await synthesizeSpeech(ttsText, voiceId);
      ttsAudioBase64 = audioBuffer.toString('base64');
      ttsContentType = contentType;

      const bucket = getGridFSBucket('tts');
      const filename = `${sessionId}-${Date.now()}-tts.mp3`;
      const uploadStream = bucket.openUploadStream(filename, {
        metadata: { sessionId, contentType },
      });

      await new Promise<void>((resolve, reject) => {
        uploadStream.on('finish', () => resolve());
        uploadStream.on('error', (err: any) => reject(err));
        uploadStream.end(audioBuffer);
      });

      ttsFileId = uploadStream.id?.toString?.() ?? undefined;
      console.log('[PULSE][Phase3][Intervene] TTS generated', { sessionId, ttsFileId });
    } catch (e: any) {
      console.log('[PULSE][Phase3][Intervene] TTS failed', e?.message || e);
    }
  }

  const intervention = {
    id: String(Date.now()),
    message: result.message,
    suggestion: result.suggestion,
    urgency: result.urgency,
    audioFileId: audioFileId ?? undefined,
    ttsFileId: ttsFileId ?? undefined,
    contextTranscript: transcriptTrimmed ? transcriptTrimmed.slice(0, 400) : undefined,
    contextSignals: Object.keys(counts).length ? counts : undefined,
    acknowledged: false,
    createdAt: new Date(),
  } as any;

  // Persist into session document
  try {
    session.interventions = session.interventions || [];
    session.interventions.push(intervention);
    await session.save();
  } catch (e) {
    return NextResponse.json({ error: 'Failed to persist intervention' }, { status: 500 });
  }

  // Broadcast to any SSE listeners (speaker view listens on /api/signals SSE)
  broadcastIntervention(sessionId, { type: 'intervention', ...intervention });

  return NextResponse.json({ ok: true, intervention, ttsAudioBase64, ttsContentType });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  await connectDB();
  const s = await Session.findOne({ sessionId }).lean().exec();
  if (!s) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Return last 10 interventions
  const list = (s.interventions || []).slice(-10).reverse();
  return NextResponse.json({ interventions: list });
}
