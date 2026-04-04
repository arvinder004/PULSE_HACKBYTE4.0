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

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const DEBUG = true;

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId, chunkMs]);

  async function start() {
    if (!sessionId) return;
    if (!navigator?.mediaDevices?.getUserMedia) {
      setSupported(false);
      if (DEBUG) console.log('[PULSE][Phase3][Audio] getUserMedia not supported');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = async (ev) => {
        const blob = ev.data;
        if (!blob || blob.size === 0) return;
        if (DEBUG) console.log('[PULSE][Phase3][Audio] chunk ready', Math.round(blob.size / 1024), 'KB');
        const result = await uploadChunk(blob);
        if (result.ok && result.fileId) {
          setLastFileId(result.fileId);
          onUploaded?.(result.fileId);
        } else if (result.error) {
          setLastError(result.error);
        }
      };

      recorder.onerror = () => {
        setLastError('MediaRecorder error');
        if (DEBUG) console.log('[PULSE][Phase3][Audio] recorder error');
      };

      recorderRef.current = recorder;
      recorder.start(chunkMs);
      setRecording(true);
      if (DEBUG) console.log('[PULSE][Phase3][Audio] started, chunkMs=', chunkMs);
    } catch (e: any) {
      setLastError(e?.message || 'Audio start failed');
      if (DEBUG) console.log('[PULSE][Phase3][Audio] start failed', e?.message || e);
    }
  }

  function stop() {
    try {
      recorderRef.current?.stop();
    } catch {}
    recorderRef.current = null;

    try {
      streamRef.current?.getTracks().forEach(t => t.stop());
    } catch {}
    streamRef.current = null;

    if (recording && DEBUG) console.log('[PULSE][Phase3][Audio] stopped');
    setRecording(false);
  }

  async function uploadChunk(blob: Blob): Promise<UploadResult> {
    try {
      const file = new File([blob], `chunk-${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
      const form = new FormData();
      form.append('file', file);
      form.append('sessionId', sessionId);
      form.append('ts', String(Date.now()));

      const res = await fetch('/api/audio/upload', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) return { ok: false, error: json?.error || 'Upload failed' };
      if (DEBUG) console.log('[PULSE][Phase3][Audio] uploaded', json?.fileId || '(no id)');
      return { ok: true, fileId: json?.fileId };
    } catch (e: any) {
      if (DEBUG) console.log('[PULSE][Phase3][Audio] upload error', e?.message || e);
      return { ok: false, error: e?.message || 'Upload failed' };
    }
  }

  return { supported, recording, lastFileId, lastError } as const;
}
