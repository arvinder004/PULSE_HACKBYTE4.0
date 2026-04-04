import { connectDB, getGridFSBucket } from '@/lib/db';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import Session from '@/lib/models/Session';
import SegmentSummary from '@/lib/models/SegmentSummary';
import { transcribeSpeech } from '@/lib/elevenlabs';
import { summarizeSegment } from '@/lib/gemini';

type Signal = {
  sessionId: string;
  signalType: string;
  ts: number;
};

type Question = { id: string; sessionId: string; text: string; upvotes: number; ts: number };

function buildSignalCounts(sessionId: string, ts: number, windowMs = 60_000) {
  const g = globalThis as typeof globalThis & { __pulse_signals?: Signal[] };
  const signals = g.__pulse_signals || [];
  const start = ts - windowMs;
  const counts: Record<string, number> = {};
  for (const s of signals) {
    if (s.sessionId !== sessionId) continue;
    if (s.ts < start || s.ts > ts) continue;
    counts[s.signalType] = (counts[s.signalType] ?? 0) + 1;
  }
  return counts;
}

function getQuestionSnapshot(sessionId: string, limit = 3) {
  const g = globalThis as typeof globalThis & { __pulse_questions?: Map<string, Question> };
  const questions = g.__pulse_questions || new Map();
  return [...questions.values()]
    .filter(q => q.sessionId === sessionId)
    .sort((a, b) => b.upvotes - a.upvotes || a.ts - b.ts)
    .slice(0, limit)
    .map(q => ({ id: q.id, text: q.text, upvotes: q.upvotes }));
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const sessionId = String(form.get('sessionId') ?? 'unknown');
  const ts = String(form.get('ts') ?? Date.now());
  const tsNum = Number(ts);
  const chunkTs = Number.isFinite(tsNum) ? tsNum : Date.now();

  if (!file) {
    return new Response(JSON.stringify({ error: 'Missing file' }), { status: 400 });
  }

  await connectDB();

  const session = await Session.findOne({ sessionId }).lean().exec();

  const bucket = getGridFSBucket('audio');
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '') || 'session';
  const filename = `${safeSessionId}-${ts}.webm`;
  const contentType = (file as any).type || 'audio/webm';

  const audioBuffer = Buffer.from(await file.arrayBuffer());

  const uploadStream = bucket.openUploadStream(filename, {
    metadata: { sessionId, ts, contentType },
  });

  const localDir = process.env.PULSE_AUDIO_LOCAL_DIR || (process.env.NODE_ENV === 'development' ? 'local-audio' : '');
  const resolvedLocalDir = localDir
    ? (path.isAbsolute(localDir) ? localDir : path.join(process.cwd(), localDir))
    : '';
  const localPath = resolvedLocalDir ? path.join(resolvedLocalDir, filename) : '';
  let localError: string | null = null;

  if (resolvedLocalDir) {
    await mkdir(resolvedLocalDir, { recursive: true });
  }

  if (resolvedLocalDir) {
    try {
      await writeFile(localPath, audioBuffer);
    } catch (err: any) {
      localError = err?.message || String(err);
    }
  }

  await new Promise<void>((resolve, reject) => {
    uploadStream.on('finish', () => resolve());
    uploadStream.on('error', (err: any) => reject(err));
    uploadStream.end(audioBuffer);
  });

  const fileId = uploadStream.id?.toString?.() ?? null;

  const signalCounts = buildSignalCounts(sessionId, chunkTs, 60_000);
  const questions = getQuestionSnapshot(sessionId, 3);

  let transcriptText: string | null = null;
  let transcriptError: string | null = null;
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      const result = await transcribeSpeech(audioBuffer, contentType, filename);
      transcriptText = (result.text || '').trim();
      console.log('[PULSE][Phase3][Audio][Transcribe]', { sessionId, transcriptLen: transcriptText.length });
    } catch (e: any) {
      transcriptError = e?.message || String(e);
      console.log('[PULSE][Phase3][Audio][Transcribe] failed', transcriptError);
    }
  } else {
    transcriptError = 'ELEVENLABS_API_KEY missing';
    console.log('[PULSE][Phase3][Audio][Transcribe] skipped (missing ELEVENLABS_API_KEY)');
  }

  let summaryText: string | null = null;
  let improvement: string | null = null;
  let focusTags: string[] = [];
  let summaryError: string | null = null;

  if (transcriptText) {
    try {
      const summary = await summarizeSegment({
        sessionId,
        transcript: transcriptText,
        signals: signalCounts,
        questions,
        speakerName: session?.speakerName,
        topic: session?.topic,
      });
      summaryText = summary.summary;
      improvement = summary.improvement;
      focusTags = summary.focusTags || [];
      console.log('[PULSE][Phase3][Audio][Summary]', { sessionId, summaryLen: summaryText?.length || 0 });
    } catch (e: any) {
      summaryError = e?.message || String(e);
      console.log('[PULSE][Phase3][Audio][Summary] failed', summaryError);
    }
  }

  let segmentId: string | null = null;
  try {
    const segment = await SegmentSummary.create({
      sessionId,
      ts: chunkTs,
      audioFileId: fileId ?? undefined,
      transcript: transcriptText ?? undefined,
      transcriptProvider: transcriptText ? 'elevenlabs' : undefined,
      transcriptError: transcriptError ?? undefined,
      summary: summaryText ?? undefined,
      improvement: improvement ?? undefined,
      focusTags,
      summaryProvider: summaryText ? 'gemini' : undefined,
      summaryError: summaryError ?? undefined,
      signalCounts,
      questions,
    });
    segmentId = segment?._id?.toString?.() ?? null;
  } catch (e: any) {
    console.log('[PULSE][Phase3][Audio][Segment] save failed', e?.message || e);
  }

  if (resolvedLocalDir) {
    console.log('[PULSE][Phase3][Audio][Local]', { localPath, localError });
  }

  console.log('[PULSE][Phase3][Audio][Upload]', { sessionId, ts, fileId });
  return new Response(JSON.stringify({
    ok: true,
    fileId,
    segmentId,
    localPath: localPath || null,
    localError,
    transcriptError,
    summaryError,
  }), { status: 200 });
}
