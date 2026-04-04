'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useEffect } from 'react';

interface DashboardNavProps {
  sessionId: string;
  mode: 'speaker' | 'producer';
  dark: boolean;
  onToggleDark: () => void;
  signalCount?: number;
  transcriptLive?: boolean;
  confirmEnd?: boolean;
  sessionActive?: boolean; // true only while session is running
  // Optional speaker controls
  micSupported?: boolean;
  micEnabled?: boolean;
  onToggleMic?: () => void;
  aiPaused?: boolean;
  onToggleAiPause?: () => void;
  captionsEnabled?: boolean;
  onToggleCaptions?: () => void;
  onEndSession?: () => void;
  // Mic device picker
  micDevices?: { deviceId: string; label: string }[];
  selectedMicDeviceId?: string;
  onSwitchMicDevice?: (deviceId: string) => void;
}

export default function DashboardNav({
  sessionId,
  mode,
  dark,
  onToggleDark,
  signalCount = 0,
  transcriptLive = false,
  confirmEnd = false,
  sessionActive = false,
  micSupported = true,
  micEnabled = false,
  onToggleMic,
  aiPaused = false,
  onToggleAiPause,
  captionsEnabled = true,
  onToggleCaptions,
  onEndSession,
  micDevices = [],
  selectedMicDeviceId = '',
  onSwitchMicDevice,
}: DashboardNavProps) {
  const router = useRouter();
  const DEBUG = true;

  const t = dark
    ? { nav: 'bg-black border-white/10', label: 'text-white/30', muted: 'text-white/20', toggle: 'bg-white/10 text-white/60 hover:text-white border-white/10', tagBorder: 'border-white/10 text-white/40', tagActive: 'border-white/40 text-white bg-white/5' }
    : { nav: 'bg-white border-black/10', label: 'text-black/40', muted: 'text-black/25', toggle: 'bg-black/6 text-black/50 hover:text-black border-black/10', tagBorder: 'border-black/15 text-black/50', tagActive: 'border-black/50 text-black bg-black/5' };

  const disabledCls = 'opacity-30 cursor-not-allowed pointer-events-none select-none';

  const switchTo = mode === 'speaker' ? 'producer' : 'speaker';

  return (
    <nav className={`h-12 border-b flex items-center justify-between px-6 shrink-0 ${t.nav}`}>
      <div className="flex items-center gap-4">
        <span className="text-sm font-semibold tracking-tight">PULSE</span>
        <span className={`text-xs ${t.label}`}>{mode === 'speaker' ? 'Speaker' : 'Producer'}</span>

        {/* Mic device picker — speaker only, only when devices are available */}
        {mode === 'speaker' && micDevices.length > 0 && onSwitchMicDevice && (
          <MicPicker
            dark={dark}
            devices={micDevices}
            selectedDeviceId={selectedMicDeviceId}
            onSelect={(id) => {
              if (DEBUG) console.log('[PULSE][Phase4][Mic] user selected device', {
                deviceId: id.slice(0, 8),
                label: micDevices.find(d => d.deviceId === id)?.label,
              });
              onSwitchMicDevice(id);
            }}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Transcript live indicator */}
        {mode === 'speaker' && (
          <span className="flex items-center gap-1.5 px-3 py-1 text-xs border rounded-full border-transparent">
            {transcriptLive ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
            )}
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
            disabled={!sessionActive}
            className={`px-3 py-1 text-xs border rounded-full transition-colors ${t.toggle} ${!sessionActive ? disabledCls : ''}`}
          >
            {aiPaused ? 'AI Paused' : 'AI On'}
          </button>
        )}

        {/* Mic toggle (speaker only) */}
        {mode === 'speaker' && onToggleMic && (
          <button
            onClick={onToggleMic}
            disabled={!micSupported || !sessionActive}
            className={`px-3 py-1 text-xs border rounded-full transition-colors ${t.toggle} ${(!micSupported || !sessionActive) ? disabledCls : ''}`}
            title={micSupported ? 'Toggle microphone transcript' : 'Deepgram streaming not supported in this browser'}
          >
            {micSupported ? (micEnabled ? 'Mic On' : 'Mic Off') : 'Mic N/A'}
          </button>
        )}

        {/* Captions toggle (speaker only) */}
        {mode === 'speaker' && onToggleCaptions && (
          <button
            onClick={onToggleCaptions}
            disabled={!sessionActive}
            className={`px-3 py-1 text-xs border rounded-full transition-colors ${t.toggle} ${!sessionActive ? disabledCls : ''}`}
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
            disabled={!sessionActive}
            className={`px-3 py-1 text-xs border rounded-full transition-colors cursor-pointer ${
              !sessionActive
                ? `border-red-400/30 text-red-500/30 ${disabledCls}`
                : confirmEnd
                  ? 'border-red-500 bg-red-500 text-white'
                  : 'border-red-400 text-red-500 hover:text-red-600'
            }`}
          >
            {confirmEnd ? 'Confirm?' : 'End'}
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

function MicPicker({
  dark,
  devices,
  selectedDeviceId,
  onSelect,
}: {
  dark: boolean;
  devices: { deviceId: string; label: string }[];
  selectedDeviceId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = devices.find(d => d.deviceId === selectedDeviceId) ?? devices[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const base = dark
    ? 'bg-black border-white/10 text-white/60'
    : 'bg-white border-black/10 text-black/60';
  const hover = dark ? 'hover:bg-white/5' : 'hover:bg-black/5';
  const activeItem = dark ? 'bg-white/10 text-white' : 'bg-black/8 text-black';

  const truncate = (s: string, n = 24) => s.length > n ? s.slice(0, n) + '…' : s;

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <span className="text-xs opacity-40">🎙</span>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-0.5 text-xs border rounded-full transition-colors ${base} ${hover}`}
      >
        <span className="max-w-[130px] truncate">{selected ? truncate(selected.label) : 'Select mic'}</span>
        <span className="opacity-40 text-[9px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className={`absolute top-full left-0 mt-1.5 z-50 min-w-[200px] rounded-xl border shadow-xl overflow-hidden ${base}`}>
          {devices.map(d => (
            <button
              key={d.deviceId}
              onClick={() => { onSelect(d.deviceId); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${hover} ${d.deviceId === selectedDeviceId ? activeItem : ''}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
