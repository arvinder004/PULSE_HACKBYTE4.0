/**
 * ArmorIQ — Pulse integration layer
 *
 * ArmorIQ wraps every AI agent call with cryptographic intent verification:
 *   1. capturePlan()     — declare what the agent will do
 *   2. getIntentToken()  — get a signed token from ArmorIQ IAP
 *   3. invoke()          — execute through the ArmorIQ proxy (verified)
 *
 * Each agent in Pulse maps to one MCP registered on platform.armoriq.ai.
 * The MCP URL points back to our own Next.js API routes so ArmorIQ proxies
 * the call and verifies it before it reaches our handler.
 *
 * Required env vars:
 *   ARMORIQ_API_KEY      — ak_live_... from platform.armoriq.ai
 *   ARMORIQ_USER_ID      — stable identifier for your org/user
 *   ARMORIQ_AGENT_ID     — identifier for the Pulse agent system
 *
 * Optional:
 *   ARMORIQ_ENV          — 'production' (default) | 'development'
 */

import { ArmorIQClient } from '@armoriq/sdk';
import type { IntentToken, MCPInvocationResult } from '@armoriq/sdk';

// ── Singleton client ──────────────────────────────────────────────────────────

let _client: ArmorIQClient | null = null;

function getClient(): ArmorIQClient {
  if (_client) return _client;

  const apiKey    = process.env.ARMORIQ_API_KEY;
  // SDK reads USER_ID and AGENT_ID (not ARMORIQ_ prefixed) per the SDK source
  const userId    = process.env.USER_ID    ?? process.env.ARMORIQ_USER_ID    ?? 'pulse-system';
  const agentId   = process.env.AGENT_ID   ?? process.env.ARMORIQ_AGENT_ID   ?? 'pulse-agent';
  const useProduction = (process.env.ARMORIQ_ENV ?? 'production') === 'production';

  if (!apiKey) {
    throw new Error('[ArmorIQ] ARMORIQ_API_KEY is not set. Get one at platform.armoriq.ai');
  }

  _client = new ArmorIQClient({
    apiKey,
    userId,
    agentId,
    useProduction,
  });

  return _client;
}

// ── MCP names (must match what you register on platform.armoriq.ai) ──────────

export const MCP = {
  SUGGESTER:            'pulse-suggester',
  QUESTION_CLASSIFIER:  'pulse-question-classifier',
} as const;

// ── Agent action names ────────────────────────────────────────────────────────

export const ACTION = {
  RUN_SUGGESTER:           'run_suggester',
  RUN_QUESTION_CLASSIFIER: 'run_question_classifier',
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentRunParams = Record<string, unknown>;

export interface ArmorIQAgentResult {
  raw: MCPInvocationResult;
  data: unknown;
  verified: boolean;
}

// ── Core helper: run one agent action through ArmorIQ ─────────────────────────

export async function runAgent(
  mcp: string,
  action: string,
  params: AgentRunParams,
  opts?: { llm?: string; prompt?: string },
): Promise<ArmorIQAgentResult> {
  const client = getClient();

  const plan = {
    goal: `Execute ${action} on ${mcp}`,
    steps: [
      {
        action,
        tool:   action,
        mcp,
        inputs: params,
        description: `Run ${action}`,
      },
    ],
  };

  const planCapture = client.capturePlan(
    opts?.llm    ?? 'gemini-2.0-flash',
    opts?.prompt ?? `Run ${action}`,
    plan,
  );

  const token: IntentToken = await client.getIntentToken(planCapture);
  const result: MCPInvocationResult = await client.invoke(mcp, action, token, params as Record<string, any>);

  return {
    raw:      result,
    data:     result.result,
    verified: result.verified,
  };
}

// ── Graceful fallback when ArmorIQ is not configured ─────────────────────────
// If ARMORIQ_API_KEY is absent, agents call Gemini directly (dev mode).

export function isArmorIQConfigured(): boolean {
  return !!process.env.ARMORIQ_API_KEY;
}

// ── JSON parse helper shared by agents ───────────────────────────────────────

export function parseAgentJSON<T>(raw: string): T {
  const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON in agent output: ${raw.slice(0, 200)}`);
  return JSON.parse(match[0]) as T;
}
