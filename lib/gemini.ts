export type GeminiIntervention = {
  message: string;
  suggestion: string;
  urgency: 'high' | 'medium' | 'low';
  raw?: any;
};

export type GeminiSegmentSummary = {
  summary: string;
  improvement: string;
  focusTags: string[];
  paceAssessment?: string;
  signalInsight?: string;
  questionThemes?: string[];
  raw?: any;
};

type AnalyzeArgs = {
  sessionId: string;
  transcript?: string;
  signals?: Record<string, number> | any;
};

type SummaryArgs = {
  sessionId: string;
  transcript?: string;
  signals?: Record<string, number> | any;
  questions?: { id: string; text: string; upvotes: number }[];
  speakerName?: string;
  topic?: string;
};

/**
 * Analyze transcript + signals and return a short intervention suggestion.
 * Falls back to a lightweight heuristic when GEMINI_API_KEY is not configured.
 */
export async function analyzeIntervention({ sessionId, transcript, signals }: AnalyzeArgs): Promise<GeminiIntervention> {
  const text = (transcript || '').slice(0, 2000);
  const DEBUG = true;

  // Simple heuristic fallback
  if (!process.env.GEMINI_API_KEY) {
    if (DEBUG) console.log('[PULSE][Phase3][Gemini] fallback (no API key)', { sessionId, transcriptLen: text.length });
    const lowered = text.toLowerCase();
    const confusedSignals = (signals?.confused ?? 0) || 0;
    const urgent = confusedSignals >= 3 || /don't understand|didn't understand|confus|lost|unclear/.test(lowered);
    const medium = confusedSignals >= 1 || /unclear|maybe|question|what is/.test(lowered);

    if (urgent) {
      return {
        message: 'Audience seems confused',
        suggestion: 'Pause and restate the last point in simpler terms, give a short example.',
        urgency: 'high',
        raw: { heuristic: true, confusedSignals },
      };
    }

    if (medium) {
      return {
        message: 'Check for understanding',
        suggestion: 'Ask a quick comprehension question or invite a thumbs-up if clear.',
        urgency: 'medium',
        raw: { heuristic: true, confusedSignals },
      };
    }

    return {
      message: 'Room is engaged',
      suggestion: 'Keep going — consider a brief example to reinforce.',
      urgency: 'low',
      raw: { heuristic: true, confusedSignals },
    };
  }

  // Call Gemini via either a custom gateway (GEMINI_API_URL) or the public Generative Language API.
  try {
    const prompt = [
      'You are a real-time presentation coach. Output ONLY valid JSON.',
      'Return: {"message": string<=40, "suggestion": string<=160, "urgency": "high"|"medium"|"low"}.',
      `Session: ${sessionId}`,
      `Signals: ${JSON.stringify(signals || {})}`,
      `Transcript (last 60s): ${text || '(none)'}`,
    ].join('\n');

    let textResp = '';

    if (process.env.GEMINI_API_URL) {
      if (DEBUG) console.log('[PULSE][Phase3][Gemini] gateway call', { sessionId, transcriptLen: text.length });
      // Custom gateway mode
      const res = await fetch(process.env.GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
        },
        body: JSON.stringify({ sessionId, transcript: text, signals: signals || {}, prompt }),
      });
      textResp = await res.text();
    } else {
      if (DEBUG) console.log('[PULSE][Phase3][Gemini] public API call', { sessionId, model: process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview' });
      // Public API mode
      const model = process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 },
        }),
      });

      const apiJson = await res.json().catch(() => null) as any;
      const candidateText = apiJson?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? '';
      textResp = candidateText || JSON.stringify(apiJson ?? {});
    }

    // Try to parse JSON directly
    try {
      const parsed = JSON.parse(textResp);
      return {
        message: String(parsed.message || parsed.msg || 'Intervention'),
        suggestion: String(parsed.suggestion || parsed.s || ''),
        urgency: (parsed.urgency === 'high' ? 'high' : parsed.urgency === 'medium' ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        raw: parsed,
      };
    } catch (err) {
      // If the LLM returned text, attempt to extract a JSON blob from it
      const jsonMatch = textResp.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            message: String(parsed.message || parsed.msg || 'Intervention'),
            suggestion: String(parsed.suggestion || parsed.s || ''),
            urgency: (parsed.urgency === 'high' ? 'high' : parsed.urgency === 'medium' ? 'medium' : 'low') as 'high' | 'medium' | 'low',
            raw: parsed,
          };
        } catch (e) {
          // fallthrough
        }
      }

      // Final fallback
      return {
        message: 'Intervention suggested',
        suggestion: textResp.slice(0, 160),
        urgency: 'low',
        raw: { text: textResp },
      };
    }
  } catch (e) {
    if (DEBUG) console.log('[PULSE][Phase3][Gemini] error', String(e));
    return {
      message: 'Intervention (error)',
      suggestion: 'Could not contact analyzer — try again later.',
      urgency: 'low',
      raw: { error: String(e) },
    };
  }
}

