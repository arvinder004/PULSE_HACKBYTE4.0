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

// theme tokens — dark / light
const T = {
  dark: {
    root:        'bg-black text-white',
    nav:         'bg-black border-white/10',
    divider:     'bg-white/5',
    panel:       'bg-black',
    label:       'text-white/30',
    muted:       'text-white/20',
    sub:         'text-white/40',
    bar:         'bg-white/10',
    barFill:     'bg-white',
    barLit:      'bg-white/20',
    barDim:      'bg-white/5',
    tagBorder:   'border-white/10 text-white/40',
    tagActive:   'border-white/40 text-white',
    tabActive:   'text-white border-white',
    tabInactive: 'text-white/30 border-transparent hover:text-white/60',
    tabBorder:   'border-white/10',
    totalCard:   'border-white/8',
    qrBox:       'border-white/10 text-white/20',
    dot:         'bg-white border-black',
    toggle:      'bg-white/10 text-white/60 hover:text-white',
  },
  light: {
    root:        'bg-white text-black',
    nav:         'bg-white border-black/10',
    divider:     'bg-black/5',
    panel:       'bg-white',
    label:       'text-black/40',
    muted:       'text-black/25',
    sub:         'text-black/50',
    bar:         'bg-black/10',
    barFill:     'bg-black',
    barLit:      'bg-black/20',
    barDim:      'bg-black/6',
    tagBorder:   'border-black/15 text-black/50',
    tagActive:   'border-black/50 text-black',
    tabActive:   'text-black border-black',
    tabInactive: 'text-black/30 border-transparent hover:text-black/60',
    tabBorder:   'border-black/10',
    totalCard:   'border-black/10',
    qrBox:       'border-black/10 text-black/25',
    dot:         'bg-black border-white',
    toggle:      'bg-black/6 text-black/50 hover:text-black',
  },
};

