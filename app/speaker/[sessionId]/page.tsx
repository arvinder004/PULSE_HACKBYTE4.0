'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

// Room state distilled to a single ambient signal
type RoomState = 'good' | 'check' | 'confused' | 'fast' | 'slow';

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

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/session?sessionId=${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSession({ speakerName: d.speakerName, topic: d.topic }));
  }, [sessionId]);

  // SSE — live signal counts
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
        } else if (msg.type === 'intervention') {
          setAiMsg(msg.message ?? null);
          setTimeout(() => setAiMsg(null), 8000);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [sessionId]);

  if (!mounted) return null;

  const roomState = getRoomState(counts);
  const cfg       = ROOM_CONFIG[roomState];
  const total     = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center select-none">

      {/* Minimal header */}
      <div className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-6 border-b border-white/8">
        <span className="text-sm font-semibold tracking-tight">PULSE</span>
        <div className="flex items-center gap-4">
          <span className="text-xs text-white/30 font-mono">{session?.topic ?? sessionId}</span>
          <span className="text-xs text-white/20">{total} signals</span>
        </div>
      </div>

      {/* Single ambient indicator */}
      <div className="flex flex-col items-center gap-6">
        <div className={`w-40 h-40 rounded-full flex items-center justify-center ring-4 transition-all duration-700 ${cfg.bg} ${cfg.ring}`}>
          <div className="flex flex-col items-center gap-1 text-center">
            <span className={`text-lg font-semibold transition-colors duration-700 ${cfg.color}`}>
              {cfg.label}
            </span>
          </div>
        </div>
        <p className="text-sm text-white/30">{cfg.sub}</p>

        {/* AI whisper — appears only when intervention fires */}
        {aiMsg && (
          <div className="mt-4 max-w-xs text-center px-5 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70 animate-fade-in">
            {aiMsg}
          </div>
        )}
      </div>

      {/* Audience join link — bottom */}
      <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-1">
        <span className="text-[11px] text-white/20 uppercase tracking-widest">Audience</span>
        <span className="text-xs text-white/30 font-mono">/audience/{sessionId}</span>
      </div>
    </div>
  );
}
