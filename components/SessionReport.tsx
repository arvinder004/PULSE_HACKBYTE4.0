'use client';

import { useEffect, useRef, useState } from 'react';

interface CoachSegment {
  windowStart: number;
  windowEnd: number;
  timeLabel: string;
  bullets: string[];
  focusTags: string[];
}

interface CoachReport {
  overallSummary: string;
  topStrengths: string[];
  topImprovements: string[];
  segments: CoachSegment[];
}

interface Props {
  coachReport: CoachReport;
  dark: boolean;
  captionMuted: string;
  transcriptHistory: { text: string; startTs: number }[];
  captionHistory: { id: string; text: string; ts: number }[];
}

// Format elapsed ms as m:ss
function fmtElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Animate card in on viewport entry
function AnimatedCard({
  children, delay = 0, className = '', style = {}, onClick,
}: {
  children: React.ReactNode; delay?: number; className?: string;
  style?: React.CSSProperties; onClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.05 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.97)',
        transition: `opacity 0.4s ease ${delay}ms, transform 0.4s ease ${delay}ms`,
        ...style,
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

function EmphasisBadge({ children, color }: { children: React.ReactNode; color: string }) {
  const [pop, setPop] = useState(false);
  useEffect(() => { const t = setTimeout(() => setPop(true), 400); return () => clearTimeout(t); }, []);
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[11px] border ${color}`}
      style={{
        transform: pop ? 'scale(1)' : 'scale(0.6)',
        opacity: pop ? 1 : 0,
        transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease',
        display: 'inline-block',
      }}
    >
      {children}
    </span>
  );
}

// Modal that shows transcript scrolled to a given timestamp
function CaptionsModal({
  dark, windowStart, timeLabel, transcriptHistory, captionHistory, onClose,
}: {
  dark: boolean;
  windowStart: number;
  timeLabel: string;
  transcriptHistory: { text: string; startTs: number }[];
  captionHistory: { id: string; text: string; ts: number }[];
  onClose: () => void;
}) {
  const targetRef = useRef<HTMLDivElement>(null);
  const border = dark ? 'border-white/10' : 'border-black/10';
  const bg = dark ? 'bg-[#0d0d0d]' : 'bg-white';
  const textMuted = dark ? 'text-white/40' : 'text-black/40';
  const textMain = dark ? 'text-white/80' : 'text-black/80';

  // All captions merged and sorted
  const allCaptions: { ts: number; text: string; id: string }[] = [
    ...transcriptHistory.map((c, i) => ({ ts: c.startTs, text: c.text, id: `hist-${i}` })),
    ...captionHistory.map(c => ({ ts: c.ts, text: c.text, id: c.id })),
  ].sort((a, b) => a.ts - b.ts);

  // Scroll to closest caption after mount
  useEffect(() => {
    if (!targetRef.current) return;
    setTimeout(() => {
      targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Find the closest caption index to windowStart
  let closestIdx = 0;
  let closestDiff = Infinity;
  allCaptions.forEach((c, i) => {
    const diff = Math.abs(c.ts - windowStart);
    if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', animation: 'fadeIn 0.2s ease' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <style>{`
        @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
        @keyframes slideUp { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }
      `}</style>
      <div
        className={`w-full max-w-lg rounded-2xl border flex flex-col overflow-hidden ${bg} ${border}`}
        style={{ maxHeight: '80vh', animation: 'slideUp 0.25s cubic-bezier(0.34,1.2,0.64,1)' }}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-emerald-400 mb-0.5">Captions</div>
            <div className={`text-sm font-medium ${dark ? 'text-white' : 'text-black'}`}>
              Segment · {timeLabel}
            </div>
          </div>
          <button
            onClick={onClose}
            className={`w-7 h-7 rounded-full flex items-center justify-center text-sm transition-colors ${dark ? 'bg-white/10 hover:bg-white/20 text-white/60' : 'bg-black/8 hover:bg-black/15 text-black/50'}`}
          >
            ✕
          </button>
        </div>

        {/* Caption list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-1">
          {allCaptions.length === 0 && (
            <div className={`py-8 text-center text-sm ${textMuted}`}>No captions available.</div>
          )}
          {allCaptions.map((c, i) => {
            const isTarget = i === closestIdx;
            const elapsed = c.ts > 0 ? fmtElapsed(c.ts - (allCaptions[0]?.ts ?? c.ts)) : '';
            return (
              <div
                key={c.id}
                ref={isTarget ? targetRef : undefined}
                className={`flex gap-3 px-3 py-2 rounded-xl text-xs transition-all duration-300 ${
                  isTarget
                    ? dark ? 'bg-emerald-500/15 border border-emerald-500/30' : 'bg-emerald-50 border border-emerald-200'
                    : 'border border-transparent'
                }`}
              >
                <span className={`shrink-0 font-mono mt-0.5 ${isTarget ? 'text-emerald-400' : textMuted}`}>
                  {elapsed || '—'}
                </span>
                <span className={isTarget ? (dark ? 'text-white' : 'text-black') : textMain}>{c.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function SessionReport({ coachReport, dark, captionMuted, transcriptHistory, captionHistory }: Props) {
  const [activeSegment, setActiveSegment] = useState<number | null>(null);
  const [modalSeg, setModalSeg] = useState<CoachSegment | null>(null);
  const ganttRef = useRef<HTMLDivElement>(null);

  const border = dark ? 'border-white/10' : 'border-black/10';
  const cardBg = dark ? 'bg-white/5' : 'bg-black/5';
  const textSub = dark ? 'text-white/40' : 'text-black/40';
  const textMain = dark ? 'text-white' : 'text-black';

  const segments = coachReport.segments ?? [];

  // Use windowStart as epoch ms — derive elapsed from first segment
  const sessionStartMs = segments.length ? segments[0].windowStart : 0;
  const minTs = sessionStartMs;
  const maxTs = segments.length ? Math.max(...segments.map(s => s.windowEnd)) : minTs + 1;
  const totalDuration = maxTs - minTs || 1;

  // Time axis ticks — elapsed time labels
  const TICK_COUNT = 6;
  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => {
    const elapsed = (totalDuration / (TICK_COUNT - 1)) * i;
    return { elapsed, label: fmtElapsed(elapsed) };
  });

  // Card popup position: alternate above/below to avoid overlap
  const CARD_HEIGHT = 200; // px estimate for gantt row height
  const GANTT_TRACK_H = 32; // px

  return (
    <div className="w-full max-w-5xl mt-4 px-2 flex flex-col gap-6">

      {/* ── Top grid: Overall + Strengths/Improvements ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AnimatedCard delay={0} className={`md:col-span-2 rounded-2xl border px-5 py-5 ${cardBg} ${border}`}>
          <div className={`text-[10px] uppercase tracking-widest mb-2 ${captionMuted}`}>Session Overview</div>
          <p className={`text-sm leading-relaxed ${textMain}`}>{coachReport.overallSummary}</p>
        </AnimatedCard>

        <div className="flex flex-col gap-4">
          <AnimatedCard delay={80} className={`rounded-2xl border px-4 py-4 flex-1 ${cardBg} ${border}`}>
            <div className="text-[10px] uppercase tracking-widest mb-2 text-emerald-400">Strengths</div>
            <div className="flex flex-wrap gap-1.5">
              {coachReport.topStrengths?.map((s, i) => (
                <EmphasisBadge key={i} color="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">{s}</EmphasisBadge>
              ))}
              {!coachReport.topStrengths?.length && <span className={`text-xs ${textSub}`}>—</span>}
            </div>
          </AnimatedCard>
          <AnimatedCard delay={140} className={`rounded-2xl border px-4 py-4 flex-1 ${cardBg} ${border}`}>
            <div className="text-[10px] uppercase tracking-widest mb-2 text-orange-400">To Improve</div>
            <div className="flex flex-wrap gap-1.5">
              {coachReport.topImprovements?.map((s, i) => (
                <EmphasisBadge key={i} color="bg-orange-500/15 text-orange-400 border-orange-500/20">{s}</EmphasisBadge>
              ))}
              {!coachReport.topImprovements?.length && <span className={`text-xs ${textSub}`}>—</span>}
            </div>
          </AnimatedCard>
        </div>
      </div>

      {/* ── Gantt with embedded cards ── */}
      {segments.length > 0 && (
        <AnimatedCard delay={200} className={`rounded-2xl border px-5 pt-5 pb-6 ${cardBg} ${border}`}>
          <div className={`text-[10px] uppercase tracking-widest mb-5 ${captionMuted}`}>Session Timeline</div>

          {/* Gantt container — needs enough height for cards below bars */}
          <div ref={ganttRef} className="relative" style={{ minHeight: `${GANTT_TRACK_H + CARD_HEIGHT + 48}px` }}>

            {/* Time axis labels */}
            <div className="relative h-5 mb-1">
              {ticks.map((tick, i) => (
                <span
                  key={i}
                  className={`absolute text-[10px] font-mono -translate-x-1/2 ${textSub}`}
                  style={{ left: `${(tick.elapsed / totalDuration) * 100}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>

            {/* Track rail */}
            <div
              className={`relative rounded-full ${dark ? 'bg-white/8' : 'bg-black/8'}`}
              style={{ height: `${GANTT_TRACK_H}px` }}
            >
              {/* Tick lines */}
              {ticks.map((tick, i) => (
                <div
                  key={i}
                  className={`absolute top-0 bottom-0 w-px ${dark ? 'bg-white/10' : 'bg-black/10'}`}
                  style={{ left: `${(tick.elapsed / totalDuration) * 100}%` }}
                />
              ))}

              {/* Segment bars */}
              {segments.map((seg, i) => {
                const left = ((seg.windowStart - minTs) / totalDuration) * 100;
                const width = Math.max(((seg.windowEnd - seg.windowStart) / totalDuration) * 100, 1.5);
                const isActive = activeSegment === i;
                return (
                  <button
                    key={i}
                    onClick={() => setActiveSegment(isActive ? null : i)}
                    title={seg.timeLabel}
                    className="absolute top-1 bottom-1 rounded-full cursor-pointer transition-all duration-300 focus:outline-none"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: isActive
                        ? 'linear-gradient(90deg,#34d399,#10b981)'
                        : dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
                      boxShadow: isActive ? '0 0 10px rgba(52,211,153,0.45)' : 'none',
                      transform: isActive ? 'scaleY(1.4)' : 'scaleY(1)',
                    }}
                  />
                );
              })}
            </div>

            {/* Segment number labels on rail */}
            <div className="relative h-5 mt-1">
              {segments.map((seg, i) => {
                const left = ((seg.windowStart - minTs) / totalDuration) * 100;
                const isActive = activeSegment === i;
                return (
                  <button
                    key={i}
                    onClick={() => setActiveSegment(isActive ? null : i)}
                    className={`absolute text-[9px] font-mono -translate-x-1/2 transition-colors ${isActive ? 'text-emerald-400' : textSub}`}
                    style={{ left: `${left}%` }}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>

            {/* ── Cards embedded below their bar position ── */}
            <div className="relative mt-4" style={{ height: `${CARD_HEIGHT}px` }}>
              {segments.map((seg, i) => {
                const barLeft = ((seg.windowStart - minTs) / totalDuration) * 100;
                const barWidth = Math.max(((seg.windowEnd - seg.windowStart) / totalDuration) * 100, 1.5);
                const barCenter = barLeft + barWidth / 2;
                const isActive = activeSegment === i;

                // Card width in % — clamp so it doesn't overflow
                const CARD_W_PCT = Math.min(Math.max(barWidth * 2.5, 18), 32);
                // Clamp card left so it stays within 0–100%
                let cardLeft = barCenter - CARD_W_PCT / 2;
                cardLeft = Math.max(0, Math.min(100 - CARD_W_PCT, cardLeft));

                return (
                  <div
                    key={i}
                    className={`absolute rounded-xl border px-3 py-3 cursor-pointer transition-all duration-300 ${border} ${
                      isActive
                        ? dark ? 'bg-emerald-500/10 border-emerald-500/30 shadow-lg shadow-emerald-500/10' : 'bg-emerald-50 border-emerald-300/50'
                        : dark ? 'bg-white/5 hover:bg-white/10' : 'bg-black/5 hover:bg-black/8'
                    }`}
                    style={{
                      left: `${cardLeft}%`,
                      width: `${CARD_W_PCT}%`,
                      top: 0,
                      opacity: 1,
                      transform: isActive ? 'translateY(-4px)' : 'translateY(0)',
                      transition: 'transform 0.25s ease, box-shadow 0.25s ease, background 0.2s ease',
                      // connector line via pseudo — use box-shadow trick instead
                    }}
                    onClick={() => setActiveSegment(isActive ? null : i)}
                  >
                    {/* Connector dot to bar */}
                    <div
                      className={`absolute -top-4 left-1/2 -translate-x-1/2 flex flex-col items-center`}
                      style={{ pointerEvents: 'none' }}
                    >
                      <div className={`w-px h-3 ${isActive ? 'bg-emerald-400/60' : dark ? 'bg-white/15' : 'bg-black/15'}`} />
                      <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400' : dark ? 'bg-white/30' : 'bg-black/25'}`} />
                    </div>

                    {/* Card header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                            isActive ? 'bg-emerald-500 text-white' : dark ? 'bg-white/15 text-white/50' : 'bg-black/10 text-black/50'
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className={`text-[9px] uppercase tracking-wide font-medium ${isActive ? 'text-emerald-400' : captionMuted}`}>
                          {seg.timeLabel || `Seg ${i + 1}`}
                        </span>
                      </div>
                    </div>

                    {/* Focus tags */}
                    {seg.focusTags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {seg.focusTags.slice(0, 2).map((tag, j) => (
                          <span key={j} className={`px-1.5 py-0.5 rounded-full text-[8px] border ${dark ? 'border-white/10 text-white/30' : 'border-black/10 text-black/30'}`}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Bullets — show first 2, rest on expand */}
                    <ul className="flex flex-col gap-1">
                      {seg.bullets?.slice(0, isActive ? undefined : 2).map((b, j) => (
                        <li key={j} className="flex gap-1.5 text-[10px] leading-snug">
                          <span className={`mt-0.5 shrink-0 ${isActive ? 'text-emerald-400' : captionMuted}`}>▸</span>
                          <span className={dark ? 'text-white/70' : 'text-black/70'}>{b}</span>
                        </li>
                      ))}
                      {!isActive && (seg.bullets?.length ?? 0) > 2 && (
                        <li className={`text-[9px] ${captionMuted}`}>+{(seg.bullets?.length ?? 0) - 2} more…</li>
                      )}
                    </ul>

                    {/* View captions button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setModalSeg(seg); }}
                      className={`mt-2 text-[9px] uppercase tracking-widest transition-colors ${
                        isActive ? 'text-emerald-400 hover:text-emerald-300' : `${captionMuted} hover:opacity-80`
                      }`}
                    >
                      View captions ↗
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </AnimatedCard>
      )}

      {/* Captions modal */}
      {modalSeg && (
        <CaptionsModal
          dark={dark}
          windowStart={modalSeg.windowStart}
          timeLabel={modalSeg.timeLabel}
          transcriptHistory={transcriptHistory}
          captionHistory={captionHistory}
          onClose={() => setModalSeg(null)}
        />
      )}
    </div>
  );
}
