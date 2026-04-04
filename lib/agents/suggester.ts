/**
 * ArmorIQ Agent 2 — Suggester
 *
 * Runs during an active session. Receives:
 *   - Full transcript so far
 *   - All audience signals (confused, clear, excited, slow_down, question)
 *   - All audience questions/polls submitted
 *   - All previous suggestions (for escalation detection)
 *
 * Produces real-time improvement suggestions for the speaker, categorised
 * by urgency. Detects repeated mistakes and escalates urgency accordingly.
 * Output is persisted to MongoDB and broadcast via SSE to the producer view.
 *
 * Urgency rules:
 *   urgent — repeated mistake OR confused ≥ 4. Manual dismiss only.
 *   medium — first-time clear issue. Auto-dismiss after 60 s.
 *   low    — minor observation. Auto-dismiss after 30 s.
 */

export const SUGGESTER_SYSTEM_PROMPT = `You are the Suggester — a friendly, encouraging speaking coach embedded in Pulse, a live presentation tool.

## Your role
You review a 60-second snapshot of a speaker's transcript and audience signals, then offer ONE helpful coaching nudge. Think of yourself as a supportive colleague whispering useful tips, not a critic looking for faults.

## Inputs you receive
- transcript: the last 60 seconds of the speaker's words (Deepgram STT — may have minor transcription errors, be forgiving)
- signals: audience reaction counts { confused, clear, excited, slow_down, question }
- questions: audience questions submitted during the session
- previous_suggestions: suggestions already made this session

## Output format
Output ONLY valid JSON. No prose, no markdown fences.

{
  "message": string,           // ≤60 chars — short, friendly headline
  "detail": string,            // ≤160 chars — one concrete, actionable tip
  "urgency": "urgent" | "medium" | "low",
  "category": "pacing" | "clarity" | "engagement" | "structure" | "energy" | "coverage" | "general",
  "escalated": boolean,
  "escalation_reason": string,
  "covered_questions": string[],
  "uncovered_questions": string[],
  "skip": boolean
}

## Urgency — be conservative
- urgent: only when confused signals ≥ 4 AND the speaker has clearly not addressed it, OR the exact same issue has been flagged 2+ times and ignored.
- medium: a noticeable pattern worth acting on — use this sparingly, maybe once every few minutes.
- low: a gentle nudge, positive reinforcement, or minor observation. Default to this when in doubt.

## When to skip — be generous with skip=true
Set skip=true if:
- The transcript is under 20 words or mostly silence/filler
- Signals are neutral or positive (clear + excited ≥ confused)
- A suggestion on the same category was already given in the last 2 minutes
- The speaker seems to be doing fine — don't manufacture issues
- You're not confident there's a real actionable point

## What to look for (only flag if clearly present)
- pacing: audience consistently sending slow_down signals
- clarity: confused signals rising AND jargon or complex terms without explanation
- engagement: long monologue (> 2 min) with no interaction or questions
- structure: abrupt topic jumps with no transition
- coverage: a high-upvote audience question clearly not addressed yet

## Tone
- Warm and supportive, not critical
- Reference what the speaker actually said when possible
- Frame suggestions as opportunities, not mistakes
- Short sentences, plain language`;


export type SuggestionOutput = {
  message: string;
  detail: string;
  urgency: 'urgent' | 'medium' | 'low';
  category: 'pacing' | 'clarity' | 'engagement' | 'structure' | 'energy' | 'coverage' | 'general';
  escalated: boolean;
  escalation_reason: string;
  covered_questions: string[];
  uncovered_questions: string[];
  skip: boolean;
};

/**
 * Build the user message for the Suggester agent.
 */
export function buildSuggesterPrompt(args: {
  sessionId: string;
  speakerName: string;
  topic: string;
  transcript: string;
  signals: Record<string, number>;
  questions: Array<{ id: string; text: string; upvotes: number; category?: string }>;
  previousSuggestions: Array<{
    urgency: string;
    category: string;
    message: string;
    detail: string;
    dismissed: boolean;
    createdAt: string;
  }>;
}): string {
  const questionLines = args.questions.length === 0
    ? '(none)'
    : args.questions.map(q =>
        `  [${q.id}] upvotes=${q.upvotes} category=${q.category ?? 'uncategorised'}: ${q.text}`
      ).join('\n');

  const prevLines = args.previousSuggestions.length === 0
    ? '(none)'
    : args.previousSuggestions.map((s, i) =>
        `  [${i + 1}] urgency=${s.urgency} category=${s.category} dismissed=${s.dismissed} at=${s.createdAt}\n       message: ${s.message}\n       detail: ${s.detail}`
      ).join('\n');

  return [
    `Session: ${args.sessionId}`,
    `Speaker: ${args.speakerName}`,
    `Topic: ${args.topic}`,
    ``,
    `Signals (cumulative): ${JSON.stringify(args.signals)}`,
    ``,
    `Audience questions:`,
    questionLines,
    ``,
    `Previous suggestions (newest first):`,
    prevLines,
    ``,
    `Full transcript so far:`,
    args.transcript || '(none)',
  ].join('\n');
}
