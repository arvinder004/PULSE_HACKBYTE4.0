"use client";

import { useEffect, useRef, useState } from 'react';

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
  const chunksRef = useRef<TranscriptChunk[]>([]);
  const recognitionRef = useRef<any>(null);
  const listeningRef = useRef(false);
  const DEBUG = true;

  useEffect(() => {
    const win = typeof window !== 'undefined' ? (window as any) : null;
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

    r.onstart = () => {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] onstart');
    };

    r.onresult = (ev: any) => {
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
      if ((final + interim).trim()) setLiveText((final + interim).trim());
    };

    r.onerror = (ev: any) => {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] error', ev?.error || ev?.message || ev);
    };

    r.onend = () => {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] onend');
      if (listeningRef.current) {
        // Auto-restart to keep captions alive
        setTimeout(() => {
          try { r.start(); } catch {}
        }, 250);
      }
    };
    recognitionRef.current = r;

    return () => {
      try { recognitionRef.current?.stop?.(); } catch {}
      recognitionRef.current = null;
    };
  }, []);

  function start() {
    try {
      recognitionRef.current?.start?.();
      setListening(true);
      listeningRef.current = true;
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] start');
    } catch {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] start failed');
    }
  }

  function stop() {
    try {
      recognitionRef.current?.stop?.();
      setListening(false);
      listeningRef.current = false;
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] stop');
    } catch {
      if (DEBUG) console.log('[PULSE][Phase3][Transcript] stop failed');
    }
  }

  function getLast60s() {
    const cutoff = Date.now() - 60_000;
    return chunksRef.current.filter(c => c.ts >= cutoff).map(c => c.text).join(' ');
  }

  return { supported, listening, liveText, finalText, start, stop, getLast60s } as const;
}
