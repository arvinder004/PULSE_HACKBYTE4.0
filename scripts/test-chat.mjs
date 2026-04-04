#!/usr/bin/env node
/**
 * Test script: pulls SegmentSummary transcripts from MongoDB and asks Gemini a question.
 * Usage:
 *   node scripts/test-chat.mjs                          # lists sessions, picks latest
 *   node scripts/test-chat.mjs <sessionId>              # uses specific session
 *   node scripts/test-chat.mjs <sessionId> "question"   # non-interactive
 */

import { createInterface } from 'readline';
import { MongoClient } from 'mongodb';

// ── Load .env.local manually (no dotenv dep needed) ──────────────────────────
import { readFileSync } from 'fs';
const envLines = readFileSync('.env.local', 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const MONGODB_URI  = process.env.MONGODB_URI;
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// ── Gemini call ───────────────────────────────────────────────────────────────
async function askGemini(question, transcript) {
  if (!GEMINI_KEY) {
    console.warn('[warn] No GEMINI_API_KEY — using keyword fallback');
    const q = question.toLowerCase();
    const t = transcript.toLowerCase();
    const matched = q.split(/\s+/).filter(w => w.length > 4).some(w => t.includes(w));
    return matched
      ? 'Keyword match found. Set GEMINI_API_KEY for a real answer.'
      : "That hasn't been covered in the talk yet.";
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: [
            'You are a helpful assistant for a live talk.',
            'You are given the full session context below, which includes a summary and raw transcript for each segment from the beginning of the talk.',
            'Answer the question using ONLY this context.',
            'If the answer is not in the context, say: "That hasn\'t been covered in the talk yet."',
            'Keep answers concise — 2–4 sentences max.',
            '',
            `SESSION CONTEXT:\n${transcript}`,
          ].join('\n') }] },
          { role: 'model', parts: [{ text: 'Understood. I will only answer from the transcript.' }] },
          { role: 'user', parts: [{ text: `QUESTION: ${question}` }] },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${body}`);
    }

    const json = await res.json();
    return json?.candidates?.[0]?.content?.parts?.map(p => p?.text).filter(Boolean).join('').trim()
      || "That hasn't been covered in the talk yet.";
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const client = new MongoClient(MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db();
  const col = db.collection('segmentsummaries');

  const [, , argSession, argQuestion] = process.argv;

  // List available sessions
  const sessions = await col.distinct('sessionId');
  if (!sessions.length) {
    console.error('No SegmentSummary documents found in MongoDB.');
    process.exit(1);
  }

  console.log('\nAvailable sessions:');
  sessions.forEach((s, i) => console.log(`  [${i}] ${s}`));

  let sessionId = argSession;
  if (!sessionId) {
    // Pick the latest one by most recent segment
    const latest = await col.find().sort({ createdAt: -1 }).limit(1).toArray();
    sessionId = latest[0]?.sessionId ?? sessions[0];
    console.log(`\nNo sessionId provided — using latest: ${sessionId}`);
  } else if (!sessions.includes(sessionId)) {
    console.error(`\nSession "${sessionId}" not found.`);
    process.exit(1);
  }

  // Fetch segments
  const segments = await col.find({ sessionId }).sort({ windowStart: 1 }).toArray();
  const fullText = segments.map(s => s.transcript || '').join(' ').trim();
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  // Build full context: summary + transcript for every segment from session start
  const fullContext = segments.map((s, i) => {
    const parts = [`[Segment ${i + 1}]`];
    if (s.summary?.trim())    parts.push(`Summary: ${s.summary.trim()}`);
    if (s.transcript?.trim()) parts.push(`Transcript: ${s.transcript.trim()}`);
    return parts.join('\n');
  }).join('\n\n');

  console.log(`\nSession: ${sessionId}`);
  console.log(`Segments: ${segments.length} | Words: ${wordCount}`);
  console.log('─'.repeat(60));
  console.log('Transcript preview:', fullText.slice(0, 300) + (fullText.length > 300 ? '…' : ''));
  console.log('─'.repeat(60));

  if (wordCount < 10) {
    console.warn('\n[warn] Very little transcript content — answers may be poor.');
  }

  // Question — from arg or interactive
  if (argQuestion) {
    await runQuestion(argQuestion, fullContext);
    await client.close();
    return;
  }

  // Interactive loop
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = () => rl.question('\nYour question (or "exit"): ', async (q) => {
    if (!q.trim() || q.trim().toLowerCase() === 'exit') {
      rl.close();
      await client.close();
      return;
    }
    await runQuestion(q.trim(), fullContext);
    ask();
  });
  ask();
}

async function runQuestion(question, transcript) {
  console.log(`\nQ: ${question}`);
  process.stdout.write('Thinking… ');
  const t0 = Date.now();
  try {
    const answer = await askGemini(question, transcript);
    console.log(`(${Date.now() - t0}ms)\n`);
    console.log(`A: ${answer}`);
  } catch (err) {
    console.log('\n[error]', err.message);
  }
}

main().catch(err => {
  console.error(err);
  client.close();
  process.exit(1);
});
