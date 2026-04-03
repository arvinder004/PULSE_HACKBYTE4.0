'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

type Signal = { type: 'confused' | 'clear' | 'question' | 'excited' | 'slow_down'; count: number; emoji: string; bar: string };
type Tab = 'ai' | 'questions' | 'clarify' | 'poll';

const SIGNALS: Signal[] = [
  { type: 'confused',  count: 0, emoji: '😕', bar: 'bg-yellow-400' },
  { type: 'clear',     count: 0, emoji: '✅', bar: 'bg-green-400'  },
  { type: 'question',  count: 0, emoji: '❓', bar: 'bg-cyan-400'   },
  { type: 'excited',   count: 0, emoji: '🔥', bar: 'bg-orange-400' },
  { type: 'slow_down', count: 0, emoji: '🐢', bar: 'bg-lime-400'   },
];

// ── shared card shell ──────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-green-800/40 p-5 ${className}`} style={{ background: '#111f11' }}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs uppercase tracking-[0.2em] text-green-700 font-mono font-semibold mb-3">
      {children}
    </p>
  );
}

// ── top-bar pill ───────────────────────────────────────────────────────────────
function Pill({ children, glow }: { children: React.ReactNode; glow?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-mono border ${glow ? 'border-green-500/50 text-green-300 shadow-[0_0_12px_rgba(74,222,128,0.2)]' : 'border-green-800/50 text-green-600'}`} style={{ background: glow ? 'rgba(20,50,20,0.9)' : 'rgba(15,30,15,0.9)' }}>
      {children}
    </div>
  );
}

// ── pulse circle ──────────────────────────────────────────────────────────────
function PulseCircle({ total }: { total: number }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative flex items-center justify-center w-36 h-36">
        <div className="absolute inset-0 rounded-full border-2 border-green-900/60" />
        <div className="absolute inset-3 rounded-full border border-green-900/40" />
        <div className="absolute inset-6 rounded-full border border-green-900/20" />
        {total > 0 && (
          <>
            <div className="absolute inset-0 rounded-full border-2 border-green-400/20 animate-ping" />
            <div className="absolute inset-0 rounded-full shadow-[0_0_30px_rgba(74,222,128,0.15)]" />
          </>
        )}
        <div className="flex flex-col items-center z-10">
          {total === 0
            ? <span className="text-4xl">⏳</span>
            : <span className="text-4xl font-bold font-mono text-green-300" style={{ textShadow: '0 0 20px rgba(74,222,128,0.6)' }}>{total}</span>
          }
          <span className="text-xs text-green-700 font-mono mt-1">{total === 1 ? 'signal' : 'signals'}</span>
        </div>
      </div>
      <p className="text-sm text-green-700 font-mono">{total === 0 ? 'waiting for audience...' : '// live'}</p>
    </div>
  );
}

// ── signal bar ────────────────────────────────────────────────────────────────
function SignalBar({ emoji, label, count, bar, max }: { emoji: string; label: string; count: number; bar: string; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-5 text-center text-base">{emoji}</span>
      <span className="w-24 text-green-600 font-mono capitalize">{label.replace('_', ' ')}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden border border-green-800/40" style={{ background: '#0a1a0a' }}>
        <div className={`h-full rounded-full ${bar} transition-all duration-700 opacity-80`} style={{ width: `${pct}%`, boxShadow: pct > 0 ? '0 0 8px currentColor' : 'none' }} />
      </div>
      <span className="w-6 text-right font-mono font-bold text-green-300">{count}</span>
    </div>
  );
}

// ── pace meter ────────────────────────────────────────────────────────────────
function PaceMeter() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-xs font-mono text-green-800">
        <span>too slow</span>
        <span className="text-green-500">⚡ waiting</span>
        <span>too fast</span>
      </div>
      <div className="relative h-2.5 rounded-full overflow-hidden border border-green-800/40" style={{ background: '#0a1a0a' }}>
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-600 via-green-400 to-red-500 opacity-60" />
        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-green-300 border-2 border-black shadow-[0_0_10px_rgba(74,222,128,0.8)] transition-all duration-500" style={{ left: '50%', transform: 'translate(-50%,-50%)' }} />
      </div>
      <p className="text-xs text-green-800 font-mono text-center">not enough signal yet</p>
    </div>
  );
}

// ── engagement timeline ───────────────────────────────────────────────────────
function EngagementTimeline() {
  // fixed bars to avoid SSR/client Math.random() mismatch
  const bars = Array.from({ length: 48 }, (_, i) => ({
    h: ((i * 37 + 13) % 50) + 8,
    green: i % 3 !== 0,
  }));
  return (
    <div className="flex flex-col gap-2">
      <Label>Engagement Timeline</Label>
      <div className="h-20 flex items-end gap-px">
        {bars.map((b, i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-all ${b.green ? 'bg-green-500/40' : 'bg-green-800/25'}`}
            style={{ height: `${b.h}%` }}
          />
        ))}
      </div>
      <p className="text-xs text-green-800 font-mono text-center">// builds as signals arrive</p>
    </div>
  );
}

