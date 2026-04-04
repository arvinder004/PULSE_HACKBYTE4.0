import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Transcript from '@/lib/models/Transcript';

// 5s per-user cooldown
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 5_000;

function isValidSessionId(id: string) {
  return /^[a-z0-9]{12}$/.test(id);
}

async function askGemini(question: string, transcript: string): Promise<string> {
  const model = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
  const apiKey = process.env.GEMINI_API_KEY;

  const systemPrompt = [
    'You are a helpful assistant for a live talk.',
    'Answer the question using ONLY the transcript provided below.',
    'If the answer is not in the transcript, respond with exactly: "That hasn\'t been covered in the talk yet."',
    'Keep answers concise — 2–4 sentences max.',
    'Do not make up information. Do not reference outside knowledge.',
    '',
    `TRANSCRIPT:\n${transcript}`,
  ].join('\n');

  const userPrompt = `QUESTION: ${question}`;

  if (!apiKey) {
    // Heuristic fallback — keyword match
    const q = question.toLowerCase();
    const t = transcript.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 4);
    const matched = words.some(w => t.includes(w));
    if (!matched || transcript.length < 30) {
      return "That hasn't been covered in the talk yet.";
    }
    return "Based on the talk so far, the speaker touched on this topic. Enable Gemini for a detailed answer.";
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Understood. I will only answer from the transcript.' }] },
        { role: 'user', parts: [{ text: userPrompt }] },
      ],
      generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
    }),
  });

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

  const doc = await Transcript.findOne({ sessionId: body.sessionId }).lean();
  const fullText = doc?.fullText ?? '';
  const updatedAt = doc?.updatedAt ?? null;
  const transcriptAge = updatedAt
    ? Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000)
    : null;

  const grounded = fullText.trim().length >= 30;

  if (!grounded) {
    return NextResponse.json({
      answer: "Not enough context yet — ask after the speaker has talked for a bit.",
      grounded: false,
      transcriptAge,
      wordCount: 0,
    });
  }

  console.log('[PULSE][R1][Chat] question', { sessionId: body.sessionId, qLen: body.question.length, transcriptWords: doc?.wordCount });

  const answer = await askGemini(body.question.trim(), fullText);

  return NextResponse.json({
    answer,
    grounded: true,
    transcriptAge,
    wordCount: doc?.wordCount ?? 0,
  });
}
