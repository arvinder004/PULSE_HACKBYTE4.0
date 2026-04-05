/**
 * Agent runner — calls Gemini directly with a system prompt + user message.
 *
 * ArmorIQ's role in this architecture:
 *   - It acts as a security proxy that verifies incoming requests to
 *     /api/suggest and /api/questions before they reach the route handlers.
 *   - The route handlers call verifyAgentAuth() to check the ArmorIQ-issued
 *     bearer token on each request.
 *   - Gemini is always called directly from here — ArmorIQ does not proxy LLM calls.
 *
 * Flow:
 *   Caller → ArmorIQ proxy (intent verified) → /api/suggest → runSuggester() → Gemini → response
 */

import { parseAgentJSON } from '@/lib/armoriq';
import type { SuggestionOutput } from './suggester';
import type { QuestionClassification } from './question-classifier';
import { SUGGESTER_SYSTEM_PROMPT } from './suggester';
import { QUESTION_CLASSIFIER_SYSTEM_PROMPT } from './question-classifier';

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
const GEMINI_TIMEOUT_MS = 15_000;
const GEMINI_MAX_RETRIES = 2;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRetryDelayMs(res: Response, attempt: number) {
  const retryAfter = Number(res.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 10_000);
  }
  const base = 400 * (2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 200);
}

async function callGemini(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const maxAttempts = GEMINI_MAX_RETRIES + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            { role: 'user',  parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: 'Understood. Ready.' }] },
            { role: 'user',  parts: [{ text: userMessage }] },
          ],
          generationConfig: { temperature: 0.2 },
        }),
      });
    } catch (err) {
      if (attempt < maxAttempts) {
        await sleep(300 * attempt);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts) {
        await sleep(getRetryDelayMs(res, attempt));
        continue;
      }
      throw new Error(`Gemini API error ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`);
    }

    const json = await res.json().catch(() => null) as any;
    const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? '';
    if (!text.trim()) {
      throw new Error('Gemini returned empty response');
    }
    return text;
  }

  throw new Error('Gemini API error (retries exhausted)');
}

// ── Suggester (Agent 2) ───────────────────────────────────────────────────────

export async function runSuggester(userMessage: string): Promise<SuggestionOutput> {
  const fallback: SuggestionOutput = {
    message: 'Could not generate suggestion',
    detail: '',
    urgency: 'low',
    category: 'general',
    escalated: false,
    escalation_reason: '',
    covered_questions: [],
    uncovered_questions: [],
    skip: true,
  };

  try {
    const raw = await callGemini(SUGGESTER_SYSTEM_PROMPT, userMessage);
    return parseAgentJSON<SuggestionOutput>(raw);
  } catch (e) {
    console.error('[ArmorIQ][Suggester] runner error', String(e));
    return fallback;
  }
}

// ── Question Classifier (Agent 3) ─────────────────────────────────────────────

export async function runQuestionClassifier(userMessage: string): Promise<QuestionClassification> {
  const fallback: QuestionClassification = {
    relevant: true,
    forward_to_suggester: false,
    category: 'general',
    urgency: 'low',
    reason: 'Classification unavailable',
    duplicate_of: null,
    theme_tag: 'general',
  };

  try {
    const raw = await callGemini(QUESTION_CLASSIFIER_SYSTEM_PROMPT, userMessage);
    return parseAgentJSON<QuestionClassification>(raw);
  } catch (e) {
    console.error('[ArmorIQ][QuestionClassifier] runner error', String(e));
    return fallback;
  }
}
