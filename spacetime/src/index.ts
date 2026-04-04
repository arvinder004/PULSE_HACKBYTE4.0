import { schema, table, t } from 'spacetimedb/server';

// --- Tables ---

const sessionTable = table(
  { name: 'session', public: true },
  {
    session_id: t.string().primaryKey(),
    speaker_name: t.string(),
    topic: t.string(),
    created_at: t.u64(),
    active: t.bool(),
  }
);

const signalTable = table(
  { name: 'signal', public: true },
  {
    id: t.string().primaryKey(),
    session_id: t.string(),
    signal_type: t.string(),
    audience_id: t.string(),
    fingerprint: t.string(),
    weight: t.f32(),
    created_at: t.u64(),
  }
);

const interventionTable = table(
  { name: 'intervention', public: true },
  {
    id: t.string().primaryKey(),
    session_id: t.string(),
    message: t.string(),
    suggestion: t.string(),
    urgency: t.string(),
    acknowledged: t.bool(),
    created_at: t.u64(),
  }
);

const captionTable = table(
  { name: 'caption', public: true },
  {
    id: t.string().primaryKey(),
    session_id: t.string(),
    text: t.string(),
    created_at: t.u64(),
  }
);

const questionTable = table(
  { name: 'question', public: true },
  {
    id: t.string().primaryKey(),
    session_id: t.string(),
    text: t.string(),
    audience_id: t.string(),
    upvotes: t.u32(),
    dismissed: t.bool(),
    answered: t.bool(),
    created_at: t.u64(),
  }
);

const questionUpvoteTable = table(
  { name: 'question_upvote', public: true },
  {
    id: t.string().primaryKey(),
    question_id: t.string(),
    audience_id: t.string(),
  }
);

const moodWordTable = table(
  { name: 'mood_word', public: true },
  {
    id: t.string().primaryKey(),
    session_id: t.string(),
    word: t.string(),
    audience_id: t.string(),
    intervention_id: t.string(),
    created_at: t.u64(),
  }
);

const pollTable = table(
  { name: 'poll', public: true },
  {
    id: t.string().primaryKey(),
    session_id: t.string(),
    question: t.string(),
    options: t.string(),  // JSON string[]
    votes: t.string(),    // JSON Record<string, number>
    active: t.bool(),
    created_at: t.u64(),
  }
);

const pollVoteTable = table(
  { name: 'poll_vote', public: true },
  {
    id: t.string().primaryKey(),
    poll_id: t.string(),
    audience_id: t.string(),
    option: t.string(),
  }
);

const rateLimitTable = table(
  { name: 'rate_limit' }, // private — no public: true
  {
    key: t.string().primaryKey(),
    last_action: t.u64(),
  }
);

// --- Schema ---

export const spacetimedb = schema({
  session: sessionTable,
  signal: signalTable,
  intervention: interventionTable,
  caption: captionTable,
  question: questionTable,
  question_upvote: questionUpvoteTable,
  mood_word: moodWordTable,
  poll: pollTable,
  poll_vote: pollVoteTable,
  rate_limit: rateLimitTable,
});

// --- Reducers ---

spacetimedb.reducer(
  { name: 'create_session' },
  { session_id: t.string(), speaker_name: t.string(), topic: t.string() },
  (ctx, { session_id, speaker_name, topic }) => {
    ctx.db.session.insert({
      session_id,
      speaker_name,
      topic,
      created_at: BigInt(Date.now()),
      active: true,
    });
  }
);

spacetimedb.reducer(
  { name: 'submit_signal' },
  {
    id: t.string(),
    session_id: t.string(),
    signal_type: t.string(),
    audience_id: t.string(),
    fingerprint: t.string(),
    weight: t.f32(),
  },
  (ctx, { id, session_id, signal_type, audience_id, fingerprint, weight }) => {
    ctx.db.signal.insert({
      id,
      session_id,
      signal_type,
      audience_id,
      fingerprint,
      weight,
      created_at: BigInt(Date.now()),
    });
  }
);

spacetimedb.reducer(
  { name: 'log_intervention' },
  { id: t.string(), session_id: t.string(), message: t.string(), suggestion: t.string(), urgency: t.string() },
  (ctx, { id, session_id, message, suggestion, urgency }) => {
    ctx.db.intervention.insert({
      id,
      session_id,
      message,
      suggestion,
      urgency,
      acknowledged: false,
      created_at: BigInt(Date.now()),
    });
  }
);

