'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import DashboardNav from '@/components/DashboardNav';
import InterventionCard from '@/components/InterventionCard';
import useSpeechTranscript from '@/lib/useSpeechTranscript';
import useAudioRecorder from '@/lib/useAudioRecorder';
import VoicePlayer from '@/components/VoicePlayer';
import FloatingReactions, { type FloatingReaction } from '@/components/FloatingReactions';
import { useSpacetimeSession } from '@/lib/useSpacetimeSession';

// Room state distilled to a single ambient signal
type RoomState = 'good' | 'check' | 'confused' | 'fast' | 'slow';

type SignalKey = 'confused' | 'clear' | 'excited' | 'slow_down' | 'question';

const SIGNAL_EMOJI: Record<SignalKey, string> = {
  confused:  '😕',
  clear:     '✅',
  excited:   '🔥',
  slow_down: '🐢',
  question:  '✋',
};

function getRoomState(counts: Record<string, number>): RoomState {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total < 3) return 'good';

  const confused   = counts['confused']  ?? 0;
  const slow_down  = counts['slow_down'] ?? 0;
  const excited    = counts['excited']   ?? 0;

  const confusionRate = confused / total;
  if (confusionRate >= 0.4) return 'confused';

  const paceSignals = slow_down + excited;
  if (paceSignals >= 3) {
    const fastRate = slow_down / paceSignals;
    if (fastRate > 0.65) return 'fast';
    if (fastRate < 0.35) return 'slow';
  }

  if (confusionRate >= 0.2) return 'check';
  return 'good';
}

const ROOM_CONFIG: Record<RoomState, { color: string; bg: string; ring: string; label: string; sub: string }> = {
  good:     { color: 'text-emerald-400', bg: 'bg-emerald-400/10', ring: 'ring-emerald-400/30', label: "You're good",        sub: 'Room is with you'          },
  check:    { color: 'text-yellow-400',  bg: 'bg-yellow-400/10',  ring: 'ring-yellow-400/30',  label: 'Check in',           sub: 'Some confusion building'   },
  confused: { color: 'text-red-400',     bg: 'bg-red-400/10',     ring: 'ring-red-400/30',     label: 'Pause & clarify',    sub: 'Room is confused'          },
  fast:     { color: 'text-orange-400',  bg: 'bg-orange-400/10',  ring: 'ring-orange-400/30',  label: 'Slow down',          sub: 'Pace is too fast'          },
  slow:     { color: 'text-blue-400',    bg: 'bg-blue-400/10',    ring: 'ring-blue-400/30',    label: 'Pick up the pace',   sub: 'Room wants more'           },
};

