import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import SegmentSummary from '@/lib/models/SegmentSummary';

// 5s per-user cooldown
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 5_000;

function isValidSessionId(id: string) {
  return /^[a-z0-9]{12}$/.test(id);
}

async function askGemini(question: string, context: string): Promise<string> {
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const apiKey = process.env.GEMINI_API_KEY;

  const systemPrompt = [
    'You are a helpful assistant for a live talk.',
    'You are given the full session context below, which includes a summary and raw transcript for each segment from the beginning of the talk.',
    'Answer the question using ONLY this context.',
    'If the answer is not in the context, respond with exactly: "That hasn\'t been covered in the talk yet."',
    'Keep answers concise — 2–4 sentences max.',
    'Do not make up information. Do not reference outside knowledge.',
    '',
    `SESSION CONTEXT:\n${context}`,
  ].join('\n');

  const userPrompt = `QUESTION: ${question}`;

  if (!apiKey) {
    // Heuristic fallback — keyword match
    const q = question.toLowerCase();
    const t = context.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 4);
    const matched = words.some(w => t.includes(w));
    if (!matched || context.length < 30) {
      return "That hasn't been covered in the talk yet.";
    }
    return "Based on the talk so far, the speaker touched on this topic. Enable Gemini for a detailed answer.";
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'model', parts: [{ text: 'Understood. I will only answer from the transcript.' }] },
          { role: 'user', parts: [{ text: userPrompt }] },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[PULSE][Chat] Gemini error', res.status, errBody);
    throw new Error(`Gemini API error ${res.status}`);
  }

  const json = await res.json().catch(() => null) as any;
  const answer = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? '';
  return answer.trim() || "That hasn't been covered in the talk yet.";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    sessionId?: string;
    question?: string;
    audienceId?: string;
  } | null;

  if (!body?.sessionId || !body?.question?.trim() || !body?.audienceId) {
    return NextResponse.json({ error: 'sessionId, question, and audienceId are required' }, { status: 400 });
  }
  if (!isValidSessionId(body.sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }
  if (body.question.length > 300) {
    return NextResponse.json({ error: 'Question too long (max 300 chars)' }, { status: 422 });
  }

  // Per-user cooldown
  const rlKey = `${body.sessionId}:${body.audienceId}`;
  const lastAt = cooldowns.get(rlKey) ?? 0;
  if (Date.now() - lastAt < COOLDOWN_MS) {
    return NextResponse.json(
      { error: 'Too fast', retryAfter: Math.ceil((lastAt + COOLDOWN_MS - Date.now()) / 1000) },
      { status: 429 }
    );
  }
  cooldowns.set(rlKey, Date.now());

  await connectDB();

  const { sessionId, question } = body as Required<typeof body>;

  const segments = await SegmentSummary.find({ sessionId })
    .sort({ windowStart: 1 })
    .lean();

  // Build full context: for every segment (from start of session), include its summary + raw transcript
  const fullContext = segments.map((s, i) => {
    const parts: string[] = [`[Segment ${i + 1}]`];
    if (s.summary?.trim())     parts.push(`Summary: ${s.summary.trim()}`);
    if (s.transcript?.trim())  parts.push(`Transcript: ${s.transcript.trim()}`);
    return parts.join('\n');
  }).join('\n\n');

  const fullText  = segments.map(s => s.transcript || '').join(' ').trim();
  const wordCount = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0;
  const lastSeg = segments[segments.length - 1];
  const lastTs = typeof lastSeg?.windowEnd === 'number'
    ? lastSeg.windowEnd
    : (lastSeg?.createdAt ? new Date(lastSeg.createdAt).getTime() : null);
  const transcriptAge = lastTs != null ? Math.floor((Date.now() - lastTs) / 1000) : null;

  const grounded = fullContext.trim().length >= 30;

  if (!grounded) {
    return NextResponse.json({
      answer: "Not enough context yet — ask after the speaker has talked for a bit.",
      grounded: false,
      transcriptAge,
      wordCount,
    });
  }

  console.log('[PULSE][R1][Chat] question', { sessionId, qLen: question.length, transcriptWords: wordCount });

  let answer: string;
  try {
    answer = await askGemini(question.trim(), fullContext);
  } catch (err) {
    console.error('[PULSE][Chat] askGemini failed', err);
    return NextResponse.json({ error: 'AI service unavailable, please try again.' }, { status: 503 });
  }

  return NextResponse.json({
    answer,
    grounded: true,
    transcriptAge,
    wordCount,
  });
}
