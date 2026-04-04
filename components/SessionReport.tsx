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
}

function AnimatedCard({ children, delay = 0, className = '' }: {
  children: React.ReactNode; delay?: number; className?: string;
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
      }}
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
      className={`px-2 py-0.5 rounded-full text-[12px] border ${color}`}
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

export default function SessionReport({ coachReport, dark, captionMuted }: Props) {
  const border = dark ? 'border-white/10' : 'border-black/10';
  const cardBg = dark ? 'bg-white/5' : 'bg-black/5';
  const textSub = dark ? 'text-white/40' : 'text-black/40';
  const textMain = dark ? 'text-white' : 'text-black';
  const segments = coachReport.segments ?? [];

  return (
    <div className="w-full max-w-5xl mt-4 px-2 flex flex-col gap-6">

      {/* Overall + Strengths/Improvements */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AnimatedCard delay={0} className={`md:col-span-2 rounded-2xl border px-5 py-5 ${cardBg} ${border}`}>
          <div className={`text-[12px] uppercase tracking-widest mb-2 ${captionMuted}`}>Session Overview</div>
          <p className={`text-2xl leading-relaxed ${textMain}`}>{coachReport.overallSummary}</p>
        </AnimatedCard>

        <div className="flex flex-col gap-4">
          <AnimatedCard delay={80} className={`rounded-2xl border px-4 py-4 flex-1 ${cardBg} ${border}`}>
            <div className="text-[12px] uppercase tracking-widest mb-2 text-emerald-400">Strengths</div>
            <div className="flex flex-wrap gap-1.5">
              {coachReport.topStrengths?.map((s, i) => (
                <EmphasisBadge key={i} color="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">{s}</EmphasisBadge>
              ))}
              {!coachReport.topStrengths?.length && <span className={`text-xs ${textSub}`}>—</span>}
            </div>
          </AnimatedCard>
          <AnimatedCard delay={140} className={`rounded-2xl border px-4 py-4 flex-1 ${cardBg} ${border}`}>
            <div className="text-[12px] uppercase tracking-widest mb-2 text-orange-400">To Improve</div>
            <div className="flex flex-wrap gap-1.5">
              {coachReport.topImprovements?.map((s, i) => (
                <EmphasisBadge key={i} color="bg-orange-500/15 text-orange-400 border-orange-500/20">{s}</EmphasisBadge>
              ))}
              {!coachReport.topImprovements?.length && <span className={`text-xs ${textSub}`}>—</span>}
            </div>
          </AnimatedCard>
        </div>
      </div>

      {/* Segment cards — 2-col grid */}
      {segments.length > 0 && (
        <div>
          <div className={`text-[12px] uppercase tracking-widest mb-3 ${captionMuted}`}>Segment Breakdown</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {segments.map((seg, i) => (
              <AnimatedCard
                key={i}
                delay={i * 60}
                className={`rounded-2xl border px-5 py-4 ${cardBg} ${border}`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold ${dark ? 'bg-white/10 text-white/50' : 'bg-black/10 text-black/50'}`}>
                      {i + 1}
                    </span>
                    <span className={`text-[12px] uppercase tracking-widest font-medium ${captionMuted}`}>
                      {seg.timeLabel || `Segment ${i + 1}`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {seg.focusTags?.map((tag, j) => (
                      <span key={j} className={`px-1.5 py-0.5 rounded-full text-[11px] border ${dark ? 'border-white/10 text-white/30' : 'border-black/10 text-black/30'}`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Bullets */}
                <ul className="flex flex-col gap-2">
                  {seg.bullets?.map((b, j) => (
                    <li key={j} className="flex gap-2 text-base leading-snug">
                      <span className={`mt-0.5 shrink-0 text-emerald-400`}>▸</span>
                      <span className={dark ? 'text-white/80' : 'text-black/80'}>{b}</span>
                    </li>
                  ))}
                </ul>
              </AnimatedCard>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