export default function SpeakerDashboard() {
  const params = useParams();
  const sessionId = params?.sessionId as string;

  const [session, setSession] = useState<{ speakerName: string; topic: string } | null>(null);
  const [tab, setTab] = useState<Tab>('ai');
  const [mic, setMic] = useState(false);
  const [aiOn, setAiOn] = useState(true);
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/session?sessionId=${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSession({ speakerName: d.speakerName, topic: d.topic }));
  }, [sessionId]);

  const t = dark ? T.dark : T.light;
  const counts = { confused: 0, clear: 0, question: 0, excited: 0, slow_down: 0 };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const max = Math.max(...Object.values(counts), 1);

  if (!mounted) return null;

  return (
    <div className={`min-h-screen flex flex-col select-none transition-colors duration-200 ${t.root}`}>

      {/* Nav */}
      <nav className={`h-12 border-b flex items-center justify-between px-6 shrink-0 ${t.nav}`}>
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold tracking-tight">PULSE</span>
          <span className={`text-xs ${t.label}`}>Speaker</span>
        </div>
        <div className="flex items-center gap-2">
          <Tag t={t}>0 audience</Tag>
          <button onClick={() => setMic(v => !v)}>
            <Tag t={t} active={mic}>Mic {mic ? 'on' : 'off'}</Tag>
          </button>
          <button onClick={() => setAiOn(v => !v)}>
            <Tag t={t} active={aiOn}>AI {aiOn ? 'on' : 'paused'}</Tag>
          </button>
          <span className={`text-xs font-mono ml-2 ${t.muted}`}>{sessionId}</span>

          {/* Theme toggle */}
          <button
            onClick={() => setDark(v => !v)}
            className={`ml-2 px-3 py-1 text-xs rounded-full border transition-colors ${t.toggle} ${dark ? 'border-white/10' : 'border-black/10'}`}
          >
            {dark ? 'Light' : 'Dark'}
          </button>
        </div>
      </nav>

      {/* Layout */}
      <div className={`flex flex-1 gap-px overflow-hidden ${t.divider}`}>

        {/* Left */}
        <div className={`w-72 shrink-0 flex flex-col gap-px ${t.panel}`}>

          {/* Pulse */}
          <div className={`p-5 flex-none ${t.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${t.label}`}>Room Pulse</p>
            <div className="flex flex-col items-center py-6 gap-1">
              <span className="text-5xl font-bold tabular-nums">{total}</span>
              <span className={`text-xs uppercase tracking-widest ${t.label}`}>signals</span>
            </div>
            <div className="flex flex-col gap-3 mt-2">
              {SIGNAL_TYPES.map(s => {
                const c = counts[s.key];
                const pct = (c / max) * 100;
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <span className={`text-xs w-20 ${t.sub}`}>{s.label}</span>
                    <div className={`flex-1 h-px relative ${t.bar}`}>
                      <div className={`absolute inset-y-0 left-0 transition-all duration-500 ${t.barFill}`} style={{ width: `${pct}%`, height: '1px' }} />
                    </div>
                    <span className={`text-xs font-mono w-4 text-right ${t.sub}`}>{c}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* QR */}
          <div className={`p-5 flex-none ${t.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${t.label}`}>Join</p>
            <div className="flex flex-col items-center gap-3 py-2 mt-2">
              <div className={`w-28 h-28 border flex items-center justify-center text-xs ${t.qrBox}`}>
                QR
              </div>
              <span className={`text-[11px] font-mono text-center break-all ${t.muted}`}>
                /audience/{sessionId}
              </span>
            </div>
          </div>

          {/* Mood */}
          <div className={`p-5 flex-1 ${t.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${t.label}`}>Mood</p>
            <div className={`flex items-center justify-center h-24 text-xs ${t.muted}`}>
              No data yet
            </div>
          </div>
        </div>

        {/* Right */}
        <div className={`flex-1 flex flex-col gap-px min-w-0 ${t.panel}`}>

          {/* Session info + pace */}
          <div className={`p-5 flex-none ${t.panel}`}>
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className={`text-[11px] uppercase tracking-widest font-medium ${t.label}`}>Presenting</p>
                <h1 className="text-xl font-semibold mt-1 leading-tight">
                  {session?.topic ?? '—'}
                </h1>
                <p className={`text-sm mt-1 ${t.sub}`}>{session?.speakerName ?? '—'}</p>
              </div>
              <div className={`text-xs shrink-0 pt-1 ${t.muted}`}>Waiting</div>
            </div>
            <div className="mt-5">
              <p className={`text-[11px] uppercase tracking-widest font-medium ${t.label}`}>Pace</p>
              <div className="flex items-center gap-3 mt-2">
                <span className={`text-xs w-16 ${t.muted}`}>Too slow</span>
                <div className={`flex-1 relative h-px ${t.bar}`}>
                  <div className={`absolute top-1/2 w-2 h-2 rounded-full ${t.dot}`} style={{ left: '50%', transform: 'translate(-50%,-50%)' }} />
                </div>
                <span className={`text-xs w-16 text-right ${t.muted}`}>Too fast</span>
              </div>
              <p className={`text-xs text-center mt-2 ${t.muted}`}>Not enough signal</p>
            </div>
          </div>

          {/* Timeline */}
          <div className={`p-5 flex-none ${t.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${t.label}`}>Engagement</p>
            <div className="flex items-end gap-px h-16 mt-3">
              {BARS.map((b, i) => (
                <div key={i} className={`flex-1 ${b.lit ? t.barLit : t.barDim}`} style={{ height: `${b.h}%` }} />
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className={`flex-1 flex flex-col ${t.panel}`}>
            <div className={`flex border-b px-5 ${t.tabBorder}`}>
              {TABS.map(t2 => (
                <button
                  key={t2.id}
                  onClick={() => setTab(t2.id)}
                  className={`px-4 py-3 text-sm transition-colors border-b -mb-px ${tab === t2.id ? t.tabActive : t.tabInactive}`}
                >
                  {t2.label}
                </button>
              ))}
            </div>
            <div className="flex-1 flex items-center justify-center p-6">
              <p className={`text-sm text-center max-w-xs ${t.muted}`}>
                {tab === 'ai'        && 'Watching the room. Will intervene when needed.'}
                {tab === 'questions' && 'No questions yet.'}
                {tab === 'clarify'   && 'Generate clarifying questions to broadcast.'}
                {tab === 'poll'      && 'Launch a poll to get instant audience feedback.'}
              </p>
            </div>
          </div>

          {/* Totals */}
          <div className={`p-5 flex-none ${t.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${t.label}`}>Totals</p>
            <div className="grid grid-cols-5 gap-3 mt-3">
              {SIGNAL_TYPES.map(s => (
                <div key={s.key} className={`flex flex-col items-center gap-1 border py-4 ${t.totalCard}`}>
                  <span className="text-2xl font-bold tabular-nums">{counts[s.key]}</span>
                  <span className={`text-[11px] ${t.label}`}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function Tag({ children, active, t }: { children: React.ReactNode; active?: boolean; t: typeof T.dark }) {
  return (
    <span className={`px-3 py-1 text-xs border rounded-full transition-colors ${active ? t.tagActive : t.tagBorder}`}>
      {children}
    </span>
  );
}
