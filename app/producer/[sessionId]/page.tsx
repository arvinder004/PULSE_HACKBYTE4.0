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

const T = {
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
};

export default function ProducerDashboard() {
  const params = useParams();
  const sessionId = params?.sessionId as string;

  const [session, setSession] = useState<{ speakerName: string; topic: string } | null>(null);
  const [tab, setTab] = useState<Tab>('ai');
  const [mounted, setMounted] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({ confused: 0, clear: 0, question: 0, excited: 0, slow_down: 0 });
  const [audienceCount, setAudienceCount] = useState(0);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/session?sessionId=${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSession({ speakerName: d.speakerName, topic: d.topic }));
  }, [sessionId]);

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
          setAudienceCount(prev => prev + 1);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [sessionId]);

  if (!mounted) return null;

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const max   = Math.max(...Object.values(counts), 1);

  const paceSignals = (counts['slow_down'] ?? 0) + (counts['excited'] ?? 0);
  const pacePct     = paceSignals === 0 ? 50 : Math.round(((counts['slow_down'] ?? 0) / paceSignals) * 100);
  const paceLabel   = paceSignals < 3 ? 'Not enough signal' : pacePct > 65 ? 'Too fast — slow down' : pacePct < 35 ? 'Too slow — pick up the pace' : 'Good pace';

  return (
    <div className={`min-h-screen flex flex-col select-none ${T.root}`}>

      {/* Nav */}
      <nav className={`h-12 border-b flex items-center justify-between px-6 shrink-0 ${T.nav}`}>
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold tracking-tight">PULSE</span>
          <span className={`text-xs ${T.label}`}>Producer</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-3 py-1 border rounded-full ${T.tagBorder}`}>
            {audienceCount > 0 ? `${audienceCount} signals` : '0 signals'}
          </span>
          <span className={`text-xs font-mono ${T.muted}`}>{sessionId}</span>
        </div>
      </nav>

      {/* Layout */}
      <div className={`flex flex-1 gap-px overflow-hidden ${T.divider}`}>

        {/* Left */}
        <div className={`w-72 shrink-0 flex flex-col gap-px ${T.panel}`}>

          {/* Pulse */}
          <div className={`p-5 flex-none ${T.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${T.label}`}>Room Pulse</p>
            <div className="flex flex-col items-center py-6 gap-1">
              <span className="text-5xl font-bold tabular-nums">{total}</span>
              <span className={`text-xs uppercase tracking-widest ${T.label}`}>signals</span>
            </div>
            <div className="flex flex-col gap-3 mt-2">
              {SIGNAL_TYPES.map(s => {
                const c   = counts[s.key];
                const pct = (c / max) * 100;
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <span className={`text-xs w-20 ${T.sub}`}>{s.label}</span>
                    <div className={`flex-1 h-px relative ${T.bar}`}>
                      <div className={`absolute inset-y-0 left-0 transition-all duration-500 ${T.barFill}`} style={{ width: `${pct}%`, height: '1px' }} />
                    </div>
                    <span className={`text-xs font-mono w-4 text-right ${T.sub}`}>{c}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* QR */}
          <div className={`p-5 flex-none ${T.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${T.label}`}>Join</p>
            <div className="flex flex-col items-center gap-3 py-2 mt-2">
              <div className={`w-28 h-28 border flex items-center justify-center text-xs ${T.qrBox}`}>QR</div>
              <span className={`text-[11px] font-mono text-center break-all ${T.muted}`}>/audience/{sessionId}</span>
            </div>
          </div>

          {/* Mood */}
          <div className={`p-5 flex-1 ${T.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${T.label}`}>Mood</p>
            <div className={`flex items-center justify-center h-24 text-xs ${T.muted}`}>No data yet</div>
          </div>
        </div>

        {/* Right */}
        <div className={`flex-1 flex flex-col gap-px min-w-0 ${T.panel}`}>

          {/* Session info + pace */}
          <div className={`p-5 flex-none ${T.panel}`}>
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className={`text-[11px] uppercase tracking-widest font-medium ${T.label}`}>Presenting</p>
                <h1 className="text-xl font-semibold mt-1 leading-tight">{session?.topic ?? '—'}</h1>
                <p className={`text-sm mt-1 ${T.sub}`}>{session?.speakerName ?? '—'}</p>
              </div>
              <div className={`text-xs shrink-0 pt-1 ${T.muted}`}>Live</div>
            </div>
            <div className="mt-5">
              <p className={`text-[11px] uppercase tracking-widest font-medium ${T.label}`}>Pace</p>
              <div className="flex items-center gap-3 mt-2">
                <span className={`text-xs w-16 ${T.muted}`}>Too slow</span>
                <div className={`flex-1 relative h-px ${T.bar}`}>
                  <div className={`absolute top-1/2 w-2 h-2 rounded-full transition-all duration-700 ${T.dot}`} style={{ left: `${pacePct}%`, transform: 'translate(-50%,-50%)' }} />
                </div>
                <span className={`text-xs w-16 text-right ${T.muted}`}>Too fast</span>
              </div>
              <p className={`text-xs text-center mt-2 ${T.muted}`}>{paceLabel}</p>
            </div>
          </div>

          {/* Engagement timeline */}
          <div className={`p-5 flex-none ${T.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${T.label}`}>Engagement</p>
            <div className="flex items-end gap-px h-16 mt-3">
              {BARS.map((b, i) => (
                <div key={i} className={`flex-1 ${b.lit ? T.barLit : T.barDim}`} style={{ height: `${b.h}%` }} />
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className={`flex-1 flex flex-col ${T.panel}`}>
            <div className={`flex border-b px-5 ${T.tabBorder}`}>
              {TABS.map(t2 => (
                <button
                  key={t2.id}
                  onClick={() => setTab(t2.id)}
                  className={`px-4 py-3 text-sm transition-colors border-b -mb-px ${tab === t2.id ? T.tabActive : T.tabInactive}`}
                >
                  {t2.label}
                </button>
              ))}
            </div>
            <div className="flex-1 flex items-center justify-center p-6">
              <p className={`text-sm text-center max-w-xs ${T.muted}`}>
                {tab === 'ai'        && 'Watching the room. Will intervene when needed.'}
                {tab === 'questions' && 'No questions yet.'}
                {tab === 'clarify'   && 'Generate clarifying questions to broadcast.'}
                {tab === 'poll'      && 'Launch a poll to get instant audience feedback.'}
              </p>
            </div>
          </div>

          {/* Totals */}
          <div className={`p-5 flex-none ${T.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${T.label}`}>Totals</p>
            <div className="grid grid-cols-5 gap-3 mt-3">
              {SIGNAL_TYPES.map(s => (
                <div key={s.key} className={`flex flex-col items-center gap-1 border py-4 ${T.totalCard}`}>
                  <span className="text-2xl font-bold tabular-nums">{counts[s.key]}</span>
                  <span className={`text-[11px] ${T.label}`}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