/**
 * Generate a compact coaching summary for a 60s segment.
 * Output is intentionally short so multiple segments can be merged later.
 */
export async function summarizeSegment({ sessionId, transcript, signals, questions, speakerName, topic }: SummaryArgs): Promise<GeminiSegmentSummary> {
  const text = (transcript || '').slice(0, 4000);
  const counts = signals || {};
  const questionLines = (questions || []).map(q => `- ${q.text} (upvotes:${q.upvotes})`).join('\n') || '(none)';
  const DEBUG = true;

  if (!process.env.GEMINI_API_KEY) {
    if (DEBUG) console.log('[PULSE][Phase3][Gemini] summary fallback (no API key)', { sessionId, transcriptLen: text.length });
    const confused = (counts?.confused ?? 0) || 0;
    const slowDown = (counts?.slow_down ?? 0) || 0;
    const excited  = (counts?.excited  ?? 0) || 0;

    const paceSignals = slowDown + excited;
    const pacePct     = paceSignals === 0 ? 50 : Math.round((slowDown / paceSignals) * 100);
    const paceLabel   = paceSignals < 3 ? 'Not enough signal' : pacePct > 65 ? 'Too fast — slow down' : pacePct < 35 ? 'Too slow — pick up the pace' : 'Good pace';

    let improvement = 'Keep the pace steady and reinforce the key point briefly.';
    let focusTags = ['clarity'];
    if (confused >= 2) {
      improvement = 'Slow down and restate the last point with a short example.';
      focusTags = ['clarity', 'examples'];
    } else if (slowDown >= 2) {
      improvement = 'Insert short pauses and check understanding.';
      focusTags = ['pacing', 'check-in'];
    } else if (excited >= 2) {
      improvement = 'Keep the energy, but add a quick recap.';
      focusTags = ['engagement', 'recap'];
    }

    return {
      summary: 'Short segment captured. Focus on delivery and clarity.',
      improvement,
      focusTags,
      paceLabel,
      pacePct,
      raw: { heuristic: true, counts },
    } as any;
  }

  // Derive pace context the same way the producer page does
  const paceSignals = (counts?.slow_down ?? 0) + (counts?.excited ?? 0);
  const pacePct     = paceSignals === 0 ? 50 : Math.round(((counts?.slow_down ?? 0) / paceSignals) * 100);
  const paceLabel   = paceSignals < 3 ? 'Not enough signal' : pacePct > 65 ? 'Too fast — slow down' : pacePct < 35 ? 'Too slow — pick up the pace' : 'Good pace';

  try {
    const prompt = [
      'You are a speaking coach creating a MICRO improvement summary for the last 60 seconds.',
      'The producer dashboard shows the following live data — your output must directly address each of these:',
      '  • Room Pulse: signal counts for confused 😕, clear ✅, excited 🔥, slow_down 🐢, question ✋',
      '  • Pace indicator: derived from slow_down vs excited signals (current reading: "' + paceLabel + '")',
      '  • Audience questions: questions submitted by the audience during this segment',
      '  • Signal totals: cumulative counts per signal type',
      '',
      'Output ONLY valid JSON with this exact shape:',
      '{',
      '  "summary": string,          // ≤200 chars — what happened in this segment',
      '  "improvement": string,      // ≤160 chars — single most actionable coaching tip',
      '  "focus_tags": string[],     // ≤4 tags drawn from: clarity, pacing, engagement, examples, recap, check-in, energy, structure',
      '  "pace_assessment": string,  // ≤80 chars — interpret the pace signal for the producer',
      '  "signal_insight": string,   // ≤120 chars — what the confused/clear/excited balance tells the speaker',
      '  "question_themes": string[] // ≤3 short themes extracted from audience questions, empty array if none',
      '}',
      '',
      'Rules:',
      '- Base pace_assessment on the slow_down/excited ratio, not just the transcript.',
      '- Base signal_insight on the confused vs clear vs excited counts.',
      '- question_themes should reflect what the audience is actually asking about.',
      '- Focus on the speaker\'s delivery (clarity, pacing, structure). Ignore audience chatter.',
      '- Be constructive and neutral. No moral judgments.',
      '',
      `Session: ${sessionId}`,
      `Speaker: ${speakerName || '(unknown)'}`,
      `Topic: ${topic || '(unknown)'}`,
      `Signals (last 60s): ${JSON.stringify(counts || {})}`,
      `Pace reading: ${paceLabel} (slow_down=${counts?.slow_down ?? 0}, excited=${counts?.excited ?? 0})`,
      `Audience Questions:\n${questionLines}`,
      `Transcript (last 60s): ${text || '(none)'}`,
    ].join('\n');

    let textResp = '';

    if (process.env.GEMINI_API_URL) {
      if (DEBUG) console.log('[PULSE][Phase3][Gemini] summary gateway call', { sessionId, transcriptLen: text.length });
      const res = await fetch(process.env.GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
        },
        body: JSON.stringify({ sessionId, transcript: text, signals: counts || {}, questions: questions || [], prompt }),
      });
      textResp = await res.text();
    } else {
      if (DEBUG) console.log('[PULSE][Phase3][Gemini] summary public API call', { sessionId, model: process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview' });
      const model = process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 },
        }),
      });

      const apiJson = await res.json().catch(() => null) as any;
      const candidateText = apiJson?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? '';
      textResp = candidateText || JSON.stringify(apiJson ?? {});
    }

    try {
      const parsed = JSON.parse(textResp);
      const tags = Array.isArray(parsed.focus_tags || parsed.focusTags)
        ? (parsed.focus_tags || parsed.focusTags).map((t: any) => String(t)).slice(0, 4)
        : [];
      return {
        summary:          String(parsed.summary || parsed.sum || '').slice(0, 220),
        improvement:      String(parsed.improvement || parsed.tip || '').slice(0, 180),
        focusTags:        tags,
        paceAssessment:   String(parsed.pace_assessment || parsed.paceAssessment || '').slice(0, 100),
        signalInsight:    String(parsed.signal_insight || parsed.signalInsight || '').slice(0, 140),
        questionThemes:   Array.isArray(parsed.question_themes || parsed.questionThemes)
                            ? (parsed.question_themes || parsed.questionThemes).map(String).slice(0, 3)
                            : [],
        raw: parsed,
      };
    } catch {
      const jsonMatch = textResp.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const tags = Array.isArray(parsed.focus_tags || parsed.focusTags)
            ? (parsed.focus_tags || parsed.focusTags).map((t: any) => String(t)).slice(0, 4)
            : [];
          return {
            summary:          String(parsed.summary || parsed.sum || '').slice(0, 220),
            improvement:      String(parsed.improvement || parsed.tip || '').slice(0, 180),
            focusTags:        tags,
            paceAssessment:   String(parsed.pace_assessment || parsed.paceAssessment || '').slice(0, 100),
            signalInsight:    String(parsed.signal_insight || parsed.signalInsight || '').slice(0, 140),
            questionThemes:   Array.isArray(parsed.question_themes || parsed.questionThemes)
                                ? (parsed.question_themes || parsed.questionThemes).map(String).slice(0, 3)
                                : [],
            raw: parsed,
          };
        } catch {
          // fallthrough
        }
      }

      return {
        summary:       textResp.slice(0, 200),
        improvement:   '',
        focusTags:     [],
        raw: { text: textResp },
      };
    }
  } catch (e) {
    if (DEBUG) console.log('[PULSE][Phase3][Gemini] summary error', String(e));
    return {
      summary: 'Summary unavailable due to analyzer error.',
      improvement: '',
      focusTags: [],
      raw: { error: String(e) },
    };
  }
}

