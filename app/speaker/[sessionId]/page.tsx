'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import DashboardNav from '@/components/DashboardNav';
import InterventionCard from '@/components/InterventionCard';
import useSpeechTranscript from '@/lib/useSpeechTranscript';
import FloatingReactions, { type FloatingReaction } from '@/components/FloatingReactions';
import { useSpacetimeSession } from '@/lib/useSpacetimeSession';
import { useTheme } from '@/lib/useTheme';
import SessionReport from '@/components/SessionReport';

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
  const { dark, setDark } = useTheme(true);
  const transcript = useSpeechTranscript();
  const [micEnabled, setMicEnabled] = useState(false);
  const [aiPausedUntil, setAiPausedUntil] = useState(0);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captionsExpanded, setCaptionsExpanded] = useState(false);
  const [transcriptHistory, setTranscriptHistory] = useState<{ text: string; startTs: number }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const reactionId = useRef(0);
  // Coach report
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachReport, setCoachReport] = useState<any | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);
  const DEBUG = true;

  const countsRef = useRef(counts);
  const aiMsgRef = useRef(aiMsg);
  const aiPausedUntilRef = useRef(aiPausedUntil);
  const cooldownUntilRef = useRef(0);
  const lastCaptionRef = useRef('');
  const lastCaptionSentAt = useRef(0);
  const spacetime = useSpacetimeSession(sessionId);
  const captionsRef = useRef<any[]>([]);
  const summaryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSummaryEndRef = useRef(0);
  const runSummaryRef = useRef<(() => Promise<void>) | null>(null);
  // Local rolling buffer — persists across SpacetimeDB reconnects
  const [localCaptions, setLocalCaptions] = useState<{ id: string; text: string; ts: number }[]>([]);
  const localCaptionsRef = useRef<{ id: string; text: string; ts: number }[]>([]);

  const transcriptLive = transcript.listening;

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
    captionsRef.current = spacetime.captions || [];
  }, [spacetime.captions]);

  useEffect(() => {
    localCaptionsRef.current = localCaptions;
  }, [localCaptions]);

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
    if (!sessionStarted || !micEnabled) return;
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
      // Keep a local copy so expand history works regardless of SpacetimeDB subscription state
      setLocalCaptions(prev => [...prev.slice(-200), { id, text: finalText, ts: now }]);
      if (DEBUG) console.log('[PULSE][Phase3][Caption] submit', finalText.slice(0, 80));
    } catch (e) {
      if (DEBUG) console.log('[PULSE][Phase3][Caption] submit failed', String(e));
    }
  }, [sessionId, sessionStarted, micEnabled, transcript.finalText, spacetime.reducers, DEBUG]);

  // Every 60s, summarize the last 60s of captions via Gemini
  useEffect(() => {
    if (!sessionId || !sessionStarted || sessionEnded) return;

    const runSummary = async (flush = false) => {
      try {
        const now = Date.now();
        const windowEnd = now;
        // On flush: cover everything since last summary; otherwise last 60s
        const windowStart = flush
          ? (lastSummaryEndRef.current > 0 ? lastSummaryEndRef.current : now - 3_600_000)
          : now - 60_000;

        // Use localCaptionsRef — reliable buffer that survives SpacetimeDB reconnects
        const captions = (localCaptionsRef.current || [])
          .filter(c => c.ts >= windowStart && c.ts <= windowEnd && c.text);

        if (captions.length === 0) {
          if (DEBUG) console.log('[PULSE][Phase4][Summary] no captions in window', { flush, windowStart, windowEnd });
          return;
        }

        const newestTs = Math.max(...captions.map(c => c.ts));
        if (newestTs <= lastSummaryEndRef.current) {
          if (DEBUG) console.log('[PULSE][Phase4][Summary] no new captions since last summary');
          return;
        }

        const transcriptText = captions
          .sort((a, b) => a.ts - b.ts)
          .map(c => c.text.trim())
          .filter(Boolean)
          .join(' ')
          .trim();

        if (transcriptText.length < 20) {
          if (DEBUG) console.log('[PULSE][Phase4][Summary] transcript too short', transcriptText.length);
          return;
        }

        lastSummaryEndRef.current = windowEnd;

        if (DEBUG) console.log('[PULSE][Phase4][Summary] window', {
          flush,
          sessionId,
          chars: transcriptText.length,
          captions: captions.length,
          windowStart,
          windowEnd,
        });

        await fetch('/api/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            windowStart,
            windowEnd,
            transcript: transcriptText,
            signals: countsRef.current,
          }),
        });
      } catch (e) {
        if (DEBUG) console.log('[PULSE][Phase4][Summary] failed', String(e));
      }
    };

    // Expose flush fn on ref so session-end effect can call it
    runSummaryRef.current = () => runSummary(true);

    const timeoutId = setTimeout(() => {
      runSummary();
      summaryTimerRef.current = setInterval(runSummary, 60_000);
    }, 60_000);

    return () => {
      clearTimeout(timeoutId);
      if (summaryTimerRef.current) clearInterval(summaryTimerRef.current);
      summaryTimerRef.current = null;
    };
  }, [sessionId, sessionStarted, sessionEnded, DEBUG]);

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

  // Poll server every 10s to get TTL-filtered counts (clears expired signals)
  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/signals?sessionId=${sessionId}&snapshot=1`);
        if (res.ok) {
          const data = await res.json();
          // data is array of raw signals — build counts from only recent ones
          const cutoff = Date.now() - 45_000;
          const fresh = (data as any[]).filter((s: any) => s.ts >= cutoff && s.isPrimary !== false);
          const counts: Record<string, number> = { confused: 0, clear: 0, question: 0, excited: 0, slow_down: 0 };
          for (const s of fresh) counts[s.signalType] = (counts[s.signalType] ?? 0) + 1;
          setCounts(counts);
        }
      } catch {}
    }, 10_000);
    return () => clearInterval(interval);
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

  useEffect(() => {
    if (!sessionEnded || !sessionId) return;
    setCaptionsExpanded(true);

    // Compile coach report — fetch transcript FIRST (before coach deletes SegmentSummary)
    setCoachLoading(true);
    setCoachError(null);

    const compileReport = async () => {
      // Flush any captions not yet summarised
      if (runSummaryRef.current) {
        try { await runSummaryRef.current(); } catch {}
      }
      await new Promise(r => setTimeout(r, 800));

      // Fetch transcript while SegmentSummary still exists (before /api/coach deletes them)
      setHistoryLoading(true);
      try {
        const res = await fetch(`/api/transcript?sessionId=${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.chunks?.length) {
            setTranscriptHistory(
              data.chunks
                .filter((c: any) => c.text || c.preview)
                .map((c: any) => ({ text: c.text || c.preview, startTs: c.startTs }))
            );
          } else if (data.fullText) {
            setTranscriptHistory([{ text: data.fullText, startTs: 0 }]);
          }
        }
      } catch {} finally { setHistoryLoading(false); }

      try {
        const res = await fetch('/api/coach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json();
        if (data?.report) {
          setCoachReport(data.report);
        } else {
          setCoachError(data?.error || 'No report generated');
        }
      } catch {
        setCoachError('Failed to load coach report');
      } finally {
        setCoachLoading(false);
      }
    };
    compileReport();
  }, [sessionEnded, sessionId]);

  const roomState = getRoomState(counts);
  const cfg       = ROOM_CONFIG[roomState];
  const total     = Object.values(counts).reduce((a, b) => a + b, 0);

  const bg = dark ? 'bg-black text-white' : 'bg-white text-black';
  const subText = dark ? 'text-white/30' : 'text-black/70';
  const whisper = dark ? 'bg-white/5 border-white/10 text-white/70' : 'bg-black/5 border-black/10 text-black/80';
  const bottomText = dark ? 'text-white/20' : 'text-black/50';
  const bottomSub = dark ? 'text-white/30' : 'text-black/60';
  const aiPaused = Date.now() < aiPausedUntil;
  const captionPanel = dark ? 'bg-white/5 border-white/10 text-white/80' : 'bg-black/5 border-black/10 text-black/70';
  const captionMuted = dark ? 'text-white/40' : 'text-black/40';
  // Merge SpacetimeDB captions with local buffer — local buffer is the source of truth
  const captionHistory = (() => {
    const stMap = new Map<string, { id: string; text: string; ts: number }>();
    for (const c of (spacetime.captions || [])) {
      stMap.set(c.id, { id: c.id, text: c.text, ts: Number(c.createdAt ?? 0) });
    }
    for (const c of localCaptions) stMap.set(c.id, c);
    return [...stMap.values()].sort((a, b) => a.ts - b.ts).slice(-200);
  })();

  return (
    <div className={`min-h-screen flex flex-col select-none transition-colors duration-200 ${bg}`}>
      <FloatingReactions reactions={reactions} />

      <DashboardNav
        sessionId={sessionId}
        mode="speaker"
        dark={dark}
        onToggleDark={() => setDark(!dark)}
        signalCount={total}
        transcriptLive={transcriptLive}
        confirmEnd={confirmEnd}
        sessionActive={sessionStarted && !sessionEnded}
        micSupported={transcript.supported}
        micEnabled={micEnabled}
        micDevices={transcript.devices}
        selectedMicDeviceId={transcript.selectedDeviceId}
        onSwitchMicDevice={transcript.switchDevice}
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
          if (!confirmEnd) {
            setConfirmEnd(true);
            setTimeout(() => setConfirmEnd(false), 4000); // auto-cancel after 4s
            return;
          }
          setConfirmEnd(false);
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

      <InterventionCard sessionId={sessionId} dark={dark} />

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
                await fetch('/api/session/end', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId, reactivate: true }),
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

        {/* Coach report — loading screen then cards */}
        {sessionEnded && coachLoading && (
          <div className="flex flex-col items-center gap-3 mt-2">
            <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-white/70 animate-spin" />
            <span className={`text-xs ${subText}`}>Generating coaching report…</span>
          </div>
        )}

        {sessionEnded && !coachLoading && coachError && (
          <div className={`text-xs mt-2 ${subText}`}>{coachError}</div>
        )}

        {sessionEnded && !coachLoading && coachReport && (
          <SessionReport
            coachReport={coachReport}
            dark={dark}
            captionMuted={captionMuted}
          />
        )}
        {!sessionEnded && (
          <>
            <div className={`w-40 h-40 rounded-full flex items-center justify-center ring-4 transition-all duration-700 ${cfg.bg} ${cfg.ring}`}>
              <div className="flex flex-col items-center gap-1 text-center">
                <span className={`text-lg font-semibold transition-colors duration-700 ${cfg.color}`}>
                  {cfg.label}
                </span>
              </div>
            </div>
            <p className={`text-sm ${subText}`}>{cfg.sub}</p>
          </>
        )}

        {sessionStarted && captionsEnabled && !sessionEnded && (
          <div className={`mt-6 w-full max-w-xl border rounded-2xl px-4 py-3 ${captionPanel}`}>
            <div className="flex items-center justify-between gap-3">
              <span className={`text-[11px] uppercase tracking-widest font-medium ${captionMuted}`}>
                Live captions
              </span>
              <button
                onClick={async () => {
                  const next = !captionsExpanded;
                  setCaptionsExpanded(next);
                  if (next && sessionId) {
                    setHistoryLoading(true);
                    try {
                      const res = await fetch(`/api/transcript?sessionId=${sessionId}`);
                      if (res.ok) {
                        const data = await res.json();
                        if (data.chunks?.length) {
                          setTranscriptHistory(
                            data.chunks
                              .filter((c: any) => c.text || c.preview)
                              .map((c: any) => ({ text: c.text || c.preview, startTs: c.startTs }))
                          );
                        } else if (data.fullText) {
                          setTranscriptHistory([{ text: data.fullText, startTs: 0 }]);
                        }
                      }
                    } catch {}
                    setHistoryLoading(false);
                  }
                }}
                className={`text-[10px] uppercase tracking-widest ${captionMuted} hover:opacity-80`}
              >
                {captionsExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
            <div className="mt-2 text-sm">
              {transcript.liveText || 'Listening…'}
            </div>
            {transcript.error && (
              <div className="mt-2 text-[11px] text-red-400">
                Transcription error: {transcript.error}. Toggle Mic to retry.
              </div>
            )}
            {captionsExpanded && (
              <div className={`mt-3 max-h-44 overflow-y-auto text-xs ${captionMuted}`}>
                {historyLoading && <div className="py-2 opacity-60">Loading…</div>}
                {!historyLoading && transcriptHistory.length === 0 && captionHistory.length === 0 && (
                  <div className="py-2">No captions yet.</div>
                )}
                {!historyLoading && transcriptHistory.length > 0 && (
                  <>
                    <div className="py-1 opacity-40 text-[10px] uppercase tracking-widest">Transcript history</div>
                    {transcriptHistory.map((seg, i) => (
                      <div key={i} id={`caption-ts-${seg.startTs}`} className="py-1 border-b border-white/5 last:border-b-0">
                        {seg.startTs > 0 && (
                          <span className="opacity-60 mr-2">
                            {new Date(seg.startTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                        <span>{seg.text}</span>
                      </div>
                    ))}
                  </>
                )}
                {!historyLoading && captionHistory.length > 0 && (
                  <>
                    <div className="py-1 opacity-40 text-[10px] uppercase tracking-widest mt-1">Live captions</div>
                    {captionHistory.map((c: any) => {
                      const ts = Number(c.ts ?? 0);
                      const time = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : '';
                      return (
                        <div key={c.id} className="py-1 border-b border-white/5 last:border-b-0">
                          <span className="opacity-60">{time}</span>
                          <span className="ml-2">{c.text}</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Signal cards — only shown when count > 0, colored by intensity */}
        {total > 0 && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex flex-wrap justify-center gap-2 max-w-xs">
              {([
                { key: 'confused',  emoji: '😕', label: 'Confused',   danger: true  },
                { key: 'slow_down', emoji: '🐢', label: 'Too fast',   danger: true  },
                { key: 'question',  emoji: '✋', label: 'Question',   danger: false },
                { key: 'clear',     emoji: '✅', label: 'Clear',      danger: false },
                { key: 'excited',   emoji: '🔥', label: 'Excited',    danger: false },
              ] as const).map(({ key, emoji, label, danger }) => {
                const count = counts[key] ?? 0;
                if (count === 0) return null;
                const pct = total > 0 ? count / total : 0;
                const intensity = danger
                  ? pct >= 0.5 ? 'bg-red-500/80 text-white ring-red-400/40'
                    : pct >= 0.25 ? 'bg-orange-400/70 text-white ring-orange-400/30'
                    : dark ? 'bg-white/10 text-white/70 ring-white/10' : 'bg-black/8 text-black ring-black/15'
                  : pct >= 0.5 ? 'bg-emerald-500/70 text-white ring-emerald-400/30'
                    : dark ? 'bg-white/10 text-white/70 ring-white/10' : 'bg-black/8 text-black ring-black/15';
                return (
                  <div key={key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ring-1 text-xs font-medium transition-all duration-500 ${intensity}`}>
                    <span>{emoji}</span>
                    <span>{count}</span>
                    <span className="opacity-70">{label}</span>
                    <span className="opacity-50 text-[10px]">{Math.round(pct * 100)}%</span>
                  </div>
                );
              })}
            </div>
            {/* Clear signals button */}
            <button
              onClick={async () => {
                await fetch(`/api/signals?sessionId=${sessionId}`, { method: 'DELETE' });
                setCounts({ confused: 0, clear: 0, question: 0, excited: 0, slow_down: 0 });
              }}
              className={`text-[10px] uppercase tracking-widest transition-colors ${dark ? 'text-white/20 hover:text-white/50' : 'text-black/20 hover:text-black/50'}`}
            >
              Clear signals
            </button>
          </div>
        )}

        {/* AI whisper — appears only when intervention fires */}
        {aiMsg && (
          <div className={`mt-4 max-w-xs text-center px-5 py-3 rounded-xl border text-sm animate-fade-in ${whisper}`}>
            {aiMsg}
          </div>
        )}
      </div>

      {/* Audience join link — bottom */}
      <div className="flex flex-col items-center gap-1 pb-6">
        <span className={`text-[11px] uppercase tracking-widest ${bottomText}`}>Audience</span>
        <span className={`text-xs font-mono ${bottomSub}`}>/audience/{sessionId}</span>
        <span className={`text-[10px] font-mono mt-0.5 ${bottomText}`}>Primary judge: /audience/{sessionId}?primary=1</span>
      </div>
    </div>
  );
}
