# PULSE — Architecture Plan (Updated)

Last updated: 2026-04-04

## Executive Summary

PULSE is a real-time, AI-assisted “room whisperer” for live talks.

- Audience members send lightweight feedback (signals + questions) from their phones.
- Speaker and producer dashboards receive near-real-time updates via **Server-Sent Events (SSE)**.
- The system records **60s audio chunks**, stores them durably, and uses **Gemini speech-to-text (STT)** to build a transcript.
- Interventions are generated via **Gemini reasoning** when confusion/pacing signals cross simple thresholds.

The current implementation is:

- **Next.js 16 (App Router)**: UI + API routes.
- **MongoDB (Mongoose)**: durable documents (sessions, interventions, transcript chunks, users).
- **GridFS**: durable audio blobs (uploaded chunks).
- **SSE + in-memory state**: real-time fanout for signals and intervention events.
- **Gemini**: STT transcription + transcript-grounded chat + intervention reasoning.
- **SpacetimeDB (present, optional)**: a realtime module + generated client bindings exist in the repo; it is not required for the core signals/transcript flow.

Non-goals for this document: endpoints that do not exist under `app/api/`.

---

## System Context

```mermaid
graph LR
  Speaker[Speaker Browser] --> UI[Next.js UI]
  Producer[Producer Browser] --> UI
  Audience[Audience Browser] --> UI

  UI --> API[Next.js API Routes]

  API --> SSE[/api/signals SSE fanout/]
  API --> Sess[/api/session + auth/]
  API --> Audio[/api/audio/* + /api/transcript/]
  API --> Chat[/api/chat/]
  API --> Intervene[/api/intervene/]

  Sess --> Mongo[(MongoDB)]
  Intervene --> Mongo
  Audio --> Mongo

  Audio --> GFS[(GridFS: audio bucket)]

  Audio --> Gemini[Gemini STT]
  Chat --> Gemini
  Intervene --> Gemini

  UI -. "WS (optional)" .-> STDB[(SpacetimeDB)]
```

### What’s true in code today

- **Transcript source of truth** is server-side (Gemini STT) via `/api/audio/upload` → async transcription → `TranscriptChunk` in MongoDB.
- **Signals source of truth** is in-memory per Next.js process; clients subscribe via SSE (`/api/signals?sse=1`).

### SpacetimeDB (present in the repo)

SpacetimeDB is present as a separate module and client wiring:

- Module package: `spacetime/`
- Generated client bindings: `src/module_bindings/`
- Client integration points: `components/SpacetimeProvider.tsx` and `lib/useSpacetimeSession.ts`

It is not required for the core SSE + MongoDB + Gemini STT pipeline described above.

---

## Project Modules (Repo-Level Architecture)

This diagram is intentionally “whole-project” and shows the repo split into modules.

```mermaid
flowchart TB
  subgraph NextApp["Next.js App"]
    subgraph UI["UI Routes (app/*)"]
      SpeakerUI["Speaker (app/speaker/[sessionId])"]
      ProducerUI["Producer (app/producer/[sessionId])"]
      AudienceUI["Audience (app/audience/[sessionId])"]
    end
    subgraph API["API Routes (app/api/*)"]
      SessionAPI["session + auth"]
      SignalsAPI["signals (SSE)"]
      QuestionsAPI["questions"]
      AudioAPI["audio upload/list"]
      TranscriptAPI["transcript"]
      InterveneAPI["intervene"]
      ChatAPI["chat"]
    end
  end

  subgraph Lib["Server/Shared Libs (lib/*)"]
    DB["db.ts (Mongo + GridFS)"]
    Models["models/* (Mongoose)"]
    GeminiLib["gemini.ts + gemini-transcribe.ts"]
    AuthLib["jwt.ts"]
    Fingerprint["fingerprint.ts"]
  end

  subgraph Data["Data Stores"]
    Mongo[(MongoDB)]
    GridFS[(GridFS audio)]
  end

  subgraph Realtime["Realtime (optional)"]
    STDB[(SpacetimeDB)]
    Bindings["src/module_bindings/*"]
  end

  subgraph External["External AI"]
    Gemini[Gemini API]
  end

  UI --> API
  API --> Lib

  DB --> Mongo
  DB --> GridFS
  Models --> Mongo

  GeminiLib --> Gemini

  UI -. "WS (optional)" .-> STDB
  Bindings -.-> UI
  Bindings -.-> API
```

---

## Implemented API Surface (Current)

- **Auth**
  - `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` (httpOnly cookie JWT)
- **Session lifecycle**
  - `POST /api/session`, `GET /api/session?sessionId=...`
  - `POST /api/session/start`, `POST /api/session/end`
  - `GET/POST /api/session/primary` (assign “primary judge”)
- **Signals (SSE)**
  - `POST /api/signals` (rate-limited per fingerprint)
  - `GET /api/signals?sessionId=...&sse=1` (SSE) or without `sse=1` for snapshot
- **Questions (in-memory + polling)**
  - `POST /api/questions` (rate-limited; stored in-memory)
  - `GET /api/questions?sessionId=...&primaryOnly=1` (producer uses this)
- **Interventions**
  - `POST /api/intervene` (Gemini reasoning; persists to MongoDB; broadcast to clients)
  - `GET /api/intervene?sessionId=...` (last 10)
- **Audio + transcription**
  - `POST /api/audio/upload` (store chunk to GridFS; async Gemini STT; write `TranscriptChunk`)
  - `GET /api/audio/list?sessionId=...`
  - `GET /api/transcript?sessionId=...` (assemble transcript)
- **Transcript-grounded chat**
  - `POST /api/chat` (answers using transcript only; heuristic fallback when Gemini is not configured)

---

