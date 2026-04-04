# PULSE — Architecture Plan (Updated)

Last updated: 2026-04-04

## Executive Summary

PULSE is a real-time, AI-assisted “room whisperer” for live talks.

- Audience members send lightweight feedback (signals + questions) from their phones.
- Speaker and producer dashboards receive near-real-time updates via **Server-Sent Events (SSE)**.
- The system streams microphone audio to **Deepgram STT**, stores live captions in **SpacetimeDB**, and rolls up a **60s caption summary** into MongoDB.
- Interventions are generated via **Gemini reasoning** when confusion/pacing signals cross simple thresholds.

The current implementation is:

- **Next.js 16 (App Router)**: UI + API routes.
- **MongoDB (Mongoose)**: durable documents (sessions, interventions, transcript chunks, users).
- **GridFS**: durable audio blobs (uploaded chunks).
- **SSE + in-memory state**: real-time fanout for signals and intervention events.
- **Gemini**: intervention reasoning + 60s segment summaries.
- **Deepgram**: realtime speech-to-text for live captions.
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
  API --> Summary[/api/summary/]
  API --> Transcript[/api/transcript/]
  API --> Audio["/api/audio/* (optional)"]
  API --> Chat[/api/chat/]
  API --> Intervene[/api/intervene/]

  Sess --> Mongo[(MongoDB)]
  Intervene --> Mongo
  Summary --> Mongo
  Audio --> Mongo

  Audio --> GFS[(GridFS: audio bucket)]

  UI --> Deepgram[Deepgram STT]
  Chat --> Gemini
  Intervene --> Gemini

  UI -. "WS (optional)" .-> STDB[(SpacetimeDB)]
```

### What’s true in code today

- **Transcript source of truth** is client-side Deepgram captions stored in SpacetimeDB. Every 60 seconds, captions are summarized via `/api/summary` and persisted to MongoDB.
- **Signals source of truth** is in-memory per Next.js process; clients subscribe via SSE (`/api/signals?sse=1`).

### SpacetimeDB (present in the repo)

SpacetimeDB is present as a separate module and client wiring:

- Module package: `spacetime/`
- Generated client bindings: `src/module_bindings/`
- Client integration points: `components/SpacetimeProvider.tsx` and `lib/useSpacetimeSession.ts`

It now powers live captions storage and the 60s summary pipeline, so summaries depend on it.

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
      SummaryAPI["summary (60s captions)"]
      TranscriptAPI["transcript"]
      AudioAPI["audio upload/list (optional)"]
      InterveneAPI["intervene"]
      ChatAPI["chat"]
    end
  end

  subgraph Lib["Server/Shared Libs (lib/*)"]
    DB["db.ts (Mongo + GridFS)"]
    Models["models/* (Mongoose)"]
    GeminiLib["gemini.ts (reasoning + summaries)"]
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
    Deepgram[Deepgram STT]
  end

  UI --> API
  API --> Lib

  DB --> Mongo
  DB --> GridFS
  Models --> Mongo

  GeminiLib --> Gemini
  UI --> Deepgram

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
- **Captions + summaries**
  - Deepgram streaming in the speaker client → captions stored in SpacetimeDB
  - `POST /api/summary` (summarize last 60s captions → `SegmentSummary` in Mongo)
  - `GET /api/transcript?sessionId=...` (assemble transcript from summaries)
  - `POST /api/audio/upload` (optional audio storage)
  - `GET /api/audio/list?sessionId=...`
- **Transcript-grounded chat**
  - `POST /api/chat` (answers using transcript summaries only; heuristic fallback when Gemini is not configured)

---

## Component Architecture (Implementation-Level)

```mermaid
flowchart LR
  Client["Browsers<br/>Speaker + Producer + Audience"] --> Signals["/api/signals<br/>SSE + POST"]
  Client --> Session["/api/session + /api/auth"]
  Client --> Summary["/api/summary + /api/transcript"]
  Client --> Audio["/api/audio/upload (optional)"]
  Client --> Chat["/api/chat"]
  Client --> Intervene["/api/intervene"]
  Client -. "WS" .-> Deepgram[Deepgram STT]

  Signals --> Mem[(In-memory state)]

  Session --> Mongo[(MongoDB)]
  Intervene --> Mongo
  Summary --> Mongo
  Audio --> Mongo

  Audio --> GridFS[(GridFS audio)]
  Summary --> Gemini
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

### 3) Deepgram Live Captions → SpacetimeDB → 60s Summary → Transcript + Chat

```mermaid
sequenceDiagram
  participant Spk as Speaker Browser
  participant DG as Deepgram STT
  participant ST as SpacetimeDB (captions)
  participant Sum as POST /api/summary
  participant Seg as SegmentSummary (Mongo)
  participant Gem as Gemini
  participant Tr as GET /api/transcript
  participant Chat as POST /api/chat

  Spk->>DG: Stream mic audio (WebSocket)
  DG-->>Spk: Live transcripts (interim + final)
  Spk->>ST: submit_caption (final chunks)
  loop every 60s
    Spk->>Sum: windowStart + windowEnd + transcript
    Sum->>Gem: summarizeSegment
    Gem-->>Sum: summary JSON
    Sum->>Seg: Upsert SegmentSummary
  end
  Spk->>Tr: Fetch assembled transcript
  Tr->>Seg: Read summaries
  Tr-->>Spk: fullText + metadata
  Chat->>Seg: Load transcript text
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

  SEGMENT_SUMMARY {
    string _id
    string sessionId
    long windowStart
    long windowEnd
    string transcript
    string summary
    string improvement
    string[] focusTags
    int wordCount
    date createdAt
  }

  SESSION ||--o{ INTERVENTION : has
  SESSION ||--o{ SEGMENT_SUMMARY : has
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
- **Audio chunk uploads**: still available for archival, but transcription is now driven by Deepgram live captions.

---

## Optional / Planned (Design Intent)

Documented in `SUPERPLANE_INTEGRATION.md` and `Docs/Superplane.md` as likely next steps:

- Move in-memory SSE state (signals/questions) to a durable realtime store to support horizontal scaling.
- Add moderation and additional interaction types (polls, mood prompts) once corresponding routes exist.
- Add orchestration around AI calls (idempotency, retries, observability).
