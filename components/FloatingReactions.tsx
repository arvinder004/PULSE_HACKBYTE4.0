'use client';

export type FloatingReaction = {
  id: number;
  emoji: string;
  x: number; // % from left
};

interface FloatingReactionsProps {
  reactions: FloatingReaction[];
}

export default function FloatingReactions({ reactions }: FloatingReactionsProps) {
  if (reactions.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-50">
      {reactions.map(r => (
        <span
          key={r.id}
          className="absolute text-2xl animate-float-up"
          style={{ left: `${r.x}%`, bottom: '20%' }}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
