import { NextResponse } from 'next/server';
import { synthesizeSpeech } from '@/lib/elevenlabs';

const g = globalThis as typeof globalThis & { __pulse_tts_cache?: Map<string, Buffer> };
if (!g.__pulse_tts_cache) g.__pulse_tts_cache = new Map();
const cache = g.__pulse_tts_cache;
const CACHE_LIMIT = 20;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { text?: string; voiceId?: string } | null;
  const text = body?.text?.trim() || '';
  if (!text) return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  if (text.length > 500) return NextResponse.json({ error: 'Text too long' }, { status: 413 });

  const cacheKey = `${body?.voiceId || ''}:${text}`;
  if (cache.has(cacheKey)) {
    const buf = cache.get(cacheKey)!;
    console.log('[PULSE][Phase3][TTS] cache hit', { size: buf.length });
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'audio/mpeg', 'X-Cache': 'HIT' } });
  }

  try {
    console.log('[PULSE][Phase3][TTS] synth', { textLen: text.length });
    const { audioBuffer, contentType } = await synthesizeSpeech(text, body?.voiceId);

    cache.set(cacheKey, audioBuffer);
    if (cache.size > CACHE_LIMIT) {
      const first = cache.keys().next().value as string | undefined;
      if (first) cache.delete(first);
    }

    return new Response(new Uint8Array(audioBuffer), { headers: { 'Content-Type': contentType, 'X-Cache': 'MISS' } });
  } catch (e: any) {
    console.log('[PULSE][Phase3][TTS] error', e?.message || e);
    return NextResponse.json({ error: 'TTS failed' }, { status: 500 });
  }
}
