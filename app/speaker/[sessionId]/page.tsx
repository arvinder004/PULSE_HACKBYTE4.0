'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

type Tab = 'ai' | 'questions' | 'clarify' | 'poll';

const SIGNAL_TYPES = [
  { key: 'confused',  label: 'Confused'  },
  { key: 'clear',     label: 'Clear'     },
  { key: 'question',  label: 'Question'  },
  { key: 'excited',   label: 'Excited'   },
  { key: 'slow_down', label: 'Slow down' },
] as const;

const TABS: { id: Tab; label: string }[] = [
  { id: 'ai',        label: 'AI'        },
  { id: 'questions', label: 'Questions' },
  { id: 'clarify',   label: 'Clarify'   },
  { id: 'poll',      label: 'Poll'      },
];

const BARS = Array.from({ length: 48 }, (_, i) => ({
  h: ((i * 37 + 13) % 50) + 8,
  lit: i % 3 !== 0,
}));

export default function SpeakerDashboard() {
  const params = useParams();
  const sessionId = params?.sessionId as string;

  const [session, setSession] = useState<{ speakerName: string; topic: string } | null>(null);
  const [tab, setTab] = useState<Tab>('ai');
  const [mic, setMic] = useState(false);
  const [aiOn, setAiOn] = useState(true);
  const counts = { confused: 0, clear: 0, question: 0, excited: 0, slow_down: 0 };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const max = Math.max(...Object.values(counts), 1);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/session?sessionId=${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSession({ speakerName: d.speakerName, topic: d.topic }));
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col select-none">

      {/* Nav */}
      <nav className="h-12 border-b border-white/10 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold tracking-tight">PULSE</span>
          <span className="text-xs text-white/30">Speaker</span>
        </div>
        <div className="flex items-center gap-2">
          <Tag>0 audience</Tag>
          <button onClick={() => setMic(v => !v)}>
            <Tag active={mic}>Mic {mic ? 'on' : 'off'}</Tag>
          </button>
          <button onClick={() => setAiOn(v => !v)}>
            <Tag active={aiOn}>AI {aiOn ? 'on' : 'paused'}</Tag>
          </button>
          <span className="text-xs text-white/20 font-mono ml-2">{sessionId}</span>
        </div>
      </nav>

      {/* Layout */}
      <div className="flex flex-1 gap-px bg-white/5 overflow-hidden">

        {/* Left */}
        <div className="w-72 shrink-0 bg-black flex flex-col gap-px">

          {/* Pulse */}
          <Panel className="flex-none">
            <SectionLabel>Room Pulse</SectionLabel>
            <div className="flex flex-col items-center py-6 gap-1">
              <span className="text-5xl font-bold tabular-nums">{total}</span>
              <span className="text-xs text-white/30 uppercase tracking-widest">signals</span>
            </div>
            <div className="flex flex-col gap-3 mt-2">
              {SIGNAL_TYPES.map(s => {
                const c = counts[s.key];
                const pct = (c / max) * 100;
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <span className="text-xs text-white/40 w-20">{s.label}</span>
                    <div className="flex-1 h-px bg-white/10 relative">
                      <div className="absolute inset-y-0 left-0 bg-white transition-all duration-500" style={{ width: `${pct}%`, height: '1px' }} />
                    </div>
                    <span className="text-xs font-mono text-white/50 w-4 text-right">{c}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* QR */}
          <Panel className="flex-none">
            <SectionLabel>Join</SectionLabel>
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="w-28 h-28 border border-white/10 flex items-center justify-center text-white/20 text-xs">
                QR
              </div>
              <span className="text-[11px] text-white/20 font-mono text-center break-all">
                /audience/{sessionId}
              </span>
            </div>
          </Panel>

          {/* Mood */}
          <Panel className="flex-1">
            <SectionLabel>Mood</SectionLabel>
            <div className="flex items-center justify-center h-24 text-xs text-white/20">
              No data yet
            </div>
          </Panel>
        </div>

        {/* Right */}
        <div className="flex-1 bg-black flex flex-col gap-px min-w-0">

          {/* Session info + pace */}
          <Panel className="flex-none">
            <div className="flex items-start justify-between gap-6">
              <div>
                <SectionLabel>Presenting</SectionLabel>
                <h1 className="text-xl font-semibold mt-1 leading-tight">
                  {session?.topic ?? '—'}
                </h1>
                <p className="text-sm text-white/40 mt-1">
                  {session?.speakerName ?? '—'}
                </p>
              </div>
              <div className="text-xs text-white/20 shrink-0 pt-1">Waiting</div>
            </div>
            <div className="mt-5">
              <SectionLabel>Pace</SectionLabel>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs text-white/30 w-16">Too slow</span>
                <div className="flex-1 relative h-px bg-white/10">
                  <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white border border-black" style={{ left: '50%', transform: 'translate(-50%,-50%)' }} />
                </div>
                <span className="text-xs text-white/30 w-16 text-right">Too fast</span>
              </div>
              <p className="text-xs text-white/20 text-center mt-2">Not enough signal</p>
            </div>
          </Panel>

          {/* Timeline */}
          <Panel className="flex-none">
            <SectionLabel>Engagement</SectionLabel>
            <div className="flex items-end gap-px h-16 mt-3">
              {BARS.map((b, i) => (
                <div
                  key={i}
                  className={`flex-1 ${b.lit ? 'bg-white/20' : 'bg-white/5'}`}
                  style={{ height: `${b.h}%` }}
                />
              ))}
            </div>
          </Panel>

          {/* Tabs */}
          <Panel className="flex-1 flex flex-col !pb-0 !px-0">
            <div className="flex border-b border-white/10 px-5">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-3 text-sm transition-colors border-b -mb-px ${
                    tab === t.id
                      ? 'text-white border-white'
                      : 'text-white/30 border-transparent hover:text-white/60'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex-1 flex items-center justify-center p-6">
              {tab === 'ai' && <Empty text="Watching the room. Will intervene when needed." />}
              {tab === 'questions' && <Empty text="No questions yet." />}
              {tab === 'clarify' && <Empty text="Generate clarifying questions to broadcast." />}
              {tab === 'poll' && <Empty text="Launch a poll to get instant audience feedback." />}
            </div>
          </Panel>

          {/* Signal totals */}
          <Panel className="flex-none">
            <SectionLabel>Totals</SectionLabel>
            <div className="grid grid-cols-5 gap-3 mt-3">
              {SIGNAL_TYPES.map(s => (
                <div key={s.key} className="flex flex-col items-center gap-1 border border-white/8 py-4">
                  <span className="text-2xl font-bold tabular-nums">{counts[s.key]}</span>
                  <span className="text-[11px] text-white/30">{s.label}</span>
                </div>
              ))}
            </div>
          </Panel>

        </div>
      </div>
    </div>
  );
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] uppercase tracking-widest text-white/30 font-medium">{children}</p>;
}

function Tag({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span className={`px-3 py-1 text-xs border rounded-full transition-colors ${active ? 'border-white/40 text-white' : 'border-white/10 text-white/40'}`}>
      {children}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-white/20 text-center max-w-xs">{text}</p>;
}
