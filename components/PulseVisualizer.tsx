'use client';

import { useEffect, useRef } from 'react';

type SignalCounts = Record<string, number>;

const SIGNAL_TYPES = [
  { key: 'confused',  label: 'Confused',  color: '#f87171' }, // red
  { key: 'clear',     label: 'Clear',     color: '#34d399' }, // green
  { key: 'excited',   label: 'Excited',   color: '#fbbf24' }, // amber
  { key: 'slow_down', label: 'Slow down', color: '#60a5fa' }, // blue
  { key: 'question',  label: 'Question',  color: '#a78bfa' }, // purple
];

interface PulseVisualizerProps {
  counts: SignalCounts;
  dark?: boolean;
}

/** Returns a hex color blended toward red (confused) or green (clear) based on signal mix */
function dominantColor(counts: SignalCounts): string {
  const confused  = counts['confused']  ?? 0;
  const clear     = counts['clear']     ?? 0;
  const excited   = counts['excited']   ?? 0;
  const total     = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return '#6b7280'; // neutral grey

  const positiveRate = (clear + excited) / total;
  const confusionRate = confused / total;

  if (confusionRate >= 0.4) return '#f87171'; // red
  if (confusionRate >= 0.2) return '#fbbf24'; // amber
  if (positiveRate >= 0.6)  return '#34d399'; // green
  return '#6b7280';
}

export default function PulseVisualizer({ counts, dark = true }: PulseVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  const phaseRef  = useRef(0);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const max   = Math.max(...Object.values(counts), 1);
  const color = dominantColor(counts);

  // Animated pulse ring on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const baseR = size * 0.28;
    const amplitude = total > 0 ? size * 0.04 : size * 0.01;

    function draw() {
      ctx!.clearRect(0, 0, size, size);
      phaseRef.current += 0.04;
      const r = baseR + Math.sin(phaseRef.current) * amplitude;

      // Outer glow
      const grad = ctx!.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.4);
      grad.addColorStop(0, color + '40');
      grad.addColorStop(1, color + '00');
      ctx!.beginPath();
      ctx!.arc(cx, cy, r * 1.4, 0, Math.PI * 2);
      ctx!.fillStyle = grad;
      ctx!.fill();

      // Circle
      ctx!.beginPath();
      ctx!.arc(cx, cy, r, 0, Math.PI * 2);
      ctx!.strokeStyle = color;
      ctx!.lineWidth = 2;
      ctx!.stroke();

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [color, total]);

  const labelColor  = dark ? 'text-white/30' : 'text-black/40';
  const subColor    = dark ? 'text-white/40' : 'text-black/50';
  const barBg       = dark ? 'bg-white/10'   : 'bg-black/10';
  const barFill     = dark ? 'bg-white'       : 'bg-black';

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Animated circle */}
      <div className="relative flex items-center justify-center">
        <canvas ref={canvasRef} width={160} height={160} className="absolute" />
        <div className="relative flex flex-col items-center gap-0.5 z-10">
          <span className="text-4xl font-bold tabular-nums" style={{ color }}>{total}</span>
          <span className={`text-[11px] uppercase tracking-widest ${labelColor}`}>signals</span>
        </div>
      </div>

      {/* Per-signal bars */}
      <div className="w-full flex flex-col gap-2 mt-1">
        {SIGNAL_TYPES.map(s => {
          const c   = counts[s.key] ?? 0;
          const pct = (c / max) * 100;
          return (
            <div key={s.key} className="flex items-center gap-3">
              <span className={`text-xs w-20 ${subColor}`}>{s.label}</span>
              <div className={`flex-1 h-px relative ${barBg}`}>
                <div
                  className={`absolute inset-y-0 left-0 transition-all duration-500`}
                  style={{ width: `${pct}%`, height: '1px', backgroundColor: s.color }}
                />
              </div>
              <span className={`text-xs font-mono w-4 text-right ${subColor}`}>{c}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
