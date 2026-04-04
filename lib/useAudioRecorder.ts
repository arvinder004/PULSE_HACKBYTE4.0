"use client";

import { useEffect, useRef, useState } from 'react';

type UploadResult = { ok: boolean; fileId?: string; error?: string };

type UseAudioRecorderArgs = {
  sessionId: string;
  enabled: boolean;
  chunkMs?: number;
  onUploaded?: (fileId: string) => void;
};

export default function useAudioRecorder({ sessionId, enabled, chunkMs = 30_000, onUploaded }: UseAudioRecorderArgs) {
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [lastFileId, setLastFileId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const recorderRef     = useRef<MediaRecorder | null>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const chunkIndexRef   = useRef(0);
  const sessionStartRef = useRef(0);
  // The first ondataavailable fires with the init segment (headers).
  // We keep it and prepend it to every subsequent chunk so each file
  // is a valid standalone WebM.
  const initSegmentRef  = useRef<Uint8Array | null>(null);
  const DEBUG = true;

  useEffect(() => {
    if (!enabled) { stop(); return; }
    start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId, chunkMs]);

  async function start() {
    if (!sessionId) return;
    if (!navigator?.mediaDevices?.getUserMedia) {
      setSupported(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current     = stream;
      chunkIndexRef.current = 0;
      sessionStartRef.current = Date.now();
      initSegmentRef.current  = null;

      // Prefer opus in webm; fall back to plain webm
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });

      // Buffer raw Uint8Array pieces between timeslice ticks
      let pendingPieces: Uint8Array[] = [];

      // MediaRecorder fires ondataavailable every `chunkMs` ms.
      // The very first event contains the WebM init segment (EBML header +
      // Tracks element). We save it and prepend it to all later chunks.
      recorder.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size === 0) return;

        const arrayBuf = await ev.data.arrayBuffer();
        const bytes    = new Uint8Array(arrayBuf);
        const idx      = chunkIndexRef.current++;
        const startTs  = sessionStartRef.current + idx * chunkMs;
        const endTs    = Date.now();

        let payload: Uint8Array;

        if (idx === 0) {
          // First chunk — contains the init segment. Save it and use as-is.
          initSegmentRef.current = bytes;
          payload = bytes;
          if (DEBUG) console.log('[PULSE][Audio] chunk 0 (init+data)', bytes.length, 'bytes');
        } else {
          // Subsequent chunks — prepend the saved init segment so the file
          // is a valid standalone WebM that any decoder can open.
          const init = initSegmentRef.current;
          if (init) {
            payload = new Uint8Array(init.length + bytes.length);
            payload.set(init, 0);
            payload.set(bytes, init.length);
            if (DEBUG) console.log('[PULSE][Audio] chunk', idx, '(init+data)', payload.length, 'bytes (init:', init.length, '+ data:', bytes.length, ')');
          } else {
            // Fallback: no init segment captured yet, send raw
            payload = bytes;
            if (DEBUG) console.log('[PULSE][Audio] chunk', idx, 'no init segment — sending raw', bytes.length, 'bytes');
          }
        }

        const blobBytes = new Uint8Array(payload.byteLength);
        blobBytes.set(payload);
        const blob      = new Blob([blobBytes.buffer], { type: mimeType });
        const result    = await uploadChunk(blob, idx, startTs, endTs, mimeType);
        if (result.ok && result.fileId) {
          setLastFileId(result.fileId);
          onUploaded?.(result.fileId);
        } else if (result.error) {
          setLastError(result.error);
        }
      };

      recorder.onerror = () => {
        setLastError('MediaRecorder error');
        if (DEBUG) console.log('[PULSE][Audio] recorder error');
      };

      recorderRef.current = recorder;
      recorder.start(chunkMs);
      setRecording(true);
      if (DEBUG) console.log('[PULSE][Audio] started, chunkMs=', chunkMs, 'mimeType=', mimeType);
    } catch (e: any) {
      setLastError(e?.message || 'Audio start failed');
      if (DEBUG) console.log('[PULSE][Audio] start failed', e?.message || e);
    }
  }

  function stop() {
    try { recorderRef.current?.stop(); } catch {}
    recorderRef.current = null;
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    streamRef.current = null;
    initSegmentRef.current = null;
    if (recording && DEBUG) console.log('[PULSE][Audio] stopped');
    setRecording(false);
  }

  async function uploadChunk(
    blob: Blob,
    chunkIndex: number,
    startTs: number,
    endTs: number,
    mimeType: string,
  ): Promise<UploadResult> {
    try {
      const file = new File([blob], `chunk-${chunkIndex}.webm`, { type: mimeType });
      const form = new FormData();
      form.append('file',       file);
      form.append('sessionId',  sessionId);
      form.append('chunkIndex', String(chunkIndex));
      form.append('startTs',    String(startTs));
      form.append('endTs',      String(endTs));

      const res  = await fetch('/api/audio/upload', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) return { ok: false, error: json?.error || 'Upload failed' };
      if (DEBUG) console.log('[PULSE][Audio] uploaded chunk', chunkIndex, '→', json?.fileId);
      return { ok: true, fileId: json?.fileId };
    } catch (e: any) {
      if (DEBUG) console.log('[PULSE][Audio] upload error chunk', chunkIndex, e?.message || e);
      return { ok: false, error: e?.message || 'Upload failed' };
    }
  }

  return { supported, recording, lastFileId, lastError } as const;
}