export default analyzeIntervention;

export type GeminiCoachSegment = {
  windowStart: number;
  windowEnd: number;
  timeLabel: string;
  bullets: string[];
  focusTags: string[];
};

export type GeminiCoachReport = {
  segments: GeminiCoachSegment[];
  overallSummary: string;
  topStrengths: string[];
  topImprovements: string[];
  raw?: any;
};

type CoachBatch = {
  windowStart: number;
  windowEnd: number;
  transcript: string;
  summary: string;
  improvement: string;
  focusTags: string[];
  signals: Record<string, number>;
};

function msToTimeLabel(sessionStartMs: number, windowStart: number, windowEnd: number): string {
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };
  return `${fmt(windowStart - sessionStartMs)} – ${fmt(windowEnd - sessionStartMs)}`;
}

/**
 * Compile all 60s mini-batch summaries into a final structured coaching report.
 */
export async function compileCoachReport({
  sessionId,
  speakerName,
  topic,
  sessionStartMs,
  batches,
}: {
  sessionId: string;
  speakerName: string;
  topic: string;
  sessionStartMs: number;
  batches: CoachBatch[];
}): Promise<GeminiCoachReport> {
  const DEBUG = true;

  // Build time-labelled batch list for the prompt
  const batchLines = batches.map((b, i) => {
    const label = msToTimeLabel(sessionStartMs, b.windowStart, b.windowEnd);
    return [
      `--- Segment ${i + 1} [${label}] ---`,
      `Transcript: ${b.transcript.slice(0, 600)}`,
      `Mini-summary: ${b.summary}`,
      `Improvement note: ${b.improvement}`,
      `Focus tags: ${b.focusTags.join(', ') || 'none'}`,
      `Signals: ${JSON.stringify(b.signals)}`,
    ].join('\n');
  }).join('\n\n');

  // Fallback when no API key
  if (!process.env.GEMINI_API_KEY) {
    if (DEBUG) console.log('[PULSE][Coach] fallback (no API key)', { sessionId, batchCount: batches.length });
    return {
      segments: batches.map(b => ({
        windowStart: b.windowStart,
        windowEnd: b.windowEnd,
        timeLabel: msToTimeLabel(sessionStartMs, b.windowStart, b.windowEnd),
        bullets: [b.improvement || b.summary || 'No data for this segment.'],
        focusTags: b.focusTags,
      })),
      overallSummary: 'Session complete. Review each segment for improvement notes.',
      topStrengths: ['Completed the session'],
      topImprovements: ['Review pacing and clarity in flagged segments'],
      raw: { heuristic: true },
    };
  }

  const prompt = [
    'You are an expert speaking coach. A speaker just finished a talk.',
    'You have their session broken into 60-second segments below.',
    'Your job: produce a structured coaching report.',
    '',
    'Output ONLY valid JSON matching this exact shape:',
    '{',
    '  "segments": [',
    '    {',
    '      "windowStart": <number ms>,',
    '      "windowEnd": <number ms>,',
    '      "timeLabel": "<string like 0:00 – 1:00>",',
    '      "bullets": ["<actionable improvement point>", ...],  // 2-4 bullets per segment',
    '      "focusTags": ["<tag>", ...]  // max 3',
    '    }',
    '  ],',
    '  "overallSummary": "<2-3 sentence overall coaching summary>",',
    '  "topStrengths": ["<strength>", "<strength>"],  // 2-3 items',
    '  "topImprovements": ["<improvement>", "<improvement>"]  // 2-3 items',
    '}',
    '',
    'Rules:',
    '- Each bullet must be specific and actionable, referencing what was said or signalled.',
    '- Do NOT repeat the same bullet across segments.',
    '- Focus on delivery: pacing, clarity, structure, engagement. Ignore audience chatter.',
    '- Be constructive. No moral judgments.',
    '',
    `Session ID: ${sessionId}`,
    `Speaker: ${speakerName || '(unknown)'}`,
    `Topic: ${topic || '(unknown)'}`,
    `Total segments: ${batches.length}`,
    '',
    batchLines,
  ].join('\n');

  try {
    if (DEBUG) console.log('[PULSE][Coach] calling Gemini', { sessionId, batchCount: batches.length, promptLen: prompt.length });

    const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY!)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
    });

    const apiJson = await res.json().catch(() => null) as any;
    const textResp = apiJson?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? '';

    if (DEBUG) console.log('[PULSE][Coach] Gemini raw response length', textResp.length);

    const jsonMatch = textResp.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(textResp);

    const segments: GeminiCoachSegment[] = (parsed.segments || []).map((s: any) => ({
      windowStart: Number(s.windowStart ?? 0),
      windowEnd:   Number(s.windowEnd ?? 0),
      timeLabel:   String(s.timeLabel ?? ''),
      bullets:     Array.isArray(s.bullets) ? s.bullets.map(String) : [],
      focusTags:   Array.isArray(s.focusTags) ? s.focusTags.map(String).slice(0, 3) : [],
    }));

    if (DEBUG) console.log('[PULSE][Coach] parsed segments', segments.length);

    return {
      segments,
      overallSummary: String(parsed.overallSummary || ''),
      topStrengths:   Array.isArray(parsed.topStrengths) ? parsed.topStrengths.map(String) : [],
      topImprovements: Array.isArray(parsed.topImprovements) ? parsed.topImprovements.map(String) : [],
      raw: parsed,
    };
  } catch (e) {
    if (DEBUG) console.log('[PULSE][Coach] Gemini error', String(e));
    // Graceful fallback — use mini-batch data directly
    return {
      segments: batches.map(b => ({
        windowStart: b.windowStart,
        windowEnd: b.windowEnd,
        timeLabel: msToTimeLabel(sessionStartMs, b.windowStart, b.windowEnd),
        bullets: [b.improvement || b.summary || 'No data.'],
        focusTags: b.focusTags,
      })),
      overallSummary: 'Could not generate full report — showing raw segment notes.',
      topStrengths: [],
      topImprovements: [],
      raw: { error: String(e) },
    };
  }
}
