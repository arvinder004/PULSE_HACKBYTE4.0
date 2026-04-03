'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

// --- Types ---
type Signal = { type: 'confused' | 'clear' | 'question' | 'excited' | 'slow_down'; count: number; emoji: string; color: string };
type Tab = 'ai' | 'questions' | 'clarify' | 'poll';

const SIGNALS: Signal[] = [
  { type: 'confused',  count: 0, emoji: '😕', color: 'text-yellow-400' },
  { type: 'clear',     count: 0, emoji: '✅', color: 'text-green-400'  },
  { type: 'question',  count: 0, emoji: '❓', color: 'text-blue-400'   },
  { type: 'excited',   count: 0, emoji: '🔥', color: 'text-orange-400' },
  { type: 'slow_down', count: 0, emoji: '🐢', color: 'text-teal-400'   },
];

// --- Sub-components ---

function StatPill({ label, value, active }: { label: string; value: string | number; active?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ${active ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
      {label}: <span className="text-zinc-200 font-semibold">{value}</span>
    </div>
  );
}

function SignalBar({ emoji, label, count, color, max }: { emoji: string; label: string; count: number; color: string; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-4 text-center">{emoji}</span>
      <span className="w-20 text-zinc-400 capitalize">{label.replace('_', ' ')}</span>
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full bg-zinc-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className={`w-4 text-right font-mono font-semibold ${color}`}>{count}</span>
    </div>
  );
}

function PulseCircle({ total }: { total: number }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex items-center justify-center w-28 h-28">
        <div className="absolute inset-0 rounded-full border-2 border-zinc-700" />
        <div className="absolute inset-2 rounded-full border border-zinc-600/50" />
        {total > 0 && <div className="absolute inset-0 rounded-full border-2 border-emerald-500/30 animate-ping" />}
        <div className="flex flex-col items-center">
          {total === 0
            ? <span className="text-3xl">⏳</span>
            : <span className="text-2xl font-bold text-zinc-100">{total}</span>
          }
          <span className="text-[10px] text-zinc-500 mt-0.5">{total === 1 ? 'signal' : 'signals'}</span>
        </div>
      </div>
      <p className="text-xs text-zinc-500">{total === 0 ? 'Waiting for audience…' : 'Live signals'}</p>
    </div>
  );
}

function EngagementTimeline() {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium">Engagement Timeline</p>
      <div className="h-16 flex items-end gap-px">
        {Array.from({ length: 40 }).map((_, i) => (
          <div key={i} className="flex-1 rounded-sm bg-zinc-800" style={{ height: `${Math.random() * 40 + 10}%`, opacity: 0.4 }} />
        ))}
      </div>
      <p className="text-[10px] text-zinc-600 text-center">Waiting to build as signals come in…</p>
    </div>
  );
}

function PaceMeter() {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[10px] text-zinc-600">
        <span>Too slow</span>
        <span className="text-zinc-400 font-medium">⚡ Waiting</span>
        <span>Too fast</span>
      </div>
      <div className="relative h-2 rounded-full bg-gradient-to-r from-blue-600 via-emerald-500 to-red-500">
        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-zinc-900 shadow-lg transition-all duration-500" style={{ left: '50%', transform: 'translate(-50%, -50%)' }} />
      </div>
      <p className="text-[10px] text-zinc-600 text-center">No enough signal yet</p>
    </div>
  );
}

function TabPanel({ active, tab, children }: { active: Tab; tab: Tab; children: React.ReactNode }) {
  return active === tab ? <>{children}</> : null;
}

function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-zinc-600">
      <span className="text-3xl">{emoji}</span>
      <p className="text-xs text-center max-w-[180px]">{text}</p>
    </div>
  );
}

function SignalTotals({ signals }: { signals: Signal[] }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {signals.map(s => (
        <div key={s.type} className="flex flex-col items-center gap-1 rounded-xl bg-zinc-800/60 border border-zinc-700/50 py-3">
          <span className="text-xl">{s.emoji}</span>
          <span className={`text-lg font-bold font-mono ${s.color}`}>{s.count}</span>
          <span className="text-[10px] text-zinc-500 capitalize">{s.type.replace('_', ' ')}</span>
        </div>
      ))}
    </div>
  );
}

