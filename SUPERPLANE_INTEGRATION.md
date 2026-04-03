# SUPERPLANE Integration Guide (project root)

This guide explains a minimal, practical integration of Superplane into PULSE and lists the files to add plus the source changes you'll likely need.

Target: orchestrate AI interventions and TTS as durable, observable Superplane runs while keeping SpacetimeDB as the realtime stateplane.

---

## Files to add (recommended)

- `lib/superplane.ts` — Superplane client wrapper and `startRun()` helper.
- `app/api/intervene/route.ts` — server endpoint to start an `aiIntervention` run (idempotent by window).
- `flows/aiIntervention.flow.ts` (or JSON/YAML) — flow: fetch signals/transcript → Gemini → policy → (child) TTS → write intervention row.
- `flows/tts.flow.ts` — synthesize via ElevenLabs, upload audio artifact, return URL.
- (optional) `app/api/superplane/run-status/route.ts` — admin-only route to fetch run logs/status via Superplane API.

## Environment variables

- `SUPERPLANE_API_KEY` — server-only API key for Superplane (required).
- `SUPERPLANE_ORG` — optional org id.
- Existing keys remain: `ELEVENLABS_API_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SPACETIMEDB_URL`, etc.

Store `SUPERPLANE_API_KEY` in production secret manager; never expose it to clients.

## Minimal code examples

`lib/superplane.ts` (minimal wrapper)

```ts
import Superplane from 'superplane';

const client = new Superplane({ apiKey: process.env.SUPERPLANE_API_KEY });

export async function startRun(flowName: string, input: any, opts?: any) {
  return client.runs.create({ flow: flowName, input, ...opts });
}

export default client;
```

`app/api/intervene/route.ts` (minimal POST handler)

```ts
import { startRun } from '../../../lib/superplane';

export async function POST(req: Request) {
  const body = await req.json();
  const { sessionId, windowStart } = body;
  const idempotencyKey = `superplane:run:${sessionId}:${windowStart}`;
  const run = await startRun('aiIntervention', { sessionId, windowStart }, { idempotencyKey });
  return new Response(JSON.stringify({ runId: run.id }), { status: 202 });
}
```

Flow responsibilities (in `aiIntervention.flow`):

- Read recent signals and last 90s transcript (via SpacetimeDB or via an API helper).
- Call Gemini/Llama to generate `ProposedIntervention` (text, severity, urgency).
- Run Policy Engine (`lib/enforcement/*`) to get ALLOW/BLOCK/MODIFY decision.
- If ALLOW && urgent: call `tts.flow` to synthesize audio and upload to storage (S3/GCS) and return artifact URL.
- Write or update the `intervention` row in SpacetimeDB, including `superplaneRunId`, `status`, and `artifact`.

## Schema and reducer changes

Update the `intervention` table schema and reducers in `spacetime/src/index.ts` to accept and preserve these new fields (backwards compatible):

- `superplaneRunId: string | null` — link to Superplane run.
- `status: 'pending' | 'ready' | 'failed'` — run/artifact status.
- `artifact: string | null` — audio URL (optional).

When a run starts, the flow should insert an `intervention` row with `status: pending` and `superplaneRunId` set; later update to `ready|failed` and fill `artifact`.

## UI changes

- Speaker dashboard (`app/speaker/[sessionId]/page.tsx`) — show intervention card as before; when `status === 'ready'` and `artifact` exists, auto-enable a play button or autoplay (respect user preference).
- PolicyLog component — show `superplaneRunId` in admin view and link to admin route that fetches run logs (server-side) to avoid exposing API key to clients.

## Idempotency and triggering

- Use deterministic idempotency keys when starting runs, e.g. `superplane:run:{sessionId}:{windowStart}` to prevent duplicate runs when retried.
- Trigger runs from one of:
  - a server endpoint (`POST /api/intervene`) the speaker periodic check calls, or
  - a background worker that polls session metrics and starts runs when thresholds crossed.

## Observability & admin

- Store `superplaneRunId` on rows and expose a protected admin route that calls Superplane's API to fetch run details/logs for debugging.
- Optionally store run summary (status, start/end timestamps, errors) in your own DB for faster admin queries.

## Error handling & fallbacks

- Let Superplane manage retries on external calls. On permanent failure update the intervention `status: 'failed'` and create a visible InterventionCard with `message` but no audio.
- Keep sensitive error details out of the public UI; surface human-friendly messages and an admin-only detailed log.

## Testing

- Unit-test wrappers for Gemini and ElevenLabs using dependency injection / mocks.
- For flow testing, mock the Superplane client or use Superplane test mode if available.

## Deployment notes

- Add `SUPERPLANE_API_KEY` to production secrets.
- Ensure outbound HTTPS from your serverless environment to Superplane; if your Next runtime is Edge-only and cannot run Superplane SDK, host the `app/api/intervene` and admin routes on a Node function or small worker.

## Minimal rollout (first PR)

1. Add `lib/superplane.ts` and `app/api/intervene/route.ts` to start runs (stub flow that writes `intervention` row with `status: ready` and `superplaneRunId`).
2. Update `spacetime` reducer schema to accept `superplaneRunId` and `status`.
3. Update the speaker UI to play audio when `artifact` exists (no-op for stub).
4. Iterate to add Gemini, policy engine, and TTS flows.
