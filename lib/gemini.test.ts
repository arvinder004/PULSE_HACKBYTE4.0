import { describe, it, expect } from 'vitest';
import { analyzeIntervention } from './gemini';

describe('analyzeIntervention (heuristic fallback)', () => {
  it('returns high urgency when confusion is high', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const res = await analyzeIntervention({
      sessionId: 'aaaaaaaaaaaa',
      transcript: 'I think the audience is getting lost at this step',
      signals: { confused: 4, clear: 0 },
    });
    process.env.GEMINI_API_KEY = prev;

    expect(res.urgency).toBe('high');
    expect(res.message.toLowerCase()).toContain('confus');
  });

  it('returns low urgency when signals are calm', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const res = await analyzeIntervention({
      sessionId: 'bbbbbbbbbbbb',
      transcript: 'We will now move on to the next part.',
      signals: { confused: 0, clear: 5 },
    });
    process.env.GEMINI_API_KEY = prev;

    expect(['low', 'medium', 'high']).toContain(res.urgency);
  });
});
