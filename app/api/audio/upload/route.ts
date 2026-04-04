import { connectDB, getGridFSBucket } from '@/lib/db';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
<<<<<<< HEAD
import { transcribeAudio } from '@/lib/gemini-transcribe';
import TranscriptChunk from '@/lib/models/TranscriptChunk';

export async function POST(req: Request) {
  const form       = await req.formData();
  const file       = form.get('file')       as File | null;
  const sessionId  = String(form.get('sessionId')  ?? 'unknown');
  const chunkIndex = Number(form.get('chunkIndex') ?? 0);
  const startTs    = Number(form.get('startTs')    ?? Date.now());
  const endTs      = Number(form.get('endTs')      ?? Date.now());

  console.log('[PULSE][Upload] ▶ received', { sessionId, chunkIndex, startTs, endTs, fileSize: (file as any)?.size ?? 'unknown' });
=======
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
>>>>>>> f4137dc47da7c94289b61d9ac26d3fb460858d16

  if (!file) {
    console.log('[PULSE][Upload] ✗ missing file');
    return new Response(JSON.stringify({ error: 'Missing file' }), { status: 400 });
  }

  try {
    await connectDB();
    console.log('[PULSE][Upload] ✓ db connected');
  } catch (e: any) {
    console.log('[PULSE][Upload] ✗ db connect failed', e?.message);
    return new Response(JSON.stringify({ error: 'DB connection failed' }), { status: 500 });
  }

<<<<<<< HEAD
  const bucket       = getGridFSBucket('audio');
  const safeSession  = sessionId.replace(/[^a-zA-Z0-9_-]/g, '') || 'session';
  const filename     = `${safeSession}-${chunkIndex}-${startTs}.webm`;
  const contentType  = (file as any).type || 'audio/webm';

  console.log('[PULSE][Upload] storing to GridFS:', filename, 'contentType:', contentType);

  // @ts-ignore Node 18+ has Readable.fromWeb
  const nodeStream   = Readable.fromWeb((file as any).stream());
=======
  const session = await Session.findOne({ sessionId }).lean().exec();

  const bucket = getGridFSBucket('audio');
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '') || 'session';
  const filename = `${safeSessionId}-${ts}.webm`;
  const contentType = (file as any).type || 'audio/webm';

  const audioBuffer = Buffer.from(await file.arrayBuffer());

>>>>>>> f4137dc47da7c94289b61d9ac26d3fb460858d16
  const uploadStream = bucket.openUploadStream(filename, {
    metadata: { sessionId, chunkIndex, startTs, endTs, contentType },
  });

  const localDir = process.env.PULSE_AUDIO_LOCAL_DIR ||
    (process.env.NODE_ENV === 'development' ? 'local-audio' : '');
  const resolvedLocalDir = localDir
    ? (path.isAbsolute(localDir) ? localDir : path.join(process.cwd(), localDir))
    : '';
  const localPath = resolvedLocalDir ? path.join(resolvedLocalDir, filename) : '';
  let localError: string | null = null;

  if (resolvedLocalDir) await mkdir(resolvedLocalDir, { recursive: true });

