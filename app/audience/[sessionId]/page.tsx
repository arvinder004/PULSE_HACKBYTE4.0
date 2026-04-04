'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { getFingerprint } from '@/lib/fingerprint';
import SignalButtons, { type SignalKey } from '@/components/SignalButtons';
import FloatingReactions, { type FloatingReaction } from '@/components/FloatingReactions';

export const dynamic = 'force-dynamic';

type Tab = 'react' | 'ask' | 'chat';

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
  const [dark,     setDark]     = useState(false);

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

  // chat
  type ChatMsg = { role: 'user' | 'bot'; text: string; stale?: boolean };
  const [chatInput,       setChatInput]       = useState('');
  const [chatMessages,    setChatMessages]    = useState<ChatMsg[]>([]);
  const [chatSending,     setChatSending]     = useState(false);
  const [chatCooldownUntil, setChatCooldownUntil] = useState(0);
  const [chatCooldownLeft,  setChatCooldownLeft]  = useState(0);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const audienceId  = useRef('');
  const fpRef       = useRef('');
  const [isPrimary, setIsPrimary] = useState(false);

  // ── Init stable IDs ──────────────────────────────────────────────────────
  useEffect(() => {
    let id = localStorage.getItem('pulse_audience_id');
    if (!id) {
      id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      localStorage.setItem('pulse_audience_id', id);
    }
    audienceId.current = id;
    getFingerprint().then(fp => { fpRef.current = fp; });

    // If ?primary=1 in URL, register this device as the primary judge
    const params = new URLSearchParams(window.location.search);
    if (params.get('primary') === '1' && sessionId) {
      fetch(`/api/session/primary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, audienceId: id }),
      }).then(r => r.ok && setIsPrimary(true));
    } else if (sessionId) {
      // Check if this device is already the primary
      fetch(`/api/session/primary?sessionId=${sessionId}`)
        .then(r => r.json())
        .then(d => { if (d.primaryAudienceId === id) setIsPrimary(true); });
    }
  }, [sessionId]);

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
      setChatCooldownLeft(Math.max(0, Math.ceil((chatCooldownUntil - now) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [cooldownUntil, qCooldownUntil, chatCooldownUntil]);

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

  // ── Send chat message ────────────────────────────────────────────────────
  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatSending || chatCooldownLeft > 0) return;
    setChatInput('');
    setChatSending(true);
    setChatMessages(prev => [...prev, { role: 'user', text }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, question: text, audienceId: audienceId.current }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (res.ok) {
        setChatMessages(prev => [...prev, {
          role: 'bot',
          text: data.answer,
          stale: data.transcriptAge != null && data.transcriptAge > 60,
        }]);
        setChatCooldownUntil(Date.now() + 5_000);
      } else if (res.status === 429) {
        setChatMessages(prev => [...prev, { role: 'bot', text: `Please wait ${data.retryAfter ?? '?'}s before asking again.` }]);
      } else {
        setChatMessages(prev => [...prev, { role: 'bot', text: data.error ?? 'Something went wrong.' }]);
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'bot', text: 'Failed to reach the server.' }]);
    } finally {
      setChatSending(false);
    }
  }

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── Error / loading states ───────────────────────────────────────────────
  if (notFound) return (
    <div className={`flex items-center justify-center min-h-screen px-4 ${dark ? 'bg-black' : 'bg-zinc-50'}`}>
      <div className="text-center">
        <p className={`text-sm uppercase tracking-widest mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>Session not found</p>
        <p className={`text-xs ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>The session may have ended or the link is invalid.</p>
      </div>
    </div>
  );

  if (!session) return (
    <div className={`flex items-center justify-center min-h-screen px-4 ${dark ? 'bg-black' : 'bg-zinc-50'}`}>
      <p className={`text-sm ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Loading…</p>
    </div>
  );

  const T = {
    root:        dark ? 'bg-black text-white'        : 'bg-zinc-50 text-zinc-900',
    header:      dark ? 'bg-zinc-950 border-white/10' : 'bg-white border-zinc-200',
    headerLabel: dark ? 'text-white/30'               : 'text-zinc-400',
    headerTitle: dark ? 'text-white'                  : 'text-zinc-900',
    headerSub:   dark ? 'text-white/50'               : 'text-zinc-500',
    tabBar:      dark ? 'bg-zinc-950 border-white/10' : 'bg-white border-zinc-200',
    tabActive:   dark ? 'border-white text-white'     : 'border-zinc-900 text-zinc-900',
    tabInactive: dark ? 'border-transparent text-white/30 hover:text-white/60' : 'border-transparent text-zinc-400 hover:text-zinc-600',
    sectionLabel:dark ? 'text-white/30'               : 'text-zinc-400',
    feedback:    dark ? 'text-white/50'               : 'text-zinc-500',
    textarea:    dark ? 'border-white/10 bg-zinc-900 text-white placeholder:text-white/20 focus:border-white/30 focus:ring-white/10' : 'border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-zinc-900/10',
    charCount:   dark ? 'text-white/30'               : 'text-zinc-400',
    submitBtn:   dark ? 'bg-white text-black hover:bg-white/80' : 'bg-zinc-900 text-white hover:bg-zinc-700',
    darkToggle:  dark ? 'text-white/30 hover:text-white/60' : 'text-zinc-400 hover:text-zinc-600',
    chatBubbleUser: dark ? 'bg-white text-black' : 'bg-zinc-900 text-white',
    chatBubbleBot:  dark ? 'bg-white/10 text-white' : 'bg-white text-zinc-900 border border-zinc-200',
    chatStale:      dark ? 'text-yellow-400/60' : 'text-yellow-600',
    chatInput:   dark ? 'border-white/10 bg-zinc-900 text-white placeholder:text-white/20 focus:border-white/30' : 'border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400',
  };

  return (
    <div className={`flex flex-col min-h-screen ${T.root}`}>
      <FloatingReactions reactions={reactions} />

      {/* Header */}
      <header className={`border-b px-4 py-4 flex items-start justify-between ${T.header}`}>
        <div>
          <p className={`text-xs uppercase tracking-widest ${T.headerLabel}`}>Audience</p>
          <h1 className={`text-lg font-semibold mt-0.5 leading-tight ${T.headerTitle}`}>{session.topic}</h1>
          <p className={`text-sm ${T.headerSub}`}>with {session.speakerName}</p>
          {isPrimary && (
            <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[10px] font-medium uppercase tracking-widest">
              ★ Primary judge
            </span>
          )}
        </div>
        <button
          onClick={() => setDark(v => !v)}
          className={`mt-1 text-lg transition-colors ${T.darkToggle}`}
          aria-label="Toggle dark mode"
        >
          {dark ? '☀️' : '🌙'}
        </button>
      </header>

      {/* Tabs */}
      <div className={`flex border-b ${T.tabBar}`}>
        {(['react', 'ask', 'chat'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t ? T.tabActive : T.tabInactive
            }`}
          >
            {t === 'react' ? 'React' : t === 'ask' ? 'Ask' : 'Chat'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-6 max-w-sm mx-auto w-full">

        {tab === 'react' && (
          <div className="flex flex-col gap-4">
            <p className={`text-xs uppercase tracking-widest ${T.sectionLabel}`}>How's it going?</p>
            <SignalButtons
              onSignal={sendSignal}
              lastSignal={lastSignal}
              cooldownLeft={cooldownLeft}
              sending={sending}
            />
            {feedback && (
              <p className={`text-sm text-center ${T.feedback}`}>{feedback}</p>
            )}
          </div>
        )}

        {tab === 'ask' && (
          <div className="flex flex-col gap-4">
            <p className={`text-xs uppercase tracking-widest ${T.sectionLabel}`}>Ask a question</p>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value.slice(0, 200))}
              disabled={qCooldownLeft > 0}
              placeholder="What's on your mind?"
              rows={4}
              className={`w-full rounded-2xl border px-4 py-3 text-sm resize-none outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${T.textarea}`}
            />
            <div className="flex items-center justify-between">
              <span className={`text-xs ${T.charCount}`}>{question.length}/200</span>
              {qCooldownLeft > 0 && (
                <span className={`text-xs ${T.charCount}`}>Wait {qCooldownLeft}s</span>
              )}
            </div>
            <button
              onClick={sendQuestion}
              disabled={!question.trim() || qSending || qCooldownLeft > 0}
              className={`w-full py-3 rounded-full text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${T.submitBtn}`}
            >
              {qSending ? 'Submitting…' : 'Submit question'}
            </button>
            {qFeedback && (
              <p className={`text-sm text-center ${T.feedback}`}>{qFeedback}</p>
            )}
          </div>
        )}
        {tab === 'chat' && (
          <div className="flex flex-col gap-3 h-full">
            <p className={`text-xs uppercase tracking-widest ${T.sectionLabel}`}>Ask the AI about this talk</p>

            {/* Message list */}
            <div className="flex flex-col gap-3 flex-1 overflow-y-auto max-h-[55vh] pb-2">
              {chatMessages.length === 0 && (
                <p className={`text-sm text-center mt-8 ${T.feedback}`}>
                  Ask anything about what the speaker has covered so far.
                </p>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user' ? T.chatBubbleUser : T.chatBubbleBot
                  }`}>
                    {msg.text}
                    {msg.stale && (
                      <p className={`text-[10px] mt-1 ${T.chatStale}`}>Context may be slightly behind</p>
                    )}
                  </div>
                </div>
              ))}
              {chatSending && (
                <div className="flex justify-start">
                  <div className={`px-4 py-2.5 rounded-2xl text-sm ${T.chatBubbleBot}`}>
                    <span className="animate-pulse">Thinking…</span>
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value.slice(0, 300))}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                disabled={chatSending || chatCooldownLeft > 0}
                placeholder={chatCooldownLeft > 0 ? `Wait ${chatCooldownLeft}s…` : 'Ask something…'}
                className={`flex-1 rounded-full border px-4 py-2.5 text-sm outline-none transition-colors disabled:opacity-50 ${T.chatInput}`}
              />
              <button
                onClick={sendChat}
                disabled={!chatInput.trim() || chatSending || chatCooldownLeft > 0}
                className={`px-4 py-2.5 rounded-full text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${T.submitBtn}`}
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
