'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import DashboardNav from '@/components/DashboardNav';
import PulseVisualizer from '@/components/PulseVisualizer';
import FloatingReactions, { type FloatingReaction } from '@/components/FloatingReactions';
import { useSpacetimeSession } from '@/lib/useSpacetimeSession';
import { useTheme } from '@/lib/useTheme';

type Tab = 'ai' | 'questions' | 'clarify' | 'poll';

type SignalKey = 'confused' | 'clear' | 'excited' | 'slow_down' | 'question';

const SIGNAL_EMOJI: Record<SignalKey, string> = {
  confused:  '😕',
  clear:     '✅',
  excited:   '🔥',
  slow_down: '🐢',
  question:  '✋',
};

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

const T_DARK = {
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

const T_LIGHT = {
  root:        'bg-white text-black',
  nav:         'bg-white border-black/10',
  divider:     'bg-black/5',
  panel:       'bg-white',
  label:       'text-black/70',
  muted:       'text-black/60',
  sub:         'text-black/75',
  bar:         'bg-black/10',
  barFill:     'bg-black',
  barLit:      'bg-black/20',
  barDim:      'bg-black/6',
  tagBorder:   'border-black/20 text-black/70',
  tagActive:   'border-black/60 text-black',
  tabActive:   'text-black border-black',
  tabInactive: 'text-black/50 border-transparent hover:text-black/80',
  tabBorder:   'border-black/10',
  totalCard:   'border-black/10',
  qrBox:       'border-black/10 text-black/50',
  dot:         'bg-black border-white',
};

export default function ProducerDashboard() {
  const params = useParams();
  const sessionId = params?.sessionId as string;

  const [session, setSession] = useState<{ speakerName: string; topic: string } | null>(null);
  const [tab, setTab] = useState<Tab>('ai');
  const { dark, setDark } = useTheme(true);
  const [mounted, setMounted] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({ confused: 0, clear: 0, question: 0, excited: 0, slow_down: 0 });
  const [audienceCount, setAudienceCount] = useState(0);
  const [audioFiles, setAudioFiles] = useState<Array<{ id: string; filename: string; ts?: string | null }>>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [primaryQuestions, setPrimaryQuestions] = useState<Array<{ id: string; text: string; upvotes: number; mergedCount: number; ts: number; isPrimary: boolean }>>([]);
  const reactionId = useRef(0);
  const DEBUG = true;

  const spacetime = useSpacetimeSession(sessionId);

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

          // Add floating reaction
          const emoji = SIGNAL_EMOJI[key as SignalKey];
          if (emoji) {
            const id = ++reactionId.current;
            const x = 10 + Math.random() * 80;
            setReactions(prev => [...prev.slice(-20), { id, emoji, x }]);
            setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 2200);
          }
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    async function fetchAudio() {
      try {
        const res = await fetch(`/api/audio/list?sessionId=${sessionId}`);
        const json = await res.json().catch(() => ({} as any));
        if (alive) setAudioFiles(json.items || []);
        if (DEBUG) console.log('[PULSE][Phase3][Audio] list', (json.items || []).length);
      } catch (e) {
        if (DEBUG) console.log('[PULSE][Phase3][Audio] list failed', String(e));
      }
    }
    fetchAudio();
    const id = setInterval(fetchAudio, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, [sessionId]);

  // Poll all questions every 5s
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    async function fetchQuestions() {
      try {
        const res = await fetch(`/api/questions?sessionId=${sessionId}`);
        const json = await res.json().catch(() => []);
        if (alive) setPrimaryQuestions(Array.isArray(json) ? json : []);
      } catch {}
    }
    fetchQuestions();
    const id = setInterval(fetchQuestions, 5_000);
    return () => { alive = false; clearInterval(id); };
  }, [sessionId]);

  if (!mounted) return null;

  const T     = dark ? T_DARK : T_LIGHT;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const paceSignals = (counts['slow_down'] ?? 0) + (counts['excited'] ?? 0);
  const pacePct     = paceSignals === 0 ? 50 : Math.round(((counts['slow_down'] ?? 0) / paceSignals) * 100);
  const paceLabel   = paceSignals < 3 ? 'Not enough signal' : pacePct > 65 ? 'Too fast — slow down' : pacePct < 35 ? 'Too slow — pick up the pace' : 'Good pace';

  const latestCaption = [...(spacetime.captions || [])].sort((a: any, b: any) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))[0];

  return (
    <div className={`min-h-screen flex flex-col select-none transition-colors duration-200 ${T.root}`}>
      <FloatingReactions reactions={reactions} />

      <DashboardNav
        sessionId={sessionId}
        mode="producer"
        dark={dark}
        onToggleDark={() => setDark(!dark)}
        signalCount={audienceCount}
      />

      {/* Layout */}
      <div className={`flex flex-1 gap-px overflow-hidden ${T.divider}`}>

        {/* Left */}
        <div className={`w-72 shrink-0 flex flex-col gap-px ${T.panel}`}>

          {/* Pulse */}
          <div className={`p-5 flex-none ${T.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${T.label}`}>Room Pulse</p>
            <div className="mt-4">
              <PulseVisualizer counts={counts} dark={dark} />
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

          {/* Captions */}
          <div className={`p-5 flex-none ${T.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${T.label}`}>Captions</p>
            <div className={`mt-3 text-xs ${T.muted}`}>
              {latestCaption?.text || 'No captions yet'}
            </div>
          </div>

          {/* Audio chunks */}
          <div className={`p-5 flex-none ${T.panel}`}>
            <p className={`text-[11px] uppercase tracking-widest font-medium ${T.label}`}>Audio Chunks</p>
            <div className={`mt-3 flex flex-col gap-2 text-[11px] ${T.muted}`}>
              {audioFiles.length === 0 && <span>No audio yet</span>}
              {audioFiles.slice(0, 5).map((f) => (
                <span key={f.id} className="font-mono break-all">
                  {f.filename}
                </span>
              ))}
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
            <div className="flex-1 overflow-y-auto p-6">
              {tab === 'ai' && (
                <p className={`text-sm text-center ${T.muted}`}>Watching the room. Will intervene when needed.</p>
              )}
              {tab === 'questions' && (
                <div className="flex flex-col gap-3">
                  {primaryQuestions.length === 0 ? (
                    <p className={`text-sm text-center ${T.muted}`}>No questions yet.</p>
                  ) : primaryQuestions.map((q, i) => (
                    <div key={q.id} className={`p-4 rounded-xl border text-sm flex items-start gap-3 ${dark ? 'border-white/10 bg-white/5 text-white/80' : 'border-black/10 bg-black/3 text-black/90'}`}>
                      <div className={`flex flex-col items-center gap-0.5 shrink-0 min-w-[2rem] ${dark ? 'text-white/50' : 'text-black/50'}`}>
                        <span className="text-base leading-none">▲</span>
                        <span className="text-sm font-semibold tabular-nums">{q.upvotes + (q.mergedCount ?? 0)}</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] uppercase tracking-widest ${T.muted}`}>Q{i + 1}</span>
                          {q.isPrimary && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-medium uppercase tracking-widest">Primary</span>
                          )}
                          {(q.mergedCount ?? 0) > 0 && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${dark ? 'bg-white/10 text-white/40' : 'bg-black/8 text-black/50'}`}>
                              +{q.mergedCount} similar
                            </span>
                          )}
                        </div>
                        {q.text}
                      </div>
                      <button
                        onClick={async () => {
                          await fetch(`/api/questions?id=${q.id}`, { method: 'DELETE' });
                          setPrimaryQuestions(prev => prev.filter(x => x.id !== q.id));
                        }}
                        className={`text-sm shrink-0 transition-colors ${dark ? 'text-white/20 hover:text-red-400' : 'text-black/20 hover:text-red-500'}`}
                        aria-label="Delete question"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {primaryQuestions.length > 0 && (
                    <button
                      onClick={async () => {
                        await fetch(`/api/questions?sessionId=${sessionId}`, { method: 'DELETE' });
                        setPrimaryQuestions([]);
                      }}
                      className={`text-[10px] uppercase tracking-widest text-center mt-1 transition-colors ${dark ? 'text-white/20 hover:text-white/50' : 'text-black/20 hover:text-black/50'}`}
                    >
                      Clear all questions
                    </button>
                  )}
                </div>
              )}
              {tab === 'clarify' && (
                <p className={`text-sm text-center ${T.muted}`}>Generate clarifying questions to broadcast.</p>
              )}
              {tab === 'poll' && (
                <p className={`text-sm text-center ${T.muted}`}>Launch a poll to get instant audience feedback.</p>
              )}
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
