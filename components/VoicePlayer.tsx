"use client";

import { useEffect, useRef } from 'react';

type VoicePlayerProps = {
  text: string | null;
  audioBase64?: string | null;
  audioContentType?: string | null;
  enabled?: boolean;
  onDone?: () => void;
};

export default function VoicePlayer({ text, audioBase64 = null, audioContentType = null, enabled = true, onDone }: VoicePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastTextRef = useRef<string | null>(null);
  const lastAudioRef = useRef<string | null>(null);
  const DEBUG = true;

  useEffect(() => {
    if (!enabled) return;

    if (audioBase64 && audioBase64 !== lastAudioRef.current) {
      lastAudioRef.current = audioBase64;
      const dataUrl = `data:${audioContentType || 'audio/mpeg'};base64,${audioBase64}`;
      if (audioRef.current) {
        audioRef.current.src = dataUrl;
        audioRef.current.play().then(() => {
          if (DEBUG) console.log('[PULSE][Phase3][Voice] play base64');
        }).catch(() => {
          if (DEBUG) console.log('[PULSE][Phase3][Voice] play base64 failed');
        });
      }
      return;
    }

    if (!text) return;
    if (lastTextRef.current === text) return;

    lastTextRef.current = text;
    let url: string | null = null;
    const controller = new AbortController();

    async function run() {
      try {
        if (DEBUG) console.log('[PULSE][Phase3][Voice] request TTS', text!.slice(0, 80));
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        if (!res.ok) {
          if (DEBUG) console.log('[PULSE][Phase3][Voice] TTS failed', res.status);
          return;
        }
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        if (audioRef.current) {
          audioRef.current.src = url;
          await audioRef.current.play();
          if (DEBUG) console.log('[PULSE][Phase3][Voice] play');
        }
      } catch (e: any) {
        if (DEBUG) console.log('[PULSE][Phase3][Voice] error', e?.message || e);
      }
    }

    run();

    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [text, enabled]);

  return (
    <audio
      ref={audioRef}
      onEnded={() => {
        if (DEBUG) console.log('[PULSE][Phase3][Voice] ended');
        onDone?.();
      }}
    />
  );
}
