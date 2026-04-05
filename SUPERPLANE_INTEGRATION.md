# SUPERPLANE Integration Guide (current state)

Status: Superplane is not integrated. All AI workflows run inside Next.js API routes.

---

## Current AI workflow (no Superplane)

- `/api/intervene` → Gemini `analyzeIntervention` with optional ElevenLabs TTS. Interventions are persisted to `Session.interventions` and (when TTS is enabled) audio is stored in GridFS.
- `/api/summary` → Gemini `summarizeSegment` stores `SegmentSummary`, then Agent 2 (Suggester) creates a `Suggestion` document and broadcasts it via SSE.
- `/api/suggest` → optional manual run/list/dismiss with rate limiting and optional bearer token (`SUGGEST_AGENT_SECRET`).
- `/api/tts` → ElevenLabs proxy with in-memory cache.
- `/api/chat` → transcript-grounded Q&A using `SegmentSummary` context.

## Realtime transport

- `/api/signals` SSE stream for signals, interventions, suggestions, and captions.
- `/api/captions` for caption broadcast and in-memory history.
- SpacetimeDB stores caption rows and optional session tables.

## Data stores

- MongoDB collections: `Session`, `SegmentSummary`, `CoachReport`, `Suggestion`, `User`, `TranscriptChunk`.
- GridFS buckets: `audio` (uploads), `tts` (intervention audio).

## If you plan to add Superplane later

- Target long-running runs first: interventions and TTS.
- Add a Superplane client wrapper, then replace `/api/intervene` with run creation.
- Store run ids + status in MongoDB or SpacetimeDB for traceability.
- Keep `/api/summary` and `/api/suggest` as the baseline until flows are production-ready.
