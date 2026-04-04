/**
 * Agent runner — calls Gemini with a system prompt + user message.
 * When ArmorIQ is configured, the call is routed through the ArmorIQ
 * proxy for cryptographic intent verification.
 * When not configured (dev/no key), calls Gemini directly as fallback.
 */

import { parseAgentJSON, isArmorIQConfigured, runAgent, MCP, ACTION } from '@/lib/armoriq';
import type { SuggestionOutput } from './suggester';
import type { QuestionClassification } from './question-classifier';
import { SUGGESTER_SYSTEM_PROMPT } from './suggester';
import { QUESTION_CLASSIFIER_SYSTEM_PROMPT } from './question-classifier';

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

async function callGeminiDirect(systemPrompt: string, userMessage: string): Promise<string> {
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

// ── Suggester ─────────────────────────────────────────────────────────────────

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
    let raw: string;

    if (isArmorIQConfigured()) {
      // Route through ArmorIQ proxy for verified execution
      const result = await runAgent(MCP.SUGGESTER, ACTION.RUN_SUGGESTER, {
        system_prompt: SUGGESTER_SYSTEM_PROMPT,
        user_message:  userMessage,
      }, { prompt: 'Run Suggester agent for live session coaching' });

      // The MCP returns { text: "..." } or the raw string
      raw = typeof result.data === 'string'
        ? result.data
        : (result.data as any)?.text ?? JSON.stringify(result.data);
    } else {
      // Direct Gemini fallback (dev mode)
      raw = await callGeminiDirect(SUGGESTER_SYSTEM_PROMPT, userMessage);
    }

    return parseAgentJSON<SuggestionOutput>(raw);
  } catch (e) {
    console.error('[ArmorIQ][Suggester] runner error', String(e));
    return fallback;
  }
}

// ── Question Classifier ───────────────────────────────────────────────────────

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
    let raw: string;

    if (isArmorIQConfigured()) {
      const result = await runAgent(MCP.QUESTION_CLASSIFIER, ACTION.RUN_QUESTION_CLASSIFIER, {
        system_prompt: QUESTION_CLASSIFIER_SYSTEM_PROMPT,
        user_message:  userMessage,
      }, { prompt: 'Classify audience question for live session' });

      raw = typeof result.data === 'string'
        ? result.data
        : (result.data as any)?.text ?? JSON.stringify(result.data);
    } else {
      raw = await callGeminiDirect(QUESTION_CLASSIFIER_SYSTEM_PROMPT, userMessage);
    }

    return parseAgentJSON<QuestionClassification>(raw);
  } catch (e) {
    console.error('[ArmorIQ][QuestionClassifier] runner error', String(e));
    return fallback;
  }
}
