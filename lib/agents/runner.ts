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

async function callGemini(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { role: 'user',  parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Understood. Ready.' }] },
        { role: 'user',  parts: [{ text: userMessage }] },
      ],
      generationConfig: { temperature: 0.2 },
    }),
  });

  const json = await res.json().catch(() => null) as any;
  return json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? '';
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
