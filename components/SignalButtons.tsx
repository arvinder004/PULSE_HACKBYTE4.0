'use client';

type SignalKey = 'confused' | 'clear' | 'excited' | 'slow_down' | 'question';

const SIGNALS: { key: SignalKey; emoji: string; label: string }[] = [
  { key: 'confused',  emoji: '😕', label: 'Confused'  },
  { key: 'clear',     emoji: '✅', label: 'Clear'      },
  { key: 'excited',   emoji: '🔥', label: 'Excited'    },
  { key: 'slow_down', emoji: '🐢', label: 'Slow down'  },
  { key: 'question',  emoji: '✋', label: 'Question'   },
];

interface SignalButtonsProps {
  onSignal: (key: SignalKey) => void;
  lastSignal: SignalKey | null;
  cooldownLeft: number;   // seconds remaining; 0 = ready
  sending: boolean;
}

export default function SignalButtons({ onSignal, lastSignal, cooldownLeft, sending }: SignalButtonsProps) {
  const onCooldown = cooldownLeft > 0;

  return (
    <div className="flex flex-col gap-3">
      {SIGNALS.map(s => {
        const isActive = lastSignal === s.key && onCooldown;
        return (
          <button
            key={s.key}
            onClick={() => onSignal(s.key)}
            disabled={onCooldown || sending}
            className={`flex items-center gap-4 px-5 py-4 rounded-2xl border text-left transition-all active:scale-95 ${
              isActive
                ? 'bg-zinc-900 border-zinc-900 text-white'
                : onCooldown
                ? 'bg-white border-zinc-200 text-zinc-300 cursor-not-allowed'
                : 'bg-white border-zinc-200 text-zinc-800 hover:border-zinc-400 hover:shadow-sm'
            }`}
          >
            <span className="text-2xl">{s.emoji}</span>
            <span className="text-sm font-medium">{s.label}</span>
          </button>
        );
      })}

      <div className="h-6 flex items-center justify-center">
        {onCooldown && (
          <p className="text-sm text-zinc-400">Next signal in {cooldownLeft}s</p>
        )}
      </div>
    </div>
  );
}

export type { SignalKey };