// ── tab panel ─────────────────────────────────────────────────────────────────
function TabPanel({ active, tab, children }: { active: Tab; tab: Tab; children: React.ReactNode }) {
  return active === tab ? <>{children}</> : null;
}

function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-green-800">
      <span className="text-4xl opacity-60">{emoji}</span>
      <p className="text-sm font-mono text-center max-w-[220px] leading-relaxed">{text}</p>
    </div>
  );
}

// ── signal totals grid ────────────────────────────────────────────────────────
function SignalTotals({ signals }: { signals: Signal[] }) {
  return (
    <div className="grid grid-cols-5 gap-3">
      {signals.map(s => (
        <div key={s.type} className="flex flex-col items-center gap-1.5 rounded-xl border border-green-800/40 py-4 hover:border-green-600/50 transition-colors" style={{ background: '#0e1e0e' }}>
          <span className="text-2xl">{s.emoji}</span>
          <span className="text-2xl font-bold font-mono text-green-300" style={{ textShadow: s.count > 0 ? '0 0 12px rgba(74,222,128,0.5)' : 'none' }}>{s.count}</span>
          <span className="text-xs text-green-700 font-mono capitalize">{s.type.replace('_', ' ')}</span>
        </div>
      ))}
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function SpeakerDashboard() {
  const params = useParams();
  const sessionId = params?.sessionId as string;

  const [session, setSession] = useState<{ speakerName: string; topic: string } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const [micOn, setMicOn] = useState(false);
  const [aiPaused, setAiPaused] = useState(false);
  const [signals] = useState(SIGNALS);

  const totalSignals = signals.reduce((s, r) => s + r.count, 0);
  const maxSignal = Math.max(...signals.map(s => s.count), 1);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/session?sessionId=${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSession({ speakerName: d.speakerName, topic: d.topic }));
  }, [sessionId]);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'ai',        label: 'AI',        icon: '🤖' },
    { id: 'questions', label: 'Questions', icon: '🙋' },
    { id: 'clarify',   label: 'Clarify',   icon: '✨' },
    { id: 'poll',      label: 'Poll',      icon: '📊' },
  ];

  return (
    <div className="min-h-screen flex flex-col font-mono bg-[#0d1f0d] text-[#86efac]">

      {/* scanline overlay */}
      <div suppressHydrationWarning className="pointer-events-none fixed inset-0 z-50 opacity-[0.025]" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,0,0.5) 2px, rgba(0,255,0,0.5) 4px)' }} />

      {/* Top Nav */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-green-800/50 bg-[#0a1a0a]/90 backdrop-blur sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <span className="text-green-400 font-bold text-lg tracking-tight" style={{ textShadow: '0 0 16px rgba(74,222,128,0.7)' }}>
            ❤ PULSE
          </span>
          <span className="text-green-800 text-sm">// speaker view</span>
        </div>
        <div className="flex items-center gap-2">
          <Pill>
            <span className="h-2 w-2 rounded-full bg-green-700" />
            audience: <span className="text-green-300 font-bold">0</span>
          </Pill>
          <button onClick={() => setMicOn(v => !v)}>
            <Pill glow={micOn}>
              🎙 {micOn ? 'mic on' : 'mic off'}
            </Pill>
          </button>
          <button onClick={() => setAiPaused(v => !v)}>
            <Pill glow={!aiPaused}>
              🤖 {aiPaused ? 'ai paused' : 'ai active'}
            </Pill>
          </button>
          <div className="rounded-full px-4 py-1.5 text-sm font-mono border border-green-800/50 text-green-700" style={{ background: 'rgba(15,30,15,0.9)' }}>
            {sessionId}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 gap-5 p-5 overflow-auto">

        {/* ── Left Column ── */}
        <div className="flex flex-col gap-5 w-64 shrink-0">

          {/* Room Pulse */}
          <Card>
            <Label>Room Pulse</Label>
            <div className="flex justify-center mb-5">
              <PulseCircle total={totalSignals} />
            </div>
            <div className="flex flex-col gap-3">
              {signals.map(s => (
                <SignalBar key={s.type} emoji={s.emoji} label={s.type} count={s.count} bar={s.bar} max={maxSignal} />
              ))}
            </div>
          </Card>

          {/* QR Code */}
          <Card>
            <Label>Audience QR Code</Label>
            <div className="flex justify-center mb-3">
              <div className="w-28 h-28 rounded-xl border border-green-800/50 flex items-center justify-center text-green-700 text-sm" style={{ background: '#0a1a0a' }}>
                QR
              </div>
            </div>
            <p className="text-xs text-green-800 text-center break-all leading-relaxed">
              /audience/{sessionId}
            </p>
          </Card>

          {/* Mood Word Cloud */}
          <Card className="flex-1">
            <Label>Mood Word Cloud</Label>
            <div className="flex flex-col items-center justify-center gap-3 py-6">
              <span className="text-4xl opacity-20">☁️</span>
              <p className="text-xs text-green-800 text-center leading-relaxed">
                // mood words appear after AI interventions
              </p>
            </div>
          </Card>
        </div>

        {/* ── Right Column ── */}
        <div className="flex flex-col gap-5 flex-1 min-w-0">

          {/* Presenting + Pace */}
          <Card>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <Label>Presenting</Label>
                <h1 className="text-2xl font-bold text-green-300 leading-tight" style={{ textShadow: '0 0 20px rgba(74,222,128,0.4)' }}>
                  {session?.topic ?? '...'}
                </h1>
                <p className="text-sm text-green-700 mt-1">
                  by <span className="text-green-400">{session?.speakerName ?? '...'}</span>
                </p>
              </div>
              <div className="text-sm text-green-700 shrink-0 pt-1">⚡ waiting</div>
            </div>
            <Label>Pace</Label>
            <PaceMeter />
          </Card>

          {/* Engagement Timeline */}
          <Card>
            <EngagementTimeline />
          </Card>

          {/* Tabs */}
          <Card className="flex flex-col flex-1 !p-0 overflow-hidden">
            <div className="flex border-b border-green-900/60 px-2 pt-2 gap-1">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-mono font-medium transition-all ${
                    activeTab === t.id
                      ? 'text-green-300 border border-b-0 border-green-700/60 shadow-[0_0_12px_rgba(74,222,128,0.1)]'
                      : 'text-green-800 hover:text-green-600'
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
            <div className="p-5 flex-1">
              <TabPanel active={activeTab} tab="ai">
                <EmptyState emoji="🤖" text="// the AI is watching the room. it will speak when the room needs it." />
              </TabPanel>
              <TabPanel active={activeTab} tab="questions">
                <EmptyState emoji="🙋" text="// no questions yet. audience questions appear here sorted by upvotes." />
              </TabPanel>
              <TabPanel active={activeTab} tab="clarify">
                <EmptyState emoji="✨" text="// generate AI clarifying questions to broadcast to the audience." />
              </TabPanel>
              <TabPanel active={activeTab} tab="poll">
                <EmptyState emoji="📊" text="// launch a quick poll. results stream back as a live bar chart." />
              </TabPanel>
            </div>
          </Card>

          {/* Total Signals */}
          <Card>
            <Label>Total Signals This Session</Label>
            <SignalTotals signals={signals} />
          </Card>

        </div>
      </div>
    </div>
  );
}
