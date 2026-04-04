"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type TranscriptChunk = { text: string; ts: number };

/**
 * Rolling 60s transcript buffer using the Web Speech API.
 * Browsers typically require a user gesture to start recognition.
 */
export default function useSpeechTranscript() {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const chunksRef = useRef<TranscriptChunk[]>([]);
  const recognitionRef = useRef<any>(null);
  const listeningRef = useRef(false);
  const suspendedRef = useRef(false);
  const errorCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const envLoggedRef = useRef(false);
  const micProbeRef = useRef(false);
  const DEBUG = true;

  useEffect(() => {
    const win = typeof window !== 'undefined' ? (window as any) : null;
    if (DEBUG && !envLoggedRef.current) {
      envLoggedRef.current = true;
      const conn = typeof navigator !== 'undefined' ? (navigator as any).connection : null;
      console.log('[PULSE][Phase3][Transcript] env', {
        secure: win?.isSecureContext,
        protocol: win?.location?.protocol,
        online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        connection: conn ? {
          effectiveType: conn.effectiveType,
          rtt: conn.rtt,
          downlink: conn.downlink,
          saveData: conn.saveData,
        } : undefined,
      });
      try {
        const perms = (navigator as any)?.permissions;
        if (perms?.query) {
          perms.query({ name: 'microphone' as PermissionName }).then((p: any) => {
            console.log('[PULSE][Phase3][Transcript] mic permission', p?.state);
            p.onchange = () => console.log('[PULSE][Phase3][Transcript] mic permission changed', p?.state);
          }).catch(() => {
            console.log('[PULSE][Phase3][Transcript] mic permission query failed');
          });
        }
        const devicesApi = (navigator as any)?.mediaDevices;
        if (devicesApi?.enumerateDevices) {
          devicesApi.enumerateDevices().then((devices: MediaDeviceInfo[]) => {
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            console.log('[PULSE][Phase3][Transcript] audio inputs', {
              count: audioInputs.length,
              labels: audioInputs.map(d => d.label || 'unknown'),
            });
          }).catch(() => {
            console.log('[PULSE][Phase3][Transcript] enumerateDevices failed');
          });
        }
      } catch {
        console.log('[PULSE][Phase3][Transcript] mic permission query failed');
      }
    }
    const SpeechRecognition = win?.webkitSpeechRecognition ?? win?.SpeechRecognition ?? null;
    if (!SpeechRecognition) {
      setSupported(false);
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] SpeechRecognition not supported');
      return;
    }

    const r = new SpeechRecognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    if (DEBUG) console.log('[PULSE][Phase3][Transcript] init', {
      continuous: r.continuous,
      interimResults: r.interimResults,
      lang: r.lang,
    });

    r.onstart = () => {
      suspendedRef.current = false;
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] onstart', {
        listening: listeningRef.current,
        suspended: suspendedRef.current,
        errors: errorCountRef.current,
      });
    };

    r.onaudiostart = () => {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] onaudiostart');
    };

    r.onaudioend = () => {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] onaudioend');
    };

    r.onsoundstart = () => {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] onsoundstart');
    };

    r.onsoundend = () => {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] onsoundend');
    };

    r.onspeechstart = () => {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] onspeechstart');
    };

    r.onspeechend = () => {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] onspeechend');
    };

    r.onnomatch = () => {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] onnomatch');
    };

    r.onresult = (ev: any) => {
      if (DEBUG) {
        console.log('[PULSE][Phase3][Transcript] result', {
          resultIndex: ev?.resultIndex,
          results: ev?.results?.length,
        });
      }
      const results = ev.results;
      let final = '';
      let interim = '';
      for (let i = ev.resultIndex; i < results.length; i++) {
        const res = results[i];
        const text = res[0]?.transcript ?? '';
        if (res.isFinal) final += text + ' ';
        else interim += text + ' ';
      }
      if (final.trim()) {
        chunksRef.current.push({ text: final.trim(), ts: Date.now() });
        const cutoff = Date.now() - 60_000;
        chunksRef.current = chunksRef.current.filter(c => c.ts >= cutoff);
        setFinalText(final.trim());
        if (DEBUG) console.log('[PULSE][Phase3][Transcript] final chunk', final.trim().slice(0, 80));
      }
      if ((final + interim).trim()) {
        if (error) setError(null);
        errorCountRef.current = 0;
        setLiveText((final + interim).trim());
      }
    };

    r.onerror = (ev: any) => {
      const code = (ev?.error || ev?.message || 'unknown') as string;
      if (!listeningRef.current || suspendedRef.current) {
        if (DEBUG) console.log('[PULSE][Phase3][Transcript] error ignored (not listening)', code);
        return;
      }
      // Only surface fatal errors to the UI — network blips are silent auto-retries
      errorCountRef.current += 1;
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] error', { code, count: errorCountRef.current });

      // Fatal errors — mic permission denied, hardware missing, etc.
      const fatal = ['not-allowed', 'service-not-allowed', 'not-supported', 'audio-capture', 'bad-grammar', 'language-not-supported'];
      if (fatal.includes(code)) {
        setError(code);
        suspendedRef.current = true;
        listeningRef.current = false;
        setListening(false);
        if (DEBUG) console.log('[PULSE][Phase3][Transcript] suspended due to fatal error');
        return;
      }

      // Network / aborted errors — auto-retry silently, no UI error shown
      // Gemini handles the real transcription so a Web Speech blip doesn't matter
      const delay = Math.min(1000 * (2 ** Math.min(errorCountRef.current - 1, 4)), 10_000);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        if (!listeningRef.current || suspendedRef.current) return;
        errorCountRef.current = 0;
        try { r.start(); } catch {}
      }, delay);
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] silent retry in', delay, 'ms');
    };

    r.onend = () => {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] onend', {
        listening: listeningRef.current,
        suspended: suspendedRef.current,
        errors: errorCountRef.current,
      });
      if (listeningRef.current && !suspendedRef.current) {
        // Auto-restart to keep captions alive
        if (retryTimerRef.current) return;
        retryTimerRef.current = setTimeout(() => {
          try { r.start(); } catch {}
        }, 750);
      }
    };
    recognitionRef.current = r;

    return () => {
      try { recognitionRef.current?.stop?.(); } catch {}
      recognitionRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    try {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      suspendedRef.current = false;
      setError(null);
      errorCountRef.current = 0;
      recognitionRef.current?.start?.();
      setListening(true);
      listeningRef.current = true;
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] start', {
        hasRecognizer: !!recognitionRef.current,
        listening: listeningRef.current,
      });

      if (!micProbeRef.current && typeof navigator !== 'undefined') {
        micProbeRef.current = true;
        const mediaDevices = (navigator as any).mediaDevices;
        if (mediaDevices?.getUserMedia) {
          mediaDevices.getUserMedia({ audio: true }).then((stream: MediaStream) => {
            const track = stream.getAudioTracks()[0];
            console.log('[PULSE][Phase3][Transcript] mic probe ok', {
              label: track?.label,
              readyState: track?.readyState,
              muted: track?.muted,
              enabled: track?.enabled,
              settings: track?.getSettings?.(),
            });
            stream.getTracks().forEach(t => t.stop());
          }).catch((err: any) => {
            console.log('[PULSE][Phase3][Transcript] mic probe failed', err?.name || err?.message || err);
          });
        }
      }
    } catch {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] start failed');
    }
  }, []);

  const stop = useCallback(() => {
    try {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      suspendedRef.current = true;
      recognitionRef.current?.stop?.();
      setListening(false);
      listeningRef.current = false;
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] stop', {
        listening: listeningRef.current,
      });
    } catch {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] stop failed');
    }
  }, []);

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
