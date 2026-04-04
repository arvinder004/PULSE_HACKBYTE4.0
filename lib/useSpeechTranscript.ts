"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type TranscriptChunk = { text: string; ts: number };

const DEEPGRAM_WS = 'wss://api.deepgram.com/v1/listen';

function buildDeepgramUrl() {
  const model = process.env.NEXT_PUBLIC_DEEPGRAM_MODEL ?? 'nova-2';
  const language = process.env.NEXT_PUBLIC_DEEPGRAM_LANGUAGE ?? 'en-US';
  const params = new URLSearchParams({
    model,
    language,
    interim_results: 'true',
    punctuate: 'true',
    smart_format: 'true',
    encoding: 'opus',
    container: 'webm',
    channels: '1',
  });
  return `${DEEPGRAM_WS}?${params.toString()}`;
}


/**
 * Rolling 60s transcript buffer using Deepgram streaming STT.
 * Requires NEXT_PUBLIC_DEEPGRAM_API_KEY to be set.
 */
export default function useSpeechTranscript() {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const chunksRef = useRef<TranscriptChunk[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const listeningRef = useRef(false);
  const wantListeningRef = useRef(false);
  const suspendedRef = useRef(false);
  const startRef = useRef<() => void>(() => {});
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const envLoggedRef = useRef(false);
  const micProbeRef = useRef(false);
  const DEBUG = true;

  useEffect(() => {
    if (DEBUG && !envLoggedRef.current) {
      envLoggedRef.current = true;
      const conn = typeof navigator !== 'undefined' ? (navigator as any).connection : null;
      console.log('[PULSE][Phase4][Deepgram] env', {
        secure: typeof window !== 'undefined' ? window.isSecureContext : undefined,
        protocol: typeof window !== 'undefined' ? window.location?.protocol : undefined,
        online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        connection: conn ? {
          effectiveType: conn.effectiveType,
          rtt: conn.rtt,
          downlink: conn.downlink,
          saveData: conn.saveData,
        } : undefined,
      });
    }

    const hasMediaRecorder = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined';
    if (!hasMediaRecorder || !navigator?.mediaDevices?.getUserMedia) {
      setSupported(false);
      if (DEBUG) console.log('[PULSE][Phase4][Deepgram] MediaRecorder not supported');
      return;
    }

    return () => {
      try { recorderRef.current?.stop?.(); } catch {}
      recorderRef.current = null;
      try { socketRef.current?.close?.(); } catch {}
      socketRef.current = null;
      try { streamRef.current?.getTracks?.().forEach(t => t.stop()); } catch {}
      streamRef.current = null;
    };
  }, []);

  const scheduleReconnect = useCallback((reason: string) => {
    if (!wantListeningRef.current || suspendedRef.current) return;
    retryCountRef.current += 1;
    const delay = Math.min(1000 * (2 ** Math.min(retryCountRef.current, 4)), 10_000);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      if (!wantListeningRef.current || suspendedRef.current) return;
      if (DEBUG) console.log('[PULSE][Phase4][Deepgram] reconnect', { reason, delay });
      startRef.current?.();
    }, delay);
  }, [DEBUG]);

  const handleTranscript = useCallback((payload: any) => {
    if (!payload) return;
    if (payload.type && payload.type !== 'Results') return;
    const alt = payload.channel?.alternatives?.[0];
    const text = String(alt?.transcript || '').trim();
    if (!text) return;

    const isFinal = Boolean(payload.is_final || payload.speech_final);
    if (isFinal) {
      chunksRef.current.push({ text, ts: Date.now() });
      const cutoff = Date.now() - 60_000;
      chunksRef.current = chunksRef.current.filter(c => c.ts >= cutoff);
      setFinalText(text);
      setLiveText(text);
      if (DEBUG) console.log('[PULSE][Phase4][Deepgram] final', text.slice(0, 100));
    } else {
      setLiveText(text);
    }
  }, [DEBUG]);

  const start = useCallback(async () => {
    if (listeningRef.current) return;

    wantListeningRef.current = true;

    try {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      suspendedRef.current = false;
      retryCountRef.current = 0;
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      if (!micProbeRef.current) {
        micProbeRef.current = true;
        const track = stream.getAudioTracks()[0];
        if (DEBUG) console.log('[PULSE][Phase4][Deepgram] mic probe ok', {
          label: track?.label,
          readyState: track?.readyState,
          muted: track?.muted,
          enabled: track?.enabled,
          settings: track?.getSettings?.(),
        });
      }

      const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
      if (!apiKey) {
        setSupported(false);
        setError('missing-deepgram-key');
        return;
      }
      // Deepgram browser auth: pass key via Sec-WebSocket-Protocol header
      // (custom Authorization headers are blocked by browsers on WebSocket)
      const socket = new WebSocket(buildDeepgramUrl(), ['token', apiKey]);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.onopen = () => {
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';

        const recorder = new MediaRecorder(stream, { mimeType });
        recorderRef.current = recorder;

        recorder.ondataavailable = async (ev) => {
          if (!ev.data || ev.data.size === 0) return;
          if (socket.readyState !== WebSocket.OPEN) return;
          try {
            const buf = await ev.data.arrayBuffer();
            socket.send(buf);
          } catch (e) {
            if (DEBUG) console.log('[PULSE][Phase4][Deepgram] send error', String(e));
          }
        };

        recorder.onerror = () => {
          setError('media-recorder-error');
          if (DEBUG) console.log('[PULSE][Phase4][Deepgram] MediaRecorder error');
          scheduleReconnect('media-recorder');
        };

        recorder.start(250);
        setListening(true);
        listeningRef.current = true;
        if (DEBUG) console.log('[PULSE][Phase4][Deepgram] socket open, recorder started', { mimeType });
      };

      socket.onmessage = async (ev) => {
        try {
          const raw = typeof ev.data === 'string'
            ? ev.data
            : (ev.data?.text ? await ev.data.text() : '');
          if (!raw) return;
          const payload = JSON.parse(raw);
          handleTranscript(payload);
        } catch (e) {
          if (DEBUG) console.log('[PULSE][Phase4][Deepgram] message parse error', String(e));
        }
      };

      socket.onerror = () => {
        if (DEBUG) console.log('[PULSE][Phase4][Deepgram] socket error');
      };

      socket.onclose = (ev) => {
        if (DEBUG) console.log('[PULSE][Phase4][Deepgram] socket closed', { code: ev.code, reason: ev.reason });
        setListening(false);
        listeningRef.current = false;
        if (wantListeningRef.current && !suspendedRef.current) scheduleReconnect('socket-close');
      };
    } catch (e: any) {
      setError(e?.name || e?.message || 'deepgram-start-failed');
      if (DEBUG) console.log('[PULSE][Phase4][Deepgram] start failed', e?.message || e);
    }
  }, [scheduleReconnect, handleTranscript, DEBUG]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const stop = useCallback(() => {
    try {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      suspendedRef.current = true;
      wantListeningRef.current = false;
      recorderRef.current?.stop?.();
      recorderRef.current = null;
      socketRef.current?.close?.();
      socketRef.current = null;
      streamRef.current?.getTracks?.().forEach(t => t.stop());
      streamRef.current = null;
      setListening(false);
      listeningRef.current = false;
      if (DEBUG) console.log('[PULSE][Phase4][Deepgram] stopped');
    } catch {
      if (DEBUG) console.log('[PULSE][Phase4][Deepgram] stop failed');
    }
  }, [DEBUG]);

  const getLast60s = useCallback(() => {
    const cutoff = Date.now() - 60_000;
    return chunksRef.current.filter(c => c.ts >= cutoff).map(c => c.text).join(' ');
  }, []);

  return useMemo(() => ({
    supported,
    listening,
    liveText,
    finalText,
    error,
    start,
    stop,
    getLast60s,
  }), [supported, listening, liveText, finalText, error, start, stop, getLast60s]);
}