spacetimedb.reducer(
  { name: 'submit_caption' },
  { id: t.string(), session_id: t.string(), text: t.string() },
  (ctx, { id, session_id, text }) => {
    ctx.db.caption.insert({
      id,
      session_id,
      text,
      created_at: BigInt(Date.now()),
    });
  }
);

spacetimedb.reducer(
  { name: 'acknowledge_intervention' },
  { id: t.string() },
  (ctx, { id }) => {
    const row = ctx.db.intervention.id.find(id);
    if (row) ctx.db.intervention.delete(row);
    if (row) ctx.db.intervention.insert({ ...row, acknowledged: true });
  }
);

spacetimedb.reducer(
  { name: 'submit_question' },
  { id: t.string(), session_id: t.string(), text: t.string(), audience_id: t.string() },
  (ctx, { id, session_id, text, audience_id }) => {
    ctx.db.question.insert({
      id,
      session_id,
      text,
      audience_id,
      upvotes: 0,
      dismissed: false,
      answered: false,
      created_at: BigInt(Date.now()),
    });
  }
);

spacetimedb.reducer(
  { name: 'upvote_question' },
  { question_id: t.string(), audience_id: t.string() },
  (ctx, { question_id, audience_id }) => {
    const alreadyVoted = [...ctx.db.question_upvote.iter()]
      .find(r => r.question_id === question_id && r.audience_id === audience_id);
    if (alreadyVoted) return;

    ctx.db.question_upvote.insert({
      id: `${question_id}:${audience_id}`,
      question_id,
      audience_id,
    });

    const q = ctx.db.question.id.find(question_id);
    if (q) {
      ctx.db.question.delete(q);
      ctx.db.question.insert({ ...q, upvotes: q.upvotes + 1 });
    }
  }
);

spacetimedb.reducer(
  { name: 'dismiss_question' },
  { question_id: t.string() },
  (ctx, { question_id }) => {
    const q = ctx.db.question.id.find(question_id);
    if (q) { ctx.db.question.delete(q); ctx.db.question.insert({ ...q, dismissed: true }); }
  }
);

spacetimedb.reducer(
  { name: 'answer_question' },
  { question_id: t.string() },
  (ctx, { question_id }) => {
    const q = ctx.db.question.id.find(question_id);
    if (q) { ctx.db.question.delete(q); ctx.db.question.insert({ ...q, answered: true }); }
  }
);

spacetimedb.reducer(
  { name: 'submit_mood' },
  { id: t.string(), session_id: t.string(), word: t.string(), audience_id: t.string(), intervention_id: t.string() },
  (ctx, { id, session_id, word, audience_id, intervention_id }) => {
    ctx.db.mood_word.insert({ id, session_id, word, audience_id, intervention_id, created_at: BigInt(Date.now()) });
  }
);

spacetimedb.reducer(
  { name: 'create_poll' },
  { id: t.string(), session_id: t.string(), question: t.string(), options: t.string() },
  (ctx, { id, session_id, question, options }) => {
    ctx.db.poll.insert({ id, session_id, question, options, votes: '{}', active: true, created_at: BigInt(Date.now()) });
  }
);

spacetimedb.reducer(
  { name: 'vote_poll' },
  { poll_id: t.string(), audience_id: t.string(), option: t.string() },
  (ctx, { poll_id, audience_id, option }) => {
    const alreadyVoted = [...ctx.db.poll_vote.iter()]
      .find(r => r.poll_id === poll_id && r.audience_id === audience_id);
    if (alreadyVoted) return;

    ctx.db.poll_vote.insert({ id: `${poll_id}:${audience_id}`, poll_id, audience_id, option });

    const poll = ctx.db.poll.id.find(poll_id);
    if (poll) {
      const votes = JSON.parse(poll.votes) as Record<string, number>;
      votes[option] = (votes[option] ?? 0) + 1;
      ctx.db.poll.delete(poll);
      ctx.db.poll.insert({ ...poll, votes: JSON.stringify(votes) });
    }
  }
);

spacetimedb.reducer(
  { name: 'close_poll' },
  { poll_id: t.string() },
  (ctx, { poll_id }) => {
    const poll = ctx.db.poll.id.find(poll_id);
    if (poll) { ctx.db.poll.delete(poll); ctx.db.poll.insert({ ...poll, active: false }); }
  }
);

spacetimedb.reducer(
  { name: 'end_session' },
  { session_id: t.string() },
  (ctx, { session_id }) => {
    const session = ctx.db.session.session_id.find(session_id);
    if (session) { ctx.db.session.delete(session); ctx.db.session.insert({ ...session, active: false }); }
  }
);
