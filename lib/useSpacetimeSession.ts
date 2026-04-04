'use client';

import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection } from '@/src/module_bindings';

/**
 * Hook that subscribes to all session-scoped tables and exposes typed reducer callers.
 * Must be used inside <SpacetimeProvider>.
 */
export function useSpacetimeSession(sessionId: string) {
  const conn = useSpacetimeDB();
  const connection = conn?.getConnection?.() as any;
  const tables = (connection?.db ?? {}) as any;

  const [signals] = useTable((tables.signal ?? {}) as any);
  const [interventions] = useTable((tables.intervention ?? {}) as any);
  const [captions] = useTable((tables.caption ?? {}) as any);
  const [questions] = useTable((tables.question ?? {}) as any);
  const [moodWords] = useTable((tables.mood_word ?? {}) as any);
  const [polls] = useTable((tables.poll ?? {}) as any);

  // Filter to current session
  const sessionSignals = signals.filter((r: any) => r.session_id === sessionId);
  const sessionInterventions = interventions.filter((r: any) => r.session_id === sessionId);
  const sessionCaptions = captions.filter((r: any) => r.session_id === sessionId);
  const sessionQuestions = questions.filter((r: any) => r.session_id === sessionId && !r.dismissed);
  const sessionMoodWords = moodWords.filter((r: any) => r.session_id === sessionId);
  const sessionPolls = polls.filter((r: any) => r.session_id === sessionId);

  // Reducer callers
  const reducers = connection?.reducers as any;

  return {
    signals: sessionSignals,
    interventions: sessionInterventions,
    captions: sessionCaptions,
    questions: sessionQuestions,
    moodWords: sessionMoodWords,
    polls: sessionPolls,
    reducers: {
      submitSignal: reducers?.submitSignal.bind(reducers),
      logIntervention: reducers?.logIntervention.bind(reducers),
      acknowledgeIntervention: reducers?.acknowledgeIntervention.bind(reducers),
      submitCaption: reducers?.submitCaption?.bind(reducers),
      submitQuestion: reducers?.submitQuestion.bind(reducers),
      upvoteQuestion: reducers?.upvoteQuestion.bind(reducers),
      dismissQuestion: reducers?.dismissQuestion.bind(reducers),
      answerQuestion: reducers?.answerQuestion.bind(reducers),
      submitMood: reducers?.submitMood.bind(reducers),
      createPoll: reducers?.createPoll.bind(reducers),
      votePoll: reducers?.votePoll.bind(reducers),
      closePoll: reducers?.closePoll.bind(reducers),
      endSession: reducers?.endSession.bind(reducers),
    },
  };
}