export default function SpeakerView() {
  const params    = useParams();
  const sessionId = params?.sessionId as string;

  const [session,  setSession]  = useState<{ speakerName: string; topic: string } | null>(null);
  const [counts,   setCounts]   = useState<Record<string, number>>({ confused: 0, clear: 0, question: 0, excited: 0, slow_down: 0 });
  const [mounted,  setMounted]  = useState(false);
  const [aiMsg,    setAiMsg]    = useState<string | null>(null);
  const [dark,     setDark]     = useState(true);
  const transcript = useSpeechTranscript();
  const [micEnabled, setMicEnabled] = useState(false);
  const [aiPausedUntil, setAiPausedUntil] = useState(0);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [ttsAudioBase64, setTtsAudioBase64] = useState<string | null>(null);
  const [ttsContentType, setTtsContentType] = useState<string | null>(null);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const reactionId = useRef(0);
  const DEBUG = true;

  const countsRef = useRef(counts);
  const aiMsgRef = useRef(aiMsg);
  const aiPausedUntilRef = useRef(aiPausedUntil);
  const cooldownUntilRef = useRef(0);
  const lastCaptionRef = useRef('');
  const lastCaptionSentAt = useRef(0);
  const lastFlushedTextRef = useRef('');
  const [transcriptLive, setTranscriptLive] = useState(false);

  const spacetime = useSpacetimeSession(sessionId);

  const audioRecorder = useAudioRecorder({
    sessionId,
    enabled: sessionStarted && micEnabled,
    chunkMs: 60_000,
    onUploaded: (id) => {
      if (DEBUG) console.log('[PULSE][Phase3][Audio] stored chunk', id);
    },
  });

  useEffect(() => {
    if (!audioRecorder.supported && DEBUG) {
      console.log('[PULSE][Phase3][Audio] MediaRecorder not supported');
    }
  }, [audioRecorder.supported]);

  useEffect(() => {
    if (audioRecorder.lastError && DEBUG) {
      console.log('[PULSE][Phase3][Audio] error', audioRecorder.lastError);
    }
  }, [audioRecorder.lastError]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    // Keep refs in sync for a stable interval callback.
    countsRef.current = counts;
  }, [counts]);

  useEffect(() => {
    aiMsgRef.current = aiMsg;
  }, [aiMsg]);

  useEffect(() => {
    aiPausedUntilRef.current = aiPausedUntil;
  }, [aiPausedUntil]);

  useEffect(() => {
    // Always stop recognition on unmount.
    return () => { try { transcript.stop(); } catch {} };
  }, [transcript.stop]);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/session?sessionId=${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setSession({ speakerName: d.speakerName, topic: d.topic });
        if (d.active === false) setSessionEnded(true);
      });
  }, [sessionId]);

  // Push final captions into SpacetimeDB (throttled)
  useEffect(() => {
    if (!sessionStarted || !captionsEnabled) return;
    const finalText = transcript.finalText?.trim?.() || '';
    if (!finalText || finalText === lastCaptionRef.current) return;
    const now = Date.now();
    if (now - lastCaptionSentAt.current < 1500) return;

    if (!spacetime.reducers?.submitCaption) {
      if (DEBUG) console.log('[PULSE][Phase3][Caption] reducer not ready');
      return;
    }

    lastCaptionRef.current = finalText;
    lastCaptionSentAt.current = now;

    try {
      const id = `${sessionId}:${now}`;
      spacetime.reducers?.submitCaption?.(id, finalText);
      if (DEBUG) console.log('[PULSE][Phase3][Caption] submit', finalText.slice(0, 80));
    } catch (e) {
      if (DEBUG) console.log('[PULSE][Phase3][Caption] submit failed', String(e));
    }
  }, [sessionId, sessionStarted, captionsEnabled, transcript.finalText, spacetime.reducers, DEBUG]);

  // 20s transcript flush → MongoDB
  useEffect(() => {
    if (!sessionId || !sessionStarted) return;
    const interval = setInterval(async () => {
      const text = transcript.getLast60s().trim();
      if (!text || text === lastFlushedTextRef.current) return;
      lastFlushedTextRef.current = text;
      try {
        await fetch('/api/transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, text, ts: Date.now() }),
        });
        setTranscriptLive(true);
        if (DEBUG) console.log('[PULSE][R1][Transcript] flushed', text.length, 'chars');
      } catch (e) {
        if (DEBUG) console.log('[PULSE][R1][Transcript] flush failed', String(e));
      }
    }, 20_000);
    return () => clearInterval(interval);
  }, [sessionId, sessionStarted, transcript]);

  // SSE — live signal counts + floating reactions
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/signals?sessionId=${sessionId}&sse=1`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'snapshot') {
          setCounts(prev => ({ ...prev, ...msg.counts }));
        } else if (msg.type === 'signal') {
          const key = msg.signal.signalType as string;
          setCounts(prev => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
          
          // Add floating reaction
          const emoji = SIGNAL_EMOJI[key as SignalKey];
          if (emoji) {
            const id = ++reactionId.current;
            const x = 10 + Math.random() * 80;
            setReactions(prev => [...prev.slice(-20), { id, emoji, x }]);
            setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 2200);
          }
        } else if (msg.type === 'intervention') {
          setAiMsg(msg.message ?? null);
          setTimeout(() => setAiMsg(null), 8000);
          if (DEBUG) console.log('[PULSE][Phase3][SSE] intervention', msg);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [sessionId]);

  // Periodic AI intervention check — every 8s, guarded by simple local checks
  useEffect(() => {
    if (!sessionId || !sessionStarted || sessionEnded) return;
    const interval = setInterval(async () => {
      try {
        // Guards: AI paused, cooldown, or intervention currently visible
        if (Date.now() < aiPausedUntilRef.current) return;
        if (Date.now() < cooldownUntilRef.current) return;
        if (aiMsgRef.current) return;

        const curCounts = countsRef.current;
        const roomState = getRoomState(curCounts);
        if (roomState === 'good') return;

        const last60 = transcript.getLast60s();
        const confused = curCounts['confused'] ?? 0;
        const hasTranscript = !!last60 && last60.length >= 20;
        if (!hasTranscript && confused < 2) return;

        const res = await fetch('/api/intervene', {
          method: 'POST',
          body: JSON.stringify({
            sessionId,
            transcript: last60,
            signals: curCounts,
            enableTts: true,
          }),
          headers: { 'Content-Type': 'application/json' },
        });

        if (res.status === 429) {
          const d = await res.json().catch(() => ({} as any));
          const retryAfterSec = typeof d?.retryAfter === 'number' ? d.retryAfter : 15;
          cooldownUntilRef.current = Date.now() + retryAfterSec * 1000;
          return;
        }
        if (res.status === 409) {
          // pending ack / ended — back off a bit
          cooldownUntilRef.current = Date.now() + 15_000;
          return;
        }
        if (res.ok) {
          const data = await res.json().catch(() => null) as any;
          if (DEBUG) console.log('[PULSE][Phase3][Intervene] ok', data?.intervention?.id);
          if (data?.ttsAudioBase64) {
            setTtsAudioBase64(data.ttsAudioBase64);
            setTtsContentType(data.ttsContentType || 'audio/mpeg');
          }
          // Match server cooldown to avoid hammering
          cooldownUntilRef.current = Date.now() + 90_000;
        } else {
          cooldownUntilRef.current = Date.now() + 15_000;
        }
      } catch (e) {
        // ignore
      }
    }, 8_000);

    return () => { clearInterval(interval); };
  }, [sessionId, sessionStarted, sessionEnded, transcript]);

  if (!mounted) return null;

  const roomState = getRoomState(counts);
  const cfg       = ROOM_CONFIG[roomState];
  const total     = Object.values(counts).reduce((a, b) => a + b, 0);

  const bg = dark ? 'bg-black text-white' : 'bg-white text-black';
  const subText = dark ? 'text-white/30' : 'text-black/30';
  const whisper = dark ? 'bg-white/5 border-white/10 text-white/70' : 'bg-black/5 border-black/10 text-black/60';
  const bottomText = dark ? 'text-white/20' : 'text-black/20';
  const bottomSub = dark ? 'text-white/30' : 'text-black/30';
  const aiPaused = Date.now() < aiPausedUntil;

  return (
    <div className={`min-h-screen flex flex-col select-none transition-colors duration-200 ${bg}`}>
      <FloatingReactions reactions={reactions} />

      <DashboardNav
        sessionId={sessionId}
        mode="speaker"
        dark={dark}
        onToggleDark={() => setDark(v => !v)}
        signalCount={total}
        transcriptLive={transcriptLive}
        micSupported={transcript.supported}
        micEnabled={micEnabled}
        onToggleMic={async () => {
          if (!sessionStarted) {
            if (DEBUG) console.log('[PULSE][Phase3][Mic] start session first');
            return;
          }
          if (!transcript.supported) return;
          if (micEnabled) {
            try { transcript.stop(); } catch {}
            setMicEnabled(false);
            if (DEBUG) console.log('[PULSE][Phase3][Mic] off');
            return;
          }
          try {
            transcript.start();
            setMicEnabled(true);
            if (DEBUG) console.log('[PULSE][Phase3][Mic] on');
          } catch {
            setMicEnabled(false);
          }
        }}
        aiPaused={aiPaused}
        onToggleAiPause={() => {
          if (!sessionStarted) {
            if (DEBUG) console.log('[PULSE][Phase3][AI] start session first');
            return;
          }
          if (aiPaused) setAiPausedUntil(0);
          else setAiPausedUntil(Date.now() + 120_000);
          if (DEBUG) console.log('[PULSE][Phase3][AI] pause toggled', !aiPaused);
        }}
        captionsEnabled={captionsEnabled}
        onToggleCaptions={() => {
          if (!sessionStarted) {
            if (DEBUG) console.log('[PULSE][Phase3][Captions] start session first');
            return;
          }
          setCaptionsEnabled(v => !v);
          if (DEBUG) console.log('[PULSE][Phase3][Captions] toggle');
        }}
        onEndSession={async () => {
          if (!sessionStarted) return;
          if (!confirm('End the session now?')) return;
          try {
            await fetch('/api/session/end', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId }),
            });
            try { spacetime.reducers?.endSession?.(); } catch {}
            setSessionEnded(true);
            setSessionStarted(false);
            setMicEnabled(false);
            setCaptionsEnabled(false);
            try { transcript.stop(); } catch {}
            if (DEBUG) console.log('[PULSE][Phase3][Session] ended');
          } catch (e) {
            if (DEBUG) console.log('[PULSE][Phase3][Session] end failed', String(e));
          }
        }}
      />

      <InterventionCard sessionId={sessionId} />

      <VoicePlayer
        text={null}
        audioBase64={ttsAudioBase64}
        audioContentType={ttsContentType}
        enabled={sessionStarted}
        onDone={() => {
          setTtsAudioBase64(null);
          setTtsContentType(null);
        }}
      />

      {/* Single ambient indicator */}
      <div className="flex flex-col items-center justify-center flex-1 gap-6">
        {!sessionStarted && !sessionEnded && (
          <button
            onClick={() => {
              setSessionStarted(true);
              setCaptionsEnabled(true);
              if (DEBUG) console.log('[PULSE][Phase3][Session] started');
              try {
                transcript.start();
                setMicEnabled(true);
              } catch {
                setMicEnabled(false);
              }
            }}
            className="px-6 py-3 rounded-full bg-white/90 text-black text-sm font-semibold shadow cursor-pointer"
          >
            Start Session
          </button>
        )}
        {sessionEnded && (
          <button
            onClick={async () => {
              try {
                await fetch('/api/session/start', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId }),
                });
              } catch {}
              setSessionEnded(false);
              setSessionStarted(true);
              setCaptionsEnabled(true);
              setAiMsg(null);
              if (DEBUG) console.log('[PULSE][Phase3][Session] restarted');
              try {
                transcript.start();
                setMicEnabled(true);
              } catch {
                setMicEnabled(false);
              }
            }}
            className="px-6 py-3 rounded-full bg-white/90 text-black text-sm font-semibold shadow cursor-pointer"
          >
            Restart Session
          </button>
        )}
        {sessionEnded && (
          <div className="px-4 py-2 rounded-full border border-red-400 text-red-500 text-xs uppercase tracking-widest">
            Session Ended
          </div>
        )}
        <div className={`w-40 h-40 rounded-full flex items-center justify-center ring-4 transition-all duration-700 ${cfg.bg} ${cfg.ring}`}>
          <div className="flex flex-col items-center gap-1 text-center">
            <span className={`text-lg font-semibold transition-colors duration-700 ${cfg.color}`}>
              {cfg.label}
            </span>
          </div>
        </div>
        <p className={`text-sm ${subText}`}>{cfg.sub}</p>

        {/* AI whisper — appears only when intervention fires */}
        {aiMsg && (
          <div className={`mt-4 max-w-xs text-center px-5 py-3 rounded-xl border text-sm animate-fade-in ${whisper}`}>
            {aiMsg}
          </div>
        )}
      </div>

      {/* Live captions */}
      {sessionStarted && captionsEnabled && (
        <div className={`px-6 pb-3 text-center text-sm ${bottomSub}`}>
          {transcript.liveText || 'Listening…'}
          {transcript.error && (
            <div className="mt-1 text-[11px] text-red-400">
              Speech error: {transcript.error}. Toggle Mic to retry.
            </div>
          )}
        </div>
      )}

      {sessionStarted && (
        <div className={`px-6 pb-2 text-center text-[11px] ${bottomSub}`}>
          Audio chunk: {audioRecorder.lastFileId || 'waiting…'}
        </div>
      )}

      {/* Audience join link — bottom */}
      <div className="flex flex-col items-center gap-1 pb-6">
        <span className={`text-[11px] uppercase tracking-widest ${bottomText}`}>Audience</span>
        <span className={`text-xs font-mono ${bottomSub}`}>/audience/{sessionId}</span>
      </div>
    </div>
  );
}
