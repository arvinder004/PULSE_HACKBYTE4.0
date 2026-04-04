export type GeminiIntervention = {
  message: string;
  suggestion: string;
  urgency: 'high' | 'medium' | 'low';
  raw?: any;
};

type AnalyzeArgs = {
  sessionId: string;
  transcript?: string;
  signals?: Record<string, number> | any;
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
      if (DEBUG) console.log('[PULSE][Phase3][Gemini] public API call', { sessionId, model: process.env.GEMINI_MODEL ?? 'gemini-1.5-flash' });
      // Public API mode
      const model = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
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

export default analyzeIntervention;
