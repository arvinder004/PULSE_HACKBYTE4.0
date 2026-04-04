'use client';

import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { tables } from '@/src/module_bindings';
import type { Infer } from 'spacetimedb';

export type SignalRow       = Infer<typeof import('@/src/module_bindings/signal_table').default>;
export type InterventionRow = Infer<typeof import('@/src/module_bindings/intervention_table').default>;
export type QuestionRow     = Infer<typeof import('@/src/module_bindings/question_table').default>;
export type SessionRow      = Infer<typeof import('@/src/module_bindings/session_table').default>;
export type MoodWordRow     = Infer<typeof import('@/src/module_bindings/mood_word_table').default>;
export type PollRow         = Infer<typeof import('@/src/module_bindings/poll_table').default>;
export type CaptionRow      = Infer<typeof import('@/src/module_bindings/caption_table').default>;

/**
 * Subscribes to all session-scoped tables and exposes reducer callers.
 * Must be used inside <SpacetimeProvider>.
 */
export function useSpacetimeSession(sessionId: string) {
  const conn = useSpacetimeDB() as any;

  const [signals]       = useTable(tables.signal);
  const [interventions] = useTable(tables.intervention);
  const [questions]     = useTable(tables.question);
  const [moodWords]     = useTable(tables.mood_word);
  const [polls]         = useTable(tables.poll);
  const [captions]      = useTable(tables.caption);

  // Call a reducer by name via the raw connection
  function call(name: string, args: Record<string, unknown>) {
    try {
      conn?.callReducer?.(name, args);
    } catch (e) {
      console.warn(`[SpacetimeDB] reducer ${name} failed`, e);
    }
  }

  return {
    signals:       signals.filter((r: SignalRow)       => r.sessionId === sessionId),
    interventions: interventions.filter((r: InterventionRow) => r.sessionId === sessionId && !r.acknowledged),
    questions:     questions.filter((r: QuestionRow)   => r.sessionId === sessionId && !r.dismissed),
    moodWords:     moodWords.filter((r: MoodWordRow)   => r.sessionId === sessionId),
    polls:         polls.filter((r: PollRow)           => r.sessionId === sessionId),
    captions:      captions.filter((r: CaptionRow)     => r.sessionId === sessionId),

    reducers: {
      submitSignal:            (id: string, signalType: string, audienceId: string, fingerprint: string, weight: number) =>
                                 call('submit_signal', { id, session_id: sessionId, signal_type: signalType, audience_id: audienceId, fingerprint, weight }),
      submitCaption:           (id: string, text: string) =>
                                 call('submit_caption', { id, session_id: sessionId, text }),
      logIntervention:         (id: string, message: string, suggestion: string, urgency: string) =>
                                 call('log_intervention', { id, session_id: sessionId, message, suggestion, urgency }),
      acknowledgeIntervention: (id: string) =>
                                 call('acknowledge_intervention', { id }),
      submitQuestion:          (id: string, text: string, audienceId: string) =>
                                 call('submit_question', { id, session_id: sessionId, text, audience_id: audienceId }),
      upvoteQuestion:          (questionId: string, audienceId: string) =>
                                 call('upvote_question', { question_id: questionId, audience_id: audienceId }),
      dismissQuestion:         (questionId: string) =>
                                 call('dismiss_question', { question_id: questionId }),
      answerQuestion:          (questionId: string) =>
                                 call('answer_question', { question_id: questionId }),
      submitMood:              (id: string, word: string, audienceId: string, interventionId: string) =>
                                 call('submit_mood', { id, session_id: sessionId, word, audience_id: audienceId, intervention_id: interventionId }),
      createPoll:              (id: string, question: string, options: string) =>
                                 call('create_poll', { id, session_id: sessionId, question, options }),
      votePoll:                (pollId: string, audienceId: string, option: string) =>
                                 call('vote_poll', { poll_id: pollId, audience_id: audienceId, option }),
      closePoll:               (pollId: string) =>
                                 call('close_poll', { poll_id: pollId }),
      endSession:              () =>
                                 call('end_session', { session_id: sessionId }),
    },
  };
}
