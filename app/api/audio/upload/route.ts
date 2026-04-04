import { connectDB, getGridFSBucket } from '@/lib/db';
import { Readable, PassThrough } from 'stream';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const sessionId = String(form.get('sessionId') ?? 'unknown');
  const ts = String(form.get('ts') ?? Date.now());

  if (!file) {
    return new Response(JSON.stringify({ error: 'Missing file' }), { status: 400 });
  }

  await connectDB();

  const bucket = getGridFSBucket('audio');
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '') || 'session';
  const filename = `${safeSessionId}-${ts}.webm`;
  const contentType = (file as any).type || 'audio/webm';

  // Convert web ReadableStream -> Node Readable
  // @ts-ignore Node 18+ has Readable.fromWeb
  const nodeStream = Readable.fromWeb((file as any).stream());

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
    const tee = new PassThrough();
    const localStream = createWriteStream(localPath);

    const gridPromise = new Promise<void>((resolve, reject) => {
      tee.pipe(uploadStream)
        .on('error', (err: any) => reject(err))
        .on('finish', () => resolve());
    });

    const localPromise = new Promise<void>((resolve) => {
      tee.pipe(localStream)
        .on('error', (err: any) => {
          localError = err?.message || String(err);
          try { tee.unpipe(localStream); } catch {}
          try { localStream.destroy(); } catch {}
          resolve();
        })
        .on('finish', () => resolve());
    });

    nodeStream.pipe(tee);
    await Promise.all([gridPromise, localPromise]);
  } else {
    await new Promise<void>((resolve, reject) => {
      nodeStream.pipe(uploadStream)
        .on('error', (err: any) => reject(err))
        .on('finish', () => resolve());
    });
  }

  const fileId = uploadStream.id?.toString?.() ?? null;

  if (resolvedLocalDir) {
    console.log('[PULSE][Phase3][Audio][Local]', { localPath, localError });
  }

  console.log('[PULSE][Phase3][Audio][Upload]', { sessionId, ts, fileId });
  return new Response(JSON.stringify({ ok: true, fileId, localPath: localPath || null, localError }), { status: 200 });
}