// --- Main Dashboard ---

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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">

      {/* Top Nav */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <span className="text-red-500 font-bold text-sm tracking-tight">❤ PULSE</span>
          <span className="text-zinc-600 text-xs">Speaker View</span>
        </div>
        <div className="flex items-center gap-2">
          <StatPill label="Audience" value={0} />
          <button
            onClick={() => setMicOn(v => !v)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${micOn ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'}`}
          >
            🎙 {micOn ? 'On' : 'Off'}
          </button>
          <button
            onClick={() => setAiPaused(v => !v)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${!aiPaused ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400' : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'}`}
          >
            🤖 {aiPaused ? 'Paused' : 'AI on'}
          </button>
          <div className="rounded-full px-3 py-1 text-xs font-mono bg-zinc-800 border border-zinc-700 text-zinc-400">
            {sessionId}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 gap-4 p-4 overflow-auto">

        {/* Left Column */}
        <div className="flex flex-col gap-4 w-[220px] shrink-0">

          {/* Room Pulse */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-4">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium">Room Pulse</p>
            <div className="flex justify-center">
              <PulseCircle total={totalSignals} />
            </div>
            <div className="flex flex-col gap-2">
              {signals.map(s => (
                <SignalBar key={s.type} emoji={s.emoji} label={s.type} count={s.count} color={s.color} max={maxSignal} />
              ))}
            </div>
          </div>

          {/* QR Code */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-3">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium">Audience QR Code</p>
            <div className="flex justify-center">
              <div className="w-24 h-24 rounded-xl bg-white flex items-center justify-center text-zinc-400 text-xs">
                QR
              </div>
            </div>
            <p className="text-[10px] text-zinc-600 text-center break-all font-mono">
              {typeof window !== 'undefined' ? `${window.location.origin}/audience/${sessionId}` : ''}
            </p>
          </div>

          {/* Mood Word Cloud */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-3 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium">Mood Word Cloud</p>
            <div className="flex flex-col items-center justify-center flex-1 gap-2 py-4">
              <span className="text-3xl opacity-30">☁️</span>
              <p className="text-[10px] text-zinc-600 text-center">Mood words appear here after AI interventions</p>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-4 flex-1 min-w-0">

          {/* Presenting + Pace */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium">Presenting</p>
                <h1 className="text-lg font-semibold text-zinc-100 mt-0.5">{session?.topic ?? '…'}</h1>
                <p className="text-xs text-zinc-500 mt-0.5">by <span className="text-zinc-300">{session?.speakerName ?? '…'}</span></p>
              </div>
              <div className="text-right text-xs text-zinc-500 shrink-0">
                <span className="text-zinc-400 font-medium">⚡ Waiting</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium mb-2">Pace</p>
              <PaceMeter />
            </div>
          </div>

          {/* Engagement Timeline */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            <EngagementTimeline />
          </div>

          {/* Tabs */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 flex flex-col flex-1">
            <div className="flex border-b border-zinc-800 px-2 pt-2 gap-1">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors ${activeTab === t.id ? 'bg-zinc-800 text-zinc-100 border border-b-0 border-zinc-700' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
            <div className="p-4 flex-1">
              <TabPanel active={activeTab} tab="ai">
                <EmptyState emoji="🤖" text="The AI is watching the room. It will speak when the room needs it." />
              </TabPanel>
              <TabPanel active={activeTab} tab="questions">
                <EmptyState emoji="🙋" text="No questions yet. Audience questions will appear here sorted by upvotes." />
              </TabPanel>
              <TabPanel active={activeTab} tab="clarify">
                <EmptyState emoji="✨" text="Generate AI clarifying questions to broadcast to the audience." />
              </TabPanel>
              <TabPanel active={activeTab} tab="poll">
                <EmptyState emoji="📊" text="Launch a quick poll. Results stream back as a live bar chart." />
              </TabPanel>
            </div>
          </div>

          {/* Total Signals */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-3">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium">Total Signals This Session</p>
            <SignalTotals signals={signals} />
          </div>

        </div>
      </div>
    </div>
  );
}
