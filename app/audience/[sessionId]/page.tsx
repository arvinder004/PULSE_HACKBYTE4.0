'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { getFingerprint } from '@/lib/fingerprint';
import SignalButtons, { type SignalKey } from '@/components/SignalButtons';
import FloatingReactions, { type FloatingReaction } from '@/components/FloatingReactions';

export const dynamic = 'force-dynamic';

type Tab = 'react' | 'ask';

const SIGNAL_EMOJI: Record<SignalKey, string> = {
  confused:  '😕',
  clear:     '✅',
  excited:   '🔥',
  slow_down: '🐢',
  question:  '✋',
};

const COOLDOWN_MS = 10_000;

export default function AudiencePage() {
  const params    = useParams();
  const sessionId = params?.sessionId as string;

  const [session,  setSession]  = useState<{ speakerName: string; topic: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab,      setTab]      = useState<Tab>('react');

  // signals
  const [lastSignal,    setLastSignal]    = useState<SignalKey | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownLeft,  setCooldownLeft]  = useState(0);
  const [sending,       setSending]       = useState(false);
  const [feedback,      setFeedback]      = useState<string | null>(null);

  // floating reactions
  const [reactions,  setReactions]  = useState<FloatingReaction[]>([]);
  const reactionId = useRef(0);

  // questions
  const [question,       setQuestion]       = useState('');
  const [qSending,       setQSending]       = useState(false);
  const [qFeedback,      setQFeedback]      = useState<string | null>(null);
  const [qCooldownUntil, setQCooldownUntil] = useState(0);
  const [qCooldownLeft,  setQCooldownLeft]  = useState(0);

  const audienceId  = useRef('');
  const fpRef       = useRef('');

  // ── Init stable IDs ──────────────────────────────────────────────────────
  useEffect(() => {
    let id = localStorage.getItem('pulse_audience_id');
    if (!id) {
      id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      localStorage.setItem('pulse_audience_id', id);
    }
    audienceId.current = id;
    getFingerprint().then(fp => { fpRef.current = fp; });
  }, []);

  // ── Load session ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/session?sessionId=${sessionId}`)
      .then(r => { if (r.status === 404) { setNotFound(true); return null; } return r.json(); })
      .then(d => d && setSession({ speakerName: d.speakerName, topic: d.topic }));
  }, [sessionId]);

  // ── Cooldown ticker ──────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setCooldownLeft(Math.max(0, Math.ceil((cooldownUntil - now) / 1000)));
      setQCooldownLeft(Math.max(0, Math.ceil((qCooldownUntil - now) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [cooldownUntil, qCooldownUntil]);

  // ── SSE — floating reactions from all audience members ───────────────────
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/signals?sessionId=${sessionId}&sse=1`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'signal') {
          const emoji = SIGNAL_EMOJI[msg.signal.signalType as SignalKey];
          if (!emoji) return;
          const id = ++reactionId.current;
          const x  = 10 + Math.random() * 80;
          setReactions(prev => [...prev.slice(-20), { id, emoji, x }]);
          setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 2200);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [sessionId]);

  // ── Send signal — HTTP + SpacetimeDB reducer ─────────────────────────────
  async function sendSignal(key: SignalKey) {
    if (Date.now() < cooldownUntil || sending) return;
    setSending(true);
    setLastSignal(key);

    const id = `${audienceId.current}-${Date.now()}`;

    try {
      // Primary: HTTP route (handles weighting, rate-limit, SSE broadcast)
      const res = await fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          signalType: key,
          audienceId: audienceId.current,
          fingerprint: fpRef.current,
        }),
      });

      if (res.ok) {
        const { weight } = await res.json();

        // Secondary: persist to SpacetimeDB for durable state + subscriptions
        try {
          const stdb = (window as any).__spacetimeReducers;
          stdb?.submitSignal?.({
            id,
            session_id:  sessionId,
            signal_type: key,
            audience_id: audienceId.current,
            fingerprint: fpRef.current,
            weight:      weight ?? 1.0,
          });
        } catch { /* SpacetimeDB optional — graceful degradation */ }

        setCooldownUntil(Date.now() + COOLDOWN_MS);
        setFeedback('Sent!');
        setTimeout(() => setFeedback(null), 1500);
      } else if (res.status === 429) {
        const d = await res.json().catch(() => ({}));
        setFeedback(`Wait ${d.retryAfter ?? '?'}s`);
        setTimeout(() => setFeedback(null), 2000);
      }
    } catch {
      setFeedback('Failed to send');
      setTimeout(() => setFeedback(null), 2000);
    } finally {
      setSending(false);
    }
  }

  // ── Send question ────────────────────────────────────────────────────────
  async function sendQuestion() {
    const text = question.trim();
    if (!text || qSending || Date.now() < qCooldownUntil) return;
    setQSending(true);
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text, audienceId: audienceId.current }),
      });
      if (res.ok) {
        setQuestion('');
        setQCooldownUntil(Date.now() + 30_000);
        setQFeedback('Question submitted!');
      } else {
        const d = await res.json().catch(() => ({}));
        setQFeedback(d.error ?? 'Failed to submit');
      }
    } catch {
      setQFeedback('Failed to submit');
    } finally {
      setQSending(false);
      setTimeout(() => setQFeedback(null), 3000);
    }
  }

  // ── Error / loading states ───────────────────────────────────────────────
  if (notFound) return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-50 px-4">
      <div className="text-center">
        <p className="text-sm text-zinc-500 uppercase tracking-widest mb-2">Session not found</p>
        <p className="text-xs text-zinc-400">The session may have ended or the link is invalid.</p>
      </div>
    </div>
  );

  if (!session) return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-50 px-4">
      <p className="text-sm text-zinc-400">Loading…</p>
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50">
      <FloatingReactions reactions={reactions} />

      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-4 py-4">
        <p className="text-xs text-zinc-400 uppercase tracking-widest">Audience</p>
        <h1 className="text-lg font-semibold text-zinc-900 mt-0.5 leading-tight">{session.topic}</h1>
        <p className="text-sm text-zinc-500">with {session.speakerName}</p>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 bg-white">
        {(['react', 'ask'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-zinc-900 text-zinc-900'
                : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            {t === 'react' ? 'React' : 'Ask'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-6 max-w-sm mx-auto w-full">

        {tab === 'react' && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-zinc-400 uppercase tracking-widest">How's it going?</p>
            <SignalButtons
              onSignal={sendSignal}
              lastSignal={lastSignal}
              cooldownLeft={cooldownLeft}
              sending={sending}
            />
            {feedback && (
              <p className="text-sm text-center text-zinc-500">{feedback}</p>
            )}
          </div>
        )}

        {tab === 'ask' && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-zinc-400 uppercase tracking-widest">Ask a question</p>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value.slice(0, 200))}
              disabled={qCooldownLeft > 0}
              placeholder="What's on your mind?"
              rows={4}
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 resize-none outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">{question.length}/200</span>
              {qCooldownLeft > 0 && (
                <span className="text-xs text-zinc-400">Wait {qCooldownLeft}s</span>
              )}
            </div>
            <button
              onClick={sendQuestion}
              disabled={!question.trim() || qSending || qCooldownLeft > 0}
              className="w-full py-3 rounded-full bg-zinc-900 text-white text-sm font-medium transition hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {qSending ? 'Submitting…' : 'Submit question'}
            </button>
            {qFeedback && (
              <p className="text-sm text-center text-zinc-500">{qFeedback}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
