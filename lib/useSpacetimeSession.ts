'use client';

import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection } from '@/src/module_bindings';

/**
 * Hook that subscribes to all session-scoped tables and exposes typed reducer callers.
 * Must be used inside <SpacetimeProvider>.
 */
export function useSpacetimeSession(sessionId: string) {
  const conn = useSpacetimeDB<DbConnection>();

  const { rows: signals } = useTable<DbConnection, any>('signal');
  const { rows: interventions } = useTable<DbConnection, any>('intervention');
  const { rows: questions } = useTable<DbConnection, any>('question');
  const { rows: moodWords } = useTable<DbConnection, any>('mood_word');
  const { rows: polls } = useTable<DbConnection, any>('poll');

  // Filter to current session
  const sessionSignals = signals.filter((r: any) => r.session_id === sessionId);
  const sessionInterventions = interventions.filter((r: any) => r.session_id === sessionId);
  const sessionQuestions = questions.filter((r: any) => r.session_id === sessionId && !r.dismissed);
  const sessionMoodWords = moodWords.filter((r: any) => r.session_id === sessionId);
  const sessionPolls = polls.filter((r: any) => r.session_id === sessionId);

  // Reducer callers
  const reducers = conn?.reducers;

  return {
    signals: sessionSignals,
    interventions: sessionInterventions,
    questions: sessionQuestions,
    moodWords: sessionMoodWords,
    polls: sessionPolls,
    reducers: {
      submitSignal: reducers?.submitSignal.bind(reducers),
      logIntervention: reducers?.logIntervention.bind(reducers),
      acknowledgeIntervention: reducers?.acknowledgeIntervention.bind(reducers),
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
