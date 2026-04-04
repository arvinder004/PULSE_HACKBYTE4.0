"use client";

import { useEffect, useState } from 'react';

type Intervention = {
  id: string;
  message: string;
  suggestion?: string;
  urgency?: string;
  createdAt?: string;
  expiresAt: number; // epoch ms
};

const AUTO_DISMISS_MS = 45_000; // 45s auto-dismiss

export default function InterventionCard({ sessionId, dark = true }: { sessionId: string; dark?: boolean }) {
  const [cards, setCards] = useState<Intervention[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/signals?sessionId=${sessionId}&sse=1`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'intervention') {
          const itv: Intervention = {
            id:         msg.id ?? String(Date.now()),
            message:    msg.message ?? '',
            suggestion: msg.suggestion,
            urgency:    msg.urgency ?? 'low',
            createdAt:  new Date().toISOString(),
            expiresAt:  Date.now() + AUTO_DISMISS_MS,
          };
          setCards(c => [itv, ...c].slice(0, 3));
          // Auto-dismiss AND auto-ack so server-side pending guard clears
          setTimeout(() => {
            setCards(c => c.filter(x => x.id !== itv.id));
            fetch('/api/intervene/ack', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId, interventionId: itv.id }),
            }).catch(() => {});
          }, AUTO_DISMISS_MS);
        }
        if (msg.type === 'intervention_ack') {
          setCards(c => c.filter(x => x.id !== msg.interventionId));
        }
      } catch {}
    };
    return () => es.close();
  }, [sessionId]);

  async function dismiss(id: string) {
    try {
      await fetch('/api/intervene/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, interventionId: id }),
      });
    } catch {}
    setCards(c => c.filter(x => x.id !== id));
  }

  if (cards.length === 0) return null;

  const border = dark ? 'border-white/10 bg-black/80 text-white' : 'border-black/10 bg-white/95 text-black';
  const sub    = dark ? 'text-white/50' : 'text-black/50';
  const btn    = dark ? 'text-white/30 hover:text-white' : 'text-black/30 hover:text-black';

  return (
    <div className="fixed top-14 right-4 z-50 flex flex-col gap-2 w-80">
      {cards.map(c => (
        <div key={c.id} className={`border rounded-xl shadow-xl p-4 backdrop-blur-sm animate-fade-in ${border}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-widest text-white/30">AI Coach</span>
                <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                  c.urgency === 'high'   ? 'border-red-400 text-red-400' :
                  c.urgency === 'medium' ? 'border-yellow-400 text-yellow-400' :
                                           'border-zinc-500 text-zinc-400'
                }`}>
                  {c.urgency}
                </span>
              </div>
              <p className="text-sm font-medium leading-snug">{c.message}</p>
              {c.suggestion && <p className={`text-xs mt-1 leading-relaxed ${sub}`}>{c.suggestion}</p>}
            </div>
            {/* Dismiss button */}
            <button
              onClick={() => dismiss(c.id)}
              className={`text-lg leading-none mt-0.5 transition-colors ${btn}`}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
