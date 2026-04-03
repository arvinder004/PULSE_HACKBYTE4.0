'use client';

import { useRouter } from 'next/navigation';

interface DashboardNavProps {
  sessionId: string;
  mode: 'speaker' | 'producer';
  dark: boolean;
  onToggleDark: () => void;
  signalCount?: number;
}

export default function DashboardNav({ sessionId, mode, dark, onToggleDark, signalCount = 0 }: DashboardNavProps) {
  const router = useRouter();

  const t = dark
    ? { nav: 'bg-black border-white/10', label: 'text-white/30', muted: 'text-white/20', toggle: 'bg-white/10 text-white/60 hover:text-white border-white/10', tagBorder: 'border-white/10 text-white/40', tagActive: 'border-white/40 text-white bg-white/5' }
    : { nav: 'bg-white border-black/10', label: 'text-black/40', muted: 'text-black/25', toggle: 'bg-black/6 text-black/50 hover:text-black border-black/10', tagBorder: 'border-black/15 text-black/50', tagActive: 'border-black/50 text-black bg-black/5' };

  const switchTo = mode === 'speaker' ? 'producer' : 'speaker';

  return (
    <nav className={`h-12 border-b flex items-center justify-between px-6 shrink-0 ${t.nav}`}>
      <div className="flex items-center gap-4">
        <span className="text-sm font-semibold tracking-tight">PULSE</span>
        <span className={`text-xs ${t.label}`}>{mode === 'speaker' ? 'Speaker' : 'Producer'}</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Signal count */}
        <span className={`px-3 py-1 text-xs border rounded-full ${t.tagBorder}`}>
          {signalCount > 0 ? `${signalCount} signals` : '0 signals'}
        </span>

        {/* Mode switcher */}
        <button
          onClick={() => router.push(`/${switchTo}/${sessionId}`)}
          className={`px-3 py-1 text-xs border rounded-full transition-colors ${t.toggle}`}
        >
          Switch to {switchTo === 'speaker' ? 'Speaker' : 'Producer'}
        </button>

        {/* Session ID */}
        <span className={`text-xs font-mono ml-1 ${t.muted}`}>{sessionId}</span>

        {/* Dark mode toggle */}
        <button
          onClick={onToggleDark}
          className={`ml-1 px-3 py-1 text-xs rounded-full border transition-colors ${t.toggle}`}
        >
          {dark ? 'Light' : 'Dark'}
        </button>
      </div>
    </nav>
  );
}