<<<<<<< HEAD
  try {
    if (resolvedLocalDir) {
      const tee         = new PassThrough();
      const localStream = createWriteStream(localPath);

      const gridPromise = new Promise<void>((resolve, reject) => {
        tee.pipe(uploadStream).on('error', (e) => { console.log('[PULSE][Upload] ✗ GridFS pipe error', e?.message); reject(e); }).on('finish', resolve);
      });
      const localPromise = new Promise<void>((resolve) => {
        tee.pipe(localStream)
          .on('error', (err: any) => {
            localError = err?.message || String(err);
            console.log('[PULSE][Upload] local write error (non-fatal)', localError);
            try { tee.unpipe(localStream); } catch {}
            try { localStream.destroy(); } catch {}
            resolve();
          })
          .on('finish', resolve);
      });

      nodeStream.pipe(tee);
      await Promise.all([gridPromise, localPromise]);
    } else {
      await new Promise<void>((resolve, reject) => {
        nodeStream.pipe(uploadStream).on('error', reject).on('finish', resolve);
      });
    }
  } catch (e: any) {
    console.log('[PULSE][Upload] ✗ stream error', e?.message);
    return new Response(JSON.stringify({ error: 'Stream failed: ' + e?.message }), { status: 500 });
=======
  if (resolvedLocalDir) {
    try {
      await writeFile(localPath, audioBuffer);
    } catch (err: any) {
      localError = err?.message || String(err);
    }
>>>>>>> f4137dc47da7c94289b61d9ac26d3fb460858d16
  }

  await new Promise<void>((resolve, reject) => {
    uploadStream.on('finish', () => resolve());
    uploadStream.on('error', (err: any) => reject(err));
    uploadStream.end(audioBuffer);
  });

  const fileId = uploadStream.id?.toString?.() ?? null;
<<<<<<< HEAD
  if (!fileId) {
    console.log('[PULSE][Upload] ✗ no fileId after upload');
    return new Response(JSON.stringify({ error: 'GridFS upload failed — no fileId' }), { status: 500 });
  }

  console.log('[PULSE][Upload] ✓ GridFS stored', { filename, fileId, localPath: localPath || 'none', localError });

  // ── Create TranscriptChunk document (status: pending) ────────────────
  try {
    const result = await TranscriptChunk.findOneAndUpdate(
      { sessionId, chunkIndex },
      {
        $setOnInsert: {
          sessionId, chunkIndex, startTs, endTs,
          audioFileId:   fileId,
          audioFilename: filename,
          text:      '',
          wordCount: 0,
          status:    'pending',
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    console.log('[PULSE][Upload] ✓ TranscriptChunk saved', { sessionId, chunkIndex, docId: result?._id?.toString() });
  } catch (e: any) {
    console.log('[PULSE][Upload] ✗ TranscriptChunk save error', e?.message, e?.code);
    // Don't return — still attempt transcription
  }

  // ── Gemini transcription (fire-and-forget) ────────────────────────────
  if (!process.env.GEMINI_API_KEY) {
    console.log('[PULSE][Transcribe] ⚠ no GEMINI_API_KEY — skipping transcription for chunk', chunkIndex);
  } else {
    console.log('[PULSE][Transcribe] ▶ starting async transcription for chunk', chunkIndex);
    ;(async () => {
      try {
        // Read buffer back from GridFS
        console.log('[PULSE][Transcribe] downloading chunk', chunkIndex, 'from GridFS fileId:', fileId);
        const dlBucket  = getGridFSBucket('audio');
        const bufChunks: Buffer[] = [];
        const dlStream  = dlBucket.openDownloadStream(uploadStream.id);

        await new Promise<void>((resolve, reject) => {
          dlStream.on('data',  (c: Buffer) => bufChunks.push(c));
          dlStream.on('end',   resolve);
          dlStream.on('error', (e) => { console.log('[PULSE][Transcribe] ✗ GridFS download error', e?.message); reject(e); });
        });

        const audioBuffer = Buffer.concat(bufChunks);
        console.log('[PULSE][Transcribe] ✓ downloaded', audioBuffer.length, 'bytes for chunk', chunkIndex);

        const mimeType = contentType.includes('ogg') ? 'audio/ogg' : 'audio/webm';
        console.log('[PULSE][Transcribe] calling Gemini for chunk', chunkIndex, 'mimeType:', mimeType);

        const text = await transcribeAudio(audioBuffer, mimeType);
        console.log('[PULSE][Transcribe] Gemini response for chunk', chunkIndex, ':', text ? `"${text.slice(0, 120)}"` : '(empty/null)');

        const updateResult = await TranscriptChunk.findOneAndUpdate(
          { sessionId, chunkIndex },
          {
            $set: {
              text:      text?.trim() ?? '',
              wordCount: text ? text.trim().split(/\s+/).filter(Boolean).length : 0,
              status:    text?.trim() ? 'transcribed' : 'failed',
            },
          },
          { new: true }
        );

        console.log('[PULSE][Transcribe] ✓ chunk', chunkIndex, 'status →', updateResult?.status, '| words:', updateResult?.wordCount);
      } catch (e: any) {
        console.log('[PULSE][Transcribe] ✗ error on chunk', chunkIndex, e?.message || e);
        await TranscriptChunk.findOneAndUpdate(
          { sessionId, chunkIndex },
          { $set: { status: 'failed' } }
        ).catch(() => {});
      }
    })();
  }

  return new Response(
    JSON.stringify({ ok: true, fileId, chunkIndex, localPath: localPath || null, localError }),
    { status: 200 }
  );
=======

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
>>>>>>> f4137dc47da7c94289b61d9ac26d3fb460858d16
}
