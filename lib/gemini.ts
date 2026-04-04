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
    const excited = (counts?.excited ?? 0) || 0;

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
      raw: { heuristic: true, counts },
    };
  }

  try {
    const prompt = [
      'You are a speaking coach creating a MICRO improvement summary for the last 60 seconds.',
      'Output ONLY valid JSON: {"summary": string<=200, "improvement": string<=160, "focus_tags": string[]<=4}.',
      'This summary will be merged with other 60s summaries later, so keep it concise and self-contained.',
      'Use signals and audience questions as context, but DO NOT judge the speaker based on audience chatter or audience and speaker conversation.',
      'The transcript may include audience conversation or Q&A. Ignore that content and focus on the speaker\'s delivery (clarity, pacing, structure).',
      'Be constructive and neutral. Avoid moral judgments or personal criticism.',
      `Session: ${sessionId}`,
      `Speaker: ${speakerName || '(unknown)'}`,
      `Topic: ${topic || '(unknown)'}`,
      `Signals (last 60s): ${JSON.stringify(counts || {})}`,
      `Audience Questions (top):\n${questionLines}`,
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
        summary: String(parsed.summary || parsed.sum || '').slice(0, 220),
        improvement: String(parsed.improvement || parsed.tip || '').slice(0, 180),
        focusTags: tags,
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
            summary: String(parsed.summary || parsed.sum || '').slice(0, 220),
            improvement: String(parsed.improvement || parsed.tip || '').slice(0, 180),
            focusTags: tags,
            raw: parsed,
          };
        } catch {
          // fallthrough
        }
      }

      return {
        summary: textResp.slice(0, 200),
        improvement: '',
        focusTags: [],
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
