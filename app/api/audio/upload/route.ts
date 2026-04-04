import { connectDB, getGridFSBucket } from '@/lib/db';
import { Readable } from 'stream';

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
  const filename = `${sessionId}-${ts}.webm`;

  // Convert web ReadableStream -> Node Readable
  // @ts-ignore Node 18+ has Readable.fromWeb
  const nodeStream = Readable.fromWeb((file as any).stream());

  const uploadStream = bucket.openUploadStream(filename, {
    metadata: { sessionId, ts, contentType: (file as any).type || 'audio/webm' },
  });

  await new Promise<void>((resolve, reject) => {
    nodeStream.pipe(uploadStream)
      .on('error', (err: any) => reject(err))
      .on('finish', () => resolve());
  });

  const fileId = uploadStream.id?.toString?.() ?? null;

  console.log('[PULSE][Phase3][Audio][Upload]', { sessionId, ts, fileId });
  return new Response(JSON.stringify({ ok: true, fileId }), { status: 200 });
}
