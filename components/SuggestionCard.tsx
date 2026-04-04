'use client';

import { useEffect, useRef, useState } from 'react';

export type LiveSuggestion = {
  id: string;
  message: string;
  detail: string;
  urgency: 'urgent' | 'medium' | 'low';
  category: string;
  escalated: boolean;
  createdAt: string;
  // internal
  removeAt?: number;
};

// Auto-dismiss timeouts per urgency
const AUTO_DISMISS: Record<string, number> = {
  urgent: Infinity, // manual only
  medium: 60_000,   // 1 min
  low:    30_000,   // 30 s
};

const URGENCY_STYLE: Record<string, string> = {
  urgent: 'border-red-500/60 bg-red-950/40',
  medium: 'border-yellow-500/50 bg-yellow-950/30',
  low:    'border-zinc-600/40 bg-zinc-900/40',
};

const URGENCY_BADGE: Record<string, string> = {
  urgent: 'border-red-400 text-red-400',
  medium: 'border-yellow-400 text-yellow-400',
  low:    'border-zinc-500 text-zinc-400',
};

export default function SuggestionCard({
  sessionId,
  dark = true,
}: {
  sessionId: string;
  dark?: boolean;
}) {
  const [cards, setCards] = useState<LiveSuggestion[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function scheduleRemove(id: string, urgency: string) {
    const delay = AUTO_DISMISS[urgency];
    if (!isFinite(delay)) return; // urgent — manual only
    const t = setTimeout(() => removeCard(id), delay);
    timers.current.set(id, t);
  }

  function removeCard(id: string) {
    setCards(c => c.filter(x => x.id !== id));
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  }

  async function dismiss(id: string) {
    removeCard(id);
    try {
      await fetch('/api/suggest', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, suggestionId: id }),
      });
    } catch {}
  }

  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/signals?sessionId=${sessionId}&sse=1`);

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === 'suggestion') {
          const card: LiveSuggestion = {
            id:        msg.id,
            message:   msg.message,
            detail:    msg.detail,
            urgency:   msg.urgency,
            category:  msg.category,
            escalated: msg.escalated ?? false,
            createdAt: msg.createdAt,
          };
          setCards(c => [card, ...c].slice(0, 5));
          scheduleRemove(card.id, card.urgency);
        }

        if (msg.type === 'suggestion_escalate') {
          // Upgrade urgency on an existing card — cancel its auto-dismiss timer
          setCards(c => c.map(x =>
            x.id === msg.suggestionId
              ? { ...x, urgency: 'urgent', escalated: true }
              : x
          ));
          const t = timers.current.get(msg.suggestionId);
          if (t) { clearTimeout(t); timers.current.delete(msg.suggestionId); }
        }

        if (msg.type === 'suggestion_dismiss') {
          removeCard(msg.suggestionId);
        }
      } catch {}
    };

    return () => {
      es.close();
      timers.current.forEach(t => clearTimeout(t));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (cards.length === 0) return null;

  return (
    <div className="fixed top-14 right-4 z-50 flex flex-col gap-2 w-80">
      {cards.map(card => (
        <div
          key={card.id}
          className={`border rounded-xl shadow-xl p-4 backdrop-blur-sm text-white transition-all ${URGENCY_STYLE[card.urgency]}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${URGENCY_BADGE[card.urgency]}`}>
                  {card.urgency}
                </span>
                <span className="text-[10px] text-white/30 uppercase tracking-widest">{card.category}</span>
                {card.escalated && (
                  <span className="text-[10px] text-red-400 uppercase tracking-widest">↑ escalated</span>
                )}
              </div>
              <p className="text-sm font-medium leading-snug">{card.message}</p>
              {card.detail && (
                <p className="text-xs mt-1 leading-relaxed text-white/50">{card.detail}</p>
              )}
              {card.urgency !== 'urgent' && (
                <p className="text-[10px] text-white/20 mt-2">
                  Auto-dismisses in {card.urgency === 'medium' ? '1 min' : '30 s'}
                </p>
              )}
            </div>
            {/* Urgent always shows ✕; others show it too for manual early dismiss */}
            <button
              onClick={() => dismiss(card.id)}
              className="text-lg leading-none mt-0.5 text-white/30 hover:text-white transition-colors shrink-0"
              aria-label="Dismiss suggestion"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
