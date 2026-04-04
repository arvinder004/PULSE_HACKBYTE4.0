'use client';

import { useRouter } from 'next/navigation';

interface DashboardNavProps {
  sessionId: string;
  mode: 'speaker' | 'producer';
  dark: boolean;
  onToggleDark: () => void;
  signalCount?: number;
  transcriptLive?: boolean;
  // Optional speaker controls
  micSupported?: boolean;
  micEnabled?: boolean;
  onToggleMic?: () => void;
  aiPaused?: boolean;
  onToggleAiPause?: () => void;
  captionsEnabled?: boolean;
  onToggleCaptions?: () => void;
  onEndSession?: () => void;
}

export default function DashboardNav({
  sessionId,
  mode,
  dark,
  onToggleDark,
  signalCount = 0,
  transcriptLive = false,
  micSupported = true,
  micEnabled = false,
  onToggleMic,
  aiPaused = false,
  onToggleAiPause,
  captionsEnabled = true,
  onToggleCaptions,
  onEndSession,
}: DashboardNavProps) {
  const router = useRouter();
  const DEBUG = true;

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
        {/* Transcript live indicator */}
        {mode === 'speaker' && (
          <span className="flex items-center gap-1.5 px-3 py-1 text-xs border rounded-full border-transparent">
            <span className={`w-1.5 h-1.5 rounded-full ${transcriptLive ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
            <span className={transcriptLive ? 'text-emerald-400' : (dark ? 'text-white/20' : 'text-black/20')}>
              {transcriptLive ? 'Transcript live' : 'Transcript off'}
            </span>
          </span>
        )}

        {/* Signal count */}
        <span className={`px-3 py-1 text-xs border rounded-full ${t.tagBorder}`}>
          {signalCount > 0 ? `${signalCount} signals` : '0 signals'}
        </span>

        {/* AI pause (speaker only) */}
        {mode === 'speaker' && onToggleAiPause && (
          <button
            onClick={onToggleAiPause}
            className={`px-3 py-1 text-xs border rounded-full transition-colors ${t.toggle}`}
          >
            {aiPaused ? 'AI Paused' : 'AI On'}
          </button>
        )}

        {/* Mic toggle (speaker only) */}
        {mode === 'speaker' && onToggleMic && (
          <button
            onClick={onToggleMic}
            disabled={!micSupported}
            className={`px-3 py-1 text-xs border rounded-full transition-colors ${t.toggle} ${!micSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={micSupported ? 'Toggle microphone transcript' : 'Speech recognition not supported in this browser'}
          >
            {micSupported ? (micEnabled ? 'Mic On' : 'Mic Off') : 'Mic N/A'}
          </button>
        )}

        {/* Captions toggle (speaker only) */}
        {mode === 'speaker' && onToggleCaptions && (
          <button
            onClick={onToggleCaptions}
            className={`px-3 py-1 text-xs border rounded-full transition-colors ${t.toggle}`}
          >
            {captionsEnabled ? 'CC On' : 'CC Off'}
          </button>
        )}

        {/* Mode switcher */}
        <button
          onClick={() => {
            if (!sessionId) {
              if (DEBUG) console.log('[PULSE][Phase3][Nav] switch blocked: missing sessionId');
              return;
            }
            if (DEBUG) console.log('[PULSE][Phase3][Nav] switch', { to: switchTo, sessionId });
            router.push(`/${switchTo}/${sessionId}`);
          }}
          className={`px-3 py-1 text-xs border rounded-full transition-colors ${t.toggle}`}
        >
          Switch to {switchTo === 'speaker' ? 'Speaker' : 'Producer'}
        </button>

        {/* End session (speaker only) */}
        {mode === 'speaker' && onEndSession && (
          <button
            onClick={onEndSession}
            className="px-3 py-1 text-xs border rounded-full border-red-400 text-red-500 hover:text-red-600 cursor-pointer"
          >
            End
          </button>
        )}

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
