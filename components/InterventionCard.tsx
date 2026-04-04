"use client";

import { useEffect, useState } from 'react';

type Intervention = {
  id: string;
  message: string;
  suggestion?: string;
  urgency?: string;
  createdAt?: string;
};

export default function InterventionCard({ sessionId }: { sessionId: string }) {
  const [cards, setCards] = useState<Intervention[]>([]);
  const DEBUG = true;

  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/signals?sessionId=${sessionId}&sse=1`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'intervention') {
          const itv: Intervention = {
            id: msg.id ?? String(Date.now()),
            message: msg.message ?? msg.message,
            suggestion: msg.suggestion ?? msg.suggestion,
            urgency: msg.urgency ?? 'low',
            createdAt: new Date().toISOString(),
          };
          if (DEBUG) console.log('[PULSE][Phase3][Card] intervention', itv);
          setCards((c) => [itv, ...c].slice(0, 5));
          // Auto-remove after 8s
          setTimeout(() => setCards((c) => c.filter((x) => x.id !== itv.id)), 8000);
        }
      } catch (err) {
        // ignore
      }
    };
    return () => es.close();
  }, [sessionId]);

  if (cards.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3">
      {cards.map((c) => (
        <div key={c.id} className="w-80 bg-white/95 dark:bg-black/80 border rounded-lg shadow-lg p-3">
          <div className="flex justify-between items-start gap-2">
            <div className="text-sm font-semibold">{c.message}</div>
            <button
              className="text-xs text-gray-500 hover:text-gray-700"
              onClick={async () => {
                // acknowledge via API then remove locally
                try {
                  await fetch('/api/intervene/ack', { method: 'POST', body: JSON.stringify({ sessionId, interventionId: c.id }), headers: { 'Content-Type': 'application/json' } });
                } catch {}
                if (DEBUG) console.log('[PULSE][Phase3][Card] ack', c.id);
                setCards((cur) => cur.filter(x => x.id !== c.id));
              }}
            >
              Ack
            </button>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${c.urgency === 'high' ? 'border-red-400 text-red-500' : c.urgency === 'medium' ? 'border-yellow-400 text-yellow-500' : 'border-zinc-300 text-zinc-400'}`}>
              {c.urgency || 'low'}
            </span>
          </div>
          {c.suggestion && <div className="text-xs text-gray-600 mt-1">{c.suggestion}</div>}
        </div>
      ))}
    </div>
  );
}