## Component Architecture (Implementation-Level)

```mermaid
flowchart LR
  Client["Browsers<br/>Speaker + Producer + Audience"] --> Signals["/api/signals<br/>SSE + POST"]
  Client --> Session["/api/session + /api/auth"]
  Client --> Audio["/api/audio/upload + /api/transcript"]
  Client --> Chat["/api/chat"]
  Client --> Intervene["/api/intervene"]

  Signals --> Mem[(In-memory state)]

  Session --> Mongo[(MongoDB)]
  Intervene --> Mongo
  Audio --> Mongo

  Audio --> GridFS[(GridFS audio)]
  Audio --> Gemini[Gemini STT]
  Chat --> Gemini
  Intervene --> Gemini
```

---

## Key Data Flows

### 1) Audience Signal → SSE Fanout → Speaker/Producer Updates

```mermaid
sequenceDiagram
  participant A as Audience (Phone)
  participant UI as Audience UI
  participant API as POST /api/signals
  participant Mem as In-memory state
  participant SSE as GET /api/signals?sse=1
  participant S as Speaker/Producer UI

  A->>UI: Tap 😕 / ✅ / 🔥 / 🐢 / ✋
  UI->>API: {sessionId, signalType, fingerprint}
  API->>API: Rate-limit per (sessionId,fingerprint)
  API->>Mem: Append signal + update counts
  API-->>SSE: enqueue event {type:"signal", signal}
  SSE-->>S: EventSource onmessage
  S-->>S: Update counts + visuals
```

### 2) Speaker Intervention Loop (Cooldown + Pending Ack)

```mermaid
flowchart TD
  Tick[Every 8s\nSpeaker View] --> Guards{Guards pass?}
  Guards -->|No| Stop[Do nothing]

  Guards -->|Yes| Call[POST /api/intervene\nsessionId, transcript, signals]
  Call --> Load[Mongo: load Session + last intervention]
  Load --> Checks{Cooldown + pending ack?}
  Checks -->|Block| Backoff[409/429 -> backoff]

  Checks -->|Allow| Reason[Gemini analyzeIntervention\nheuristic fallback]
  Reason --> Persist[Persist intervention to Mongo]
  Persist --> Broadcast[SSE broadcast event\ntype=intervention]
  Broadcast --> UI[Speaker shows whisper overlay]
```

### 3) Audio Upload → GridFS → Async Gemini STT → Transcript + Chat

```mermaid
sequenceDiagram
  participant Spk as Speaker Browser
  participant Rec as MediaRecorder (60s chunks)
  participant Up as POST /api/audio/upload
  participant FS as GridFS (audio)
  participant T as TranscriptChunk (Mongo)
  participant Gem as Gemini STT
  participant Tr as GET /api/transcript
  participant Chat as POST /api/chat

  Spk->>Rec: Start mic
  Rec->>Up: Upload chunk (multipart/form-data)
  Up->>FS: Store audio bytes
  Up->>T: Upsert TranscriptChunk{status: pending}
  par Async transcription
    Up->>Gem: Download bytes -> transcribe
    Gem-->>Up: Transcript text
    Up->>T: Update chunk status transcribed/failed
  end
  Spk->>Tr: Fetch assembled transcript
  Tr->>T: Read all transcribed chunks
  Tr-->>Spk: fullText + metadata
  Chat->>T: Load transcript text
  Chat->>Gem: Answer using transcript only
  Chat-->>Spk: Answer
```

---

## Data Model

### MongoDB (durable)

```mermaid
erDiagram
  USER {
    string _id
    string email
    string passwordHash
    string name
    date createdAt
  }

  SESSION {
    string _id
    string sessionId
    string speakerId
    string speakerName
    string topic
    boolean active
    date createdAt
    date endedAt
  }

  INTERVENTION {
    string _id
    string sessionId
    string message
    string urgency
    boolean acknowledged
    date createdAt
  }

  TRANSCRIPT_CHUNK {
    string _id
    string sessionId
    int chunkIndex
    long startTs
    long endTs
    string audioFileId
    string audioFilename
    string text
    int wordCount
    string status
    date createdAt
  }

  SESSION ||--o{ INTERVENTION : has
  SESSION ||--o{ TRANSCRIPT_CHUNK : has
```

### GridFS (durable blobs)

- `audio` bucket — uploaded MediaRecorder chunks.

---

## Deployment Architecture

```mermaid
graph LR
  Device[Browsers] --> Next[Next.js 16 App\nUI + API]
  Next --> Mongo[(MongoDB + GridFS)]
  Next --> Gemini[Gemini API]

  Next -. "WS (optional)" .-> STDB[(SpacetimeDB)]
```

---

## Known Gaps (docs vs repo)

Some older docs in this repo describe endpoints like `/api/poll`, `/api/mood`, `/api/clarify`, and a richer enforcement layer. Those are **not implemented** under `app/api/`.

This document intentionally describes only what’s currently implemented.

---

## Not Currently Used (present in repo)

The codebase includes a few pieces that exist but are not required for the core path above:

- **ElevenLabs TTS**: `/api/tts` and optional TTS logic in `/api/intervene` exist, but the current UI does not request TTS by default.
- **Live captions via Web Speech + SpacetimeDB**: client wiring exists, but it is not part of the server-side transcript source of truth (Gemini STT is).

---

## Optional / Planned (Design Intent)

Documented in `SUPERPLANE_INTEGRATION.md` and `Docs/Superplane.md` as likely next steps:

- Move in-memory SSE state (signals/questions) to a durable realtime store to support horizontal scaling.
- Add moderation and additional interaction types (polls, mood prompts) once corresponding routes exist.
- Add orchestration around AI calls (idempotency, retries, observability).
