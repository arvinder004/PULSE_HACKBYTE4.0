import { connectDB, getGridFSBucket } from '@/lib/db';
import { Readable, PassThrough } from 'stream';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import TranscriptChunk from '@/lib/models/TranscriptChunk';

export async function POST(req: Request) {
  const form       = await req.formData();
  const file       = form.get('file')       as File | null;
  const sessionId  = String(form.get('sessionId')  ?? 'unknown');
  const chunkIndex = Number(form.get('chunkIndex') ?? 0);
  const startTs    = Number(form.get('startTs')    ?? Date.now());
  const endTs      = Number(form.get('endTs')      ?? Date.now());

  console.log('[PULSE][Upload] ▶ received', { sessionId, chunkIndex, startTs, endTs, fileSize: (file as any)?.size ?? 'unknown' });

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

  const bucket       = getGridFSBucket('audio');
  const safeSession  = sessionId.replace(/[^a-zA-Z0-9_-]/g, '') || 'session';
  const filename     = `${safeSession}-${chunkIndex}-${startTs}.webm`;
  const contentType  = (file as any).type || 'audio/webm';

  console.log('[PULSE][Upload] storing to GridFS:', filename, 'contentType:', contentType);

  // @ts-ignore Node 18+ has Readable.fromWeb
  const nodeStream   = Readable.fromWeb((file as any).stream());
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

  try {
    if (resolvedLocalDir) {
      const tee         = new PassThrough();
      const localStream = createWriteStream(localPath);

      const gridPromise = new Promise<void>((resolve, reject) => {
        tee.pipe(uploadStream).on('error', (e) => { console.log('[PULSE][Upload] ✗ GridFS pipe error', (e as any)?.message); reject(e); }).on('finish', resolve);
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
  }

  const fileId = uploadStream.id?.toString?.() ?? null;
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
      { upsert: true, returnDocument: 'after' }
    );
    console.log('[PULSE][Upload] ✓ TranscriptChunk saved', { sessionId, chunkIndex, docId: result?._id?.toString() });
  } catch (e: any) {
    console.log('[PULSE][Upload] ✗ TranscriptChunk save error', e?.message, e?.code);
  }

  console.log('[PULSE][Transcribe] ⚠ Gemini STT removed — audio is stored only');

  return new Response(
    JSON.stringify({ ok: true, fileId, chunkIndex, localPath: localPath || null, localError }),
    { status: 200 }
  );
}
