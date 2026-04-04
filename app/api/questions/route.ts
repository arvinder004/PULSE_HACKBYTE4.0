import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Session from '@/lib/models/Session';
import { runQuestionClassifier } from '@/lib/agents/runner';
import { buildClassifierPrompt } from '@/lib/agents/question-classifier';

type Question = {
  id: string;
  sessionId: string;
  text: string;
  audienceId: string;
  upvotes: number;
  ts: number;
  isPrimary: boolean;
  mergedCount: number; // how many duplicates were folded in
  priority: 'high' | 'medium' | 'low';
};

const g = globalThis as typeof globalThis & {
  __pulse_questions?: Map<string, Question>;
  __pulse_primary?: Map<string, string>;
};
if (!g.__pulse_questions) g.__pulse_questions = new Map();
if (!g.__pulse_primary)   g.__pulse_primary   = new Map();

const questions  = g.__pulse_questions;
const primaryMap = g.__pulse_primary;
const cooldowns  = new Map<string, number>();

// ── Similarity helpers ────────────────────────────────────────────────────────

function tokenize(text: string): Map<string, number> {
  const STOP = new Set(['a','an','the','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should','may',
    'might','shall','can','need','dare','ought','used','to','of','in','on','at',
    'by','for','with','about','against','between','into','through','during',
    'before','after','above','below','from','up','down','out','off','over',
    'under','again','further','then','once','and','but','or','nor','so','yet',
    'both','either','neither','not','only','own','same','than','too','very',
    'just','because','as','until','while','i','you','he','she','it','we','they',
    'what','which','who','this','that','these','those','how','why','when','where']);

  const freq = new Map<string, number>();
  for (const w of text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (w.length > 1 && !STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return freq;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, magA = 0, magB = 0;
  for (const [w, v] of a) { magA += v * v; if (b.has(w)) dot += v * b.get(w)!; }
  for (const [, v] of b) magB += v * v;
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

const SIMILARITY_THRESHOLD = 0.55;

/** Returns the most similar existing question for a session, or null. */
function findSimilar(sessionId: string, text: string): Question | null {
  const tokens = tokenize(text);
  let best: Question | null = null;
  let bestScore = SIMILARITY_THRESHOLD;

  for (const q of questions.values()) {
    if (q.sessionId !== sessionId) continue;
    const score = cosineSimilarity(tokens, tokenize(q.text));
    if (score > bestScore) { bestScore = score; best = q; }
  }
  return best;
}

// ── Priority assignment ───────────────────────────────────────────────────────

/** Assign priority based on upvotes + mergedCount at query time. */
function assignPriority(q: Question): 'high' | 'medium' | 'low' {
  const score = q.upvotes + q.mergedCount;
  if (score >= 5) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}


async function getPrimaryAudienceId(sessionId: string): Promise<string | null> {
  if (primaryMap.has(sessionId)) return primaryMap.get(sessionId)!;
  try {
    await connectDB();
    const session = await Session.findOne({ sessionId }).lean() as any;
    const id = session?.primaryAudienceId ?? null;
    if (id) primaryMap.set(sessionId, id);
    return id;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.sessionId || !body?.text || !body?.audienceId) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { sessionId, text, audienceId } = body as { sessionId: string; text: string; audienceId: string };

  if (text.trim().length === 0 || text.length > 200) {
    return NextResponse.json({ error: 'Question must be 1–200 characters' }, { status: 422 });
  }

  const cooldownKey = `${sessionId}:${audienceId}`;
  const lastAt = cooldowns.get(cooldownKey) ?? 0;
  if (Date.now() - lastAt < 30_000) {
    return NextResponse.json({ error: 'Please wait before submitting another question' }, { status: 429 });
  }

  const primaryId = await getPrimaryAudienceId(sessionId);
  const isPrimary = !primaryId || audienceId === primaryId;

  // ── Duplicate / similarity check ─────────────────────────────────────────
  const similar = findSimilar(sessionId, text.trim());
  if (similar) {
    // Don't let the same person upvote via duplicate submission
    if (similar.audienceId !== audienceId) {
      similar.upvotes += 1;
      similar.mergedCount += 1;
      questions.set(similar.id, similar);
    }
    cooldowns.set(cooldownKey, Date.now());
    return NextResponse.json({
      ok: true,
      id: similar.id,
      isPrimary: similar.isPrimary,
      merged: true,
      canonicalText: similar.text,
    });
  }

  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const newQ: Question = { id, sessionId, text: text.trim(), audienceId, upvotes: 0, ts: Date.now(), isPrimary, mergedCount: 0, priority: 'low' };
  newQ.priority = assignPriority(newQ);
  questions.set(id, newQ);
  cooldowns.set(cooldownKey, Date.now());

  // Persist to MongoDB asynchronously
  connectDB().then(async () => {
    await Session.updateOne(
      { sessionId },
      { $push: { questions: { id, text: text.trim(), audienceId, upvotes: 0, dismissed: false, answered: false, createdAt: new Date() } } }
    );

    // Agent 3: classify the question asynchronously (don't block response)
    try {
      const session = await Session.findOne({ sessionId }).lean() as any;
      if (!session) return;

      // Get existing questions for duplicate detection
      const existingQs = (session.questions ?? [])
        .filter((q: any) => q.id !== id)
        .slice(-20)
        .map((q: any) => ({ id: q.id, text: q.text, category: q.category, theme_tag: q.themeTag }));

      // Get recent transcript from SegmentSummary
      const SegmentSummary = (await import('@/lib/models/SegmentSummary')).default;
      const recentSegments = await SegmentSummary.find({ sessionId })
        .sort({ windowStart: -1 }).limit(2).lean();
      const transcriptExcerpt = recentSegments.map((s: any) => s.transcript).reverse().join(' ').slice(0, 1500);

      const userMessage = buildClassifierPrompt({
        questionId:        id,
        questionText:      text.trim(),
        audienceId,
        sessionTopic:      session.topic,
        transcriptExcerpt,
        existingQuestions: existingQs,
      });

      const classification = await runQuestionClassifier(userMessage);

      // Persist classification back to the question
      await Session.updateOne(
        { sessionId, 'questions.id': id },
        {
          $set: {
            'questions.$.relevant':             classification.relevant,
            'questions.$.forwardToSuggester':   classification.forward_to_suggester,
            'questions.$.category':             classification.category,
            'questions.$.urgency':              classification.urgency,
            'questions.$.themeTag':             classification.theme_tag,
            'questions.$.duplicateOf':          classification.duplicate_of,
            'questions.$.classificationReason': classification.reason,
          },
        }
      );

      console.log('[ArmorIQ][QuestionClassifier] classified', { sessionId, id, category: classification.category, urgency: classification.urgency, forward: classification.forward_to_suggester });
    } catch (e) {
      console.error('[ArmorIQ][QuestionClassifier] failed', String(e));
    }
  }).catch(err => console.error('[PULSE][Questions] MongoDB persist failed', err));

  return NextResponse.json({ ok: true, id, isPrimary });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId   = searchParams.get('sessionId');
  const primaryOnly = searchParams.get('primaryOnly') === '1';

  let result = [...questions.values()]
    .filter(q => !sessionId || q.sessionId === sessionId)
    .map(q => ({ ...q, priority: assignPriority(q) }));

  if (primaryOnly) {
    result = result.filter(q => q.isPrimary);
  }

  return NextResponse.json(
    result.sort((a, b) => (b.upvotes + b.mergedCount) - (a.upvotes + a.mergedCount) || a.ts - b.ts)
  );
}

// PATCH — upvote a question by id
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { id, audienceId } = body ?? {};
  if (!id || !audienceId) {
    return NextResponse.json({ error: 'Provide id and audienceId' }, { status: 400 });
  }
  const q = questions.get(id);
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Prevent self-upvote
  if (q.audienceId === audienceId) {
    return NextResponse.json({ error: 'Cannot upvote your own question' }, { status: 403 });
  }

  q.upvotes += 1;
  questions.set(id, q);
  return NextResponse.json({ ok: true, upvotes: q.upvotes });
}

// DELETE — remove a single question by id, or all questions for a session
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id        = searchParams.get('id');
  const sessionId = searchParams.get('sessionId');

  if (id) {
    questions.delete(id);
    return NextResponse.json({ ok: true, deleted: id });
  }

  if (sessionId) {
    let count = 0;
    for (const [key, q] of questions.entries()) {
      if (q.sessionId === sessionId) { questions.delete(key); count++; }
    }
    return NextResponse.json({ ok: true, cleared: count });
  }

  return NextResponse.json({ error: 'Provide id or sessionId' }, { status: 400 });
}
