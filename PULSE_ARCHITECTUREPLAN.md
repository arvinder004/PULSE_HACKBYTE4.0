# PULSE — Architecture Plan

Last updated: 2026-04-05

## Executive Summary

PULSE is a real-time, AI-assisted "room whisperer" for live talks.

- Audience members send lightweight feedback (signals + questions) from their phones.
- Speaker and producer dashboards receive near-real-time updates via **Server-Sent Events (SSE)**.
- The speaker streams mic audio to **Deepgram STT**; final captions are pushed to **SpacetimeDB** and a local buffer, and also broadcast via `/api/captions`.
- Every 60 seconds, the speaker posts a caption window to `/api/summary`; **Gemini** creates a `SegmentSummary` and triggers **Agent 2 (Suggester)** to persist a `Suggestion`.
- Interventions are generated via **Gemini** in `/api/intervene`, with optional **ElevenLabs TTS** for high urgency; outputs are persisted to MongoDB + GridFS.
- After the session ends, `/api/coach` compiles a **Gemini coaching report** from all segment summaries.

The current implementation is:

- **Next.js 16.2.2 (App Router)**: UI + API routes.
- **MongoDB (Mongoose)**: durable documents — sessions, interventions, segment summaries, coach reports, suggestions, users.
- **GridFS**: durable audio blobs (TTS output, optional uploaded chunks).
- **SSE + in-memory state**: real-time fanout for signals, captions, suggestions, and intervention events.
- **Gemini**: intervention reasoning, 60s segment summaries, transcript-grounded chat, coaching report compilation, Agent 2/3.
- **Deepgram**: realtime speech-to-text for live captions.
- **ElevenLabs**: TTS for high-urgency interventions (proxied via `/api/tts`).
- **SpacetimeDB (required for captions)**: realtime module + generated client bindings; stores caption rows and powers the 60s summary pipeline.
- **ArmorIQ (scaffold only)**: SDK helper present, not wired into requests by default.

Non-goals for this document: endpoints that do not exist under `app/api/`.

---

## System Context

```mermaid
graph LR
  Speaker[Speaker Browser] --> UI[Next.js UI]
  Producer[Producer Browser] --> UI
  Audience[Audience Browser] --> UI

  UI --> API[Next.js API Routes]

  API --> Auth["/api/auth/*"]
  API --> Sess["/api/session/*"]
  API --> SSE["/api/signals SSE stream"]
  API --> Captions["/api/captions"]
  API --> Questions["/api/questions"]
  API --> Suggest["/api/suggest"]
  API --> Intervene["/api/intervene"]
  API --> Summary["/api/summary"]
  API --> Transcript["/api/transcript"]
  API --> Coach["/api/coach"]
  API --> Chat["/api/chat"]
  API --> Audio["/api/audio/* optional"]
  API --> TTS["/api/tts"]
  API --> DGToken["/api/deepgram-token"]

  Auth --> Mongo[(MongoDB)]
  Sess --> Mongo
  Intervene --> Mongo
  Summary --> Mongo
  Coach --> Mongo
  Questions --> Mongo
  Suggest --> Mongo
  Audio --> Mongo

  Audio --> GFS[(GridFS: audio + tts buckets)]

  UI --> Deepgram[Deepgram STT]
  Summary --> Gemini[Gemini API]
  Intervene --> Gemini
  Suggest --> Gemini
  Chat --> Gemini
  Coach --> Gemini

  TTS --> ElevenLabs[ElevenLabs TTS]

  UI -. "WS (captions)" .-> STDB[(SpacetimeDB)]
```

### What's true in code today

- **Auth**: JWT stored in httpOnly cookie (`pulse_token`). Register/login/me/logout all implemented.
- **Captions**: Deepgram STT in the speaker client; final captions are pushed to SpacetimeDB, cached locally, and broadcast via `/api/captions` to SSE listeners. Every 60s, `/api/summary` persists a `SegmentSummary` and triggers Agent 2 (Suggester).
- **Signals**: in-memory per Next.js process; clients subscribe via SSE (`/api/signals?sse=1`). Signals expire after 45s and are persisted asynchronously into `Session.signals`.
- **Primary judge system**: one audience device can be designated "primary" via `?primary=1` or `/api/session/primary`. Primary-only counts are used for room state.
- **Questions**: in-memory with cosine-similarity dedupe, 30s cooldown, and PATCH upvotes; persisted into `Session.questions` with Agent 3 classification metadata.
- **Suggestions**: generated after each `/api/summary` call (Agent 2), stored in `Suggestion`, and broadcast via SSE. `/api/suggest` also supports run/list/dismiss with rate limiting.
- **Interventions**: persisted to `Session.interventions`. 90s server-side cooldown + pending-ack guard. Optional ElevenLabs TTS stored in GridFS `tts`.
- **Coach report**: compiled on demand via `/api/coach` from all `SegmentSummary` documents; cached in `CoachReport`.
- **Audio uploads**: `/api/audio/upload` stores chunks in GridFS `audio` and creates `TranscriptChunk` documents. No server-side transcription is wired.

---

## Project Modules (Repo-Level Architecture)

```mermaid
flowchart TB
  subgraph NextApp["Next.js App"]
    subgraph UI["UI Routes (app/*)"]
      LandingUI["Landing (app/page.tsx)\nLogin + Register + Create Session"]
      SpeakerUI["Speaker (app/speaker/[sessionId])\nAmbient circle + captions + coach report"]
      ProducerUI["Producer (app/producer/[sessionId])\nFull analytics + questions + tabs"]
      AudienceUI["Audience (app/audience/[sessionId])\nReact + Ask + Chat tabs"]
    end
    subgraph API["API Routes (app/api/*)"]
      AuthAPI["auth: register / login / me"]
      SessionAPI["session: create / get / start / end / archive / primary"]
      SignalsAPI["signals: POST + SSE GET + DELETE"]
      CaptionsAPI["captions: POST + GET (SSE broadcast)"]
      QuestionsAPI["questions: POST + GET + PATCH + DELETE"]
      SuggestAPI["suggest: POST + GET + PATCH"]
      SummaryAPI["summary: 60s caption batches + suggester"]
      TranscriptAPI["transcript: assemble from summaries"]
      AudioAPI["audio: upload / list (optional)"]
      InterveneAPI["intervene: POST + GET + ack"]
      CoachAPI["coach: POST compile + GET cached"]
      ChatAPI["chat: transcript-grounded Q&A"]
      TTSAPI["tts: ElevenLabs proxy"]
      DeepgramAPI["deepgram-token: temp token"]
    end
  end

  subgraph Lib["Server/Shared Libs (lib/*)"]
    DB["db.ts (Mongo + GridFS)"]
    Models["models/*\nSession, User, SegmentSummary,\nCoachReport, Suggestion,\nTranscriptChunk"]
    Agents["agents/*\nSuggester + Question Classifier"]
    GeminiLib["gemini.ts\nanalyzeIntervention\nsummarizeSegment\ncompileCoachReport"]
    ElevenLabsLib["elevenlabs.ts\nsynthesizeSpeech"]
    AuthLib["jwt.ts"]
    Fingerprint["fingerprint.ts"]
    SessionLib["session.ts (ID generation)"]
    Hooks["useSpeechTranscript.ts\nuseSpacetimeSession.ts\nuseTheme.ts"]
  end

  subgraph Data["Data Stores"]
    Mongo[(MongoDB)]
    GridFS[(GridFS: audio + tts)]
  end

  subgraph Realtime["Realtime (optional)"]
    STDB[(SpacetimeDB)]
    Bindings["src/module_bindings/*"]
  end

  subgraph External["External Services"]
    Gemini[Gemini API]
    Deepgram[Deepgram STT]
    ElevenLabs[ElevenLabs TTS]
  end

  UI --> API
  API --> Lib

  DB --> Mongo
  DB --> GridFS
  Models --> Mongo

  GeminiLib --> Gemini
  ElevenLabsLib --> ElevenLabs
  UI --> Deepgram

  UI -. "WS (optional)" .-> STDB
  Bindings -.-> UI
  Bindings -.-> API
```

---

## Implemented API Surface (Current)

- **Auth**
  - `POST /api/auth/register` — create account, set httpOnly JWT cookie
  - `POST /api/auth/login` — verify credentials, set httpOnly JWT cookie
  - `GET /api/auth/me` — return current user from cookie
  - `DELETE /api/auth/me` — logout (clear cookie)

- **Session lifecycle**
  - `POST /api/session` — create session (speakerName, topic → sessionId)
  - `GET /api/session?sessionId=...` — fetch session info
  - `POST /api/session/start` — mark session active
  - `POST /api/session/end` — mark session ended; `reactivate: true` restarts it
  - `GET /api/session/archive?sessionId=...` — fetch archived signals, questions, summaries, coach report
  - `GET /api/session/primary?sessionId=...` — get primary audienceId
  - `POST /api/session/primary` — set primary audienceId

- **Signals (SSE)**
  - `POST /api/signals` — submit signal (10s rate limit per fingerprint)
  - `GET /api/signals?sessionId=...&sse=1` — SSE stream (snapshot + signal + caption + suggestion + intervention events)
  - `GET /api/signals?sessionId=...` — raw signals array for client-side filtering
  - `DELETE /api/signals?sessionId=...` — clear all signals, broadcast empty snapshot

- **Captions (SSE broadcast)**
  - `POST /api/captions` — push a final caption chunk into the in-memory buffer and SSE broadcast
  - `GET /api/captions?sessionId=...` — return recent captions from memory

- **Questions (in-memory)**
  - `POST /api/questions` — submit question (30s cooldown, similarity dedupe)
  - `GET /api/questions?sessionId=...&primaryOnly=1` — list questions, optional primary filter
  - `PATCH /api/questions` — upvote by id
  - `DELETE /api/questions?id=...` — delete single question
  - `DELETE /api/questions?sessionId=...` — clear all questions for session

- **Suggestions (Agent 2)**
  - `POST /api/suggest` — run Suggester (rate limited, optional bearer token)
  - `GET /api/suggest?sessionId=...` — list suggestions
  - `PATCH /api/suggest` — dismiss a suggestion

- **Interventions**
  - `POST /api/intervene` — Gemini reasoning; 90s cooldown + pending-ack guard; optional ElevenLabs TTS; persists to MongoDB; SSE broadcast
  - `GET /api/intervene?sessionId=...` — last 10 interventions
  - `POST /api/intervene/ack` — acknowledge intervention (clears pending-ack guard)

- **Captions + summaries**
  - Deepgram streaming in speaker client → captions stored in SpacetimeDB + local buffer
  - `POST /api/summary` — summarize last 60s captions via Gemini → `SegmentSummary` in MongoDB + run Suggester
  - `GET /api/transcript?sessionId=...` — assemble full transcript from `SegmentSummary` documents

- **Coach report**
  - `POST /api/coach` — compile all `SegmentSummary` batches into `CoachReport` via Gemini; cached after first compile
  - `GET /api/coach?sessionId=...` — return cached `CoachReport` if exists

- **Transcript-grounded chat**
  - `POST /api/chat` — answers using `SegmentSummary` transcript only; heuristic fallback; 5s per-user cooldown

- **TTS**
  - `POST /api/tts` — ElevenLabs proxy with in-memory LRU cache (20 entries)

- **Audio (optional)**
  - `POST /api/audio/upload` — store MediaRecorder chunk in GridFS + create `TranscriptChunk`
  - `GET /api/audio/list?sessionId=...` — list uploaded chunks

- **Deepgram token**
  - `GET /api/deepgram-token` — short-lived Deepgram token (optional)

---

## Component Architecture

```mermaid
flowchart LR
  Client["Browsers\nSpeaker + Producer + Audience"] --> Signals["/api/signals\nSSE + POST + DELETE"]
  Client --> Captions["/api/captions\nPOST + GET"]
  Client --> Session["/api/session + /api/auth"]
  Client --> Summary["/api/summary + /api/transcript"]
  Client --> Suggest["/api/suggest"]
  Client --> Audio["/api/audio/upload (optional)"]
  Client --> Chat["/api/chat"]
  Client --> Intervene["/api/intervene + /ack"]
  Client --> Coach["/api/coach"]
  Client --> Questions["/api/questions"]
  Client --> TTS["/api/tts"]
  Client -. "WS" .-> Deepgram[Deepgram STT]

  Signals --> Mem[(In-memory signals\n+ SSE clients map)]
  Captions --> CapMem[(In-memory captions)]
  Questions --> QMem[(In-memory questions)]

  Session --> Mongo[(MongoDB)]
  Intervene --> Mongo
  Summary --> Mongo
  Coach --> Mongo
  Suggest --> Mongo
  Audio --> Mongo

  Audio --> GridFS[(GridFS audio + tts)]
  Summary --> Gemini
  Chat --> Gemini
  Intervene --> Gemini
  Coach --> Gemini
  Intervene --> ElevenLabs[ElevenLabs TTS]
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
  UI->>API: {sessionId, signalType, audienceId, fingerprint}
  API->>API: Rate-limit per (sessionId, fingerprint) — 10s
  API->>API: Check primary judge — isPrimary flag
  API->>Mem: Append signal (with TTL=45s)
  API-->>SSE: broadcast {type:"signal", signal}
  Note over API: Async persist to Session.signals in MongoDB
  SSE-->>S: EventSource onmessage
  S-->>S: Update counts + ambient circle + floating reactions
  Note over API,SSE: After 45s: broadcast snapshot with fresh counts
```

### 2) Speaker Intervention Loop

```mermaid
flowchart TD
  Tick[Every 8s\nSpeaker View] --> Guards{Local guards pass?}
  Guards -->|AI paused / cooldown / msg visible| Stop[Do nothing]

  Guards -->|Pass| RoomCheck{roomState != good?}
  RoomCheck -->|good| Stop

  RoomCheck -->|check/confused/fast/slow| Call[POST /api/intervene\nsessionId + transcript + signals]
  Call --> Load[Mongo: load Session]
  Load --> ServerChecks{Server: cooldown 90s\n+ pending ack?}
  ServerChecks -->|429 cooldown| Backoff[Set local cooldown\nfrom retryAfter]
  ServerChecks -->|409 pending ack| Backoff2[Back off 15s]

  ServerChecks -->|Allow| Reason[Gemini analyzeIntervention\nheuristic fallback if no key]
  Reason --> Persist[Persist to session.interventions\nin MongoDB]
  Persist --> Broadcast[SSE broadcast\ntype=intervention]
  Broadcast --> Card[InterventionCard overlay\n+ whisper text in ambient view]
  Card --> Ack[Speaker dismisses → POST /api/intervene/ack]
```

### 3) Deepgram Live Captions → SpacetimeDB → 60s Summary → Coach Report

```mermaid
sequenceDiagram
  participant Spk as Speaker Browser
  participant DG as Deepgram STT
  participant ST as SpacetimeDB (captions)
  participant Buf as Local Rolling Buffer
  participant Cap as POST /api/captions
  participant Sum as POST /api/summary
  participant Seg as SegmentSummary (Mongo)
  participant Sug as Suggestion (Mongo)
  participant Gem as Gemini
  participant Coach as POST /api/coach
  participant CR as CoachReport (Mongo)

  Spk->>DG: Stream mic audio (WebSocket)
  DG-->>Spk: Live transcripts (interim + final)
  Spk->>ST: submitCaption (final chunks)
  Spk->>Buf: Append to localCaptions ref
  Spk->>Cap: Broadcast caption to SSE
  loop every 60s
    Spk->>Sum: windowStart + windowEnd + transcript (from localCaptions)
    Sum->>Gem: summarizeSegment
    Gem-->>Sum: {summary, improvement, focusTags}
    Sum->>Seg: Upsert SegmentSummary
    Sum->>Gem: runSuggester
    Gem-->>Sum: suggestion
    Sum->>Sug: Insert Suggestion
  end
  Note over Spk: Session ends
  Spk->>Sum: Flush remaining captions
  Spk->>Coach: POST {sessionId}
  Coach->>Seg: Load all SegmentSummary docs
  Coach->>Gem: compileCoachReport (all batches)
  Gem-->>Coach: {segments, overallSummary, topStrengths, topImprovements}
  Coach->>CR: Upsert CoachReport
  Coach-->>Spk: Return report
  Spk-->>Spk: Render SessionReport component
```

### 4) Audience Chat (Transcript-Grounded)

```mermaid
sequenceDiagram
  participant A as Audience Browser
  participant Chat as POST /api/chat
  participant Seg as SegmentSummary (Mongo)
  participant Gem as Gemini

  A->>Chat: {sessionId, question, audienceId}
  Chat->>Chat: 5s per-user cooldown check
  Chat->>Seg: Load all SegmentSummary for session
  Chat->>Chat: Assemble fullText from transcripts
  alt fullText >= 30 chars
    Chat->>Gem: Answer using transcript only
    Gem-->>Chat: answer
  else
    Chat-->>A: "Not enough context yet"
  end
  Chat-->>A: {answer, grounded, transcriptAge, wordCount}
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
    string primaryAudienceId
    date createdAt
    date endedAt
    IIntervention[] interventions
    ISignal[] signals
    IQuestion[] questions
  }

  SEGMENT_SUMMARY {
    string _id
    string sessionId
    number windowStart
    number windowEnd
    string transcript
    string summary
    string improvement
    string[] focusTags
    number wordCount
    date createdAt
  }

  COACH_REPORT {
    string _id
    string sessionId
    string speakerName
    string topic
    ICoachSegment[] segments
    string overallSummary
    string[] topStrengths
    string[] topImprovements
    date createdAt
  }

  SUGGESTION {
    string _id
    string sessionId
    string message
    string detail
    string urgency
    string category
    boolean dismissed
    date createdAt
  }

  TRANSCRIPT_CHUNK {
    string _id
    string sessionId
    number chunkIndex
    number startTs
    number endTs
    string audioFileId
    string audioFilename
    string status
    date createdAt
  }

  SESSION ||--o{ SEGMENT_SUMMARY : has
  SESSION ||--o| COACH_REPORT : has
  SESSION ||--o{ SUGGESTION : has
  SESSION ||--o{ TRANSCRIPT_CHUNK : has
```

### In-Memory (ephemeral, per process)

| Store | Key | Value | Notes |
|---|---|---|---|
| `__pulse_signals` | global array | `Signal[]` | TTL 45s, cleared on DELETE |
| `__pulse_sig_cooldowns` | `sessionId:fingerprint` | last signal timestamp | 10s cooldown |
| `__pulse_sse_clients` | `sessionId` | `Set<ReadableStreamDefaultController>` | SSE fanout |
| `__pulse_captions` | `sessionId` | `CaptionEntry[]` | last 100 captions per session |
| `__pulse_primary` | `sessionId` | `primaryAudienceId` | cached from DB |
| `__pulse_questions` | question id | `Question` | no TTL |
| `__suggest_rl` | `sessionId` | rate limit window | /api/suggest rate limiting |
| `__pulse_tts_cache` | `voiceId:text` | `Buffer` | LRU, max 20 |

### GridFS (durable blobs)

- `audio` bucket — uploaded MediaRecorder chunks (optional).
- `tts` bucket — ElevenLabs TTS output for high-urgency interventions.

---

## UI Views

### Speaker View (`/speaker/[sessionId]`)

Single ambient circle indicator — the speaker's only job is to present.

```
┌─────────────────────────────────────────────────────┐
│ PULSE  Speaker  [mic picker]  [Transcript live ●]   │
│        [0 signals] [AI On] [Mic On] [CC On] [End]   │
├─────────────────────────────────────────────────────┤
│                                                     │
│              [ Start Session ]                      │
│                                                     │
│         ┌─────────────────────┐                     │
│         │   You're good       │  ← ambient circle   │
│         └─────────────────────┘                     │
│              Room is with you                       │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ Live captions          [Expand]              │   │
│  │ Listening…                                   │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  😕 2 Confused 40%   🐢 1 Too fast 20%             │
│                    [Clear signals]                  │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ AI whisper overlay (auto-dismiss 8s)         │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  /audience/{sessionId}  ← join URL                  │
└─────────────────────────────────────────────────────┘
```

On session end: spinner → `SessionReport` (coach report) renders inline.

### Producer View (`/producer/[sessionId]`)

Full analytics for a co-presenter or backstage operator.

```
┌──────────────────────────────────────────────────────────────┐
│ PULSE  Producer  [0 signals]  [Switch to Speaker]  [Dark]    │
├──────────────┬───────────────────────────────────────────────┤
│ Room Pulse   │  Presenting: {topic}                          │
│ [visualizer] │  {speakerName}                                │
│              │                                               │
│ Join         │  Pace: Too slow ──●────────── Too fast        │
│ [QR box]     │                                               │
│ /audience/…  │  Engagement: [static bar chart]               │
│              │                                               │
│ Captions     ├───────────────────────────────────────────────┤
│ {latest}     │  [AI] [Questions] [Poll]                      │
│              │                                               │
│ Audio Chunks │  Questions tab: Q list with                    │
│ {filenames}  │  category + urgency metadata                  │
│              │                                               │
│ Mood         │                                               │
│ No data yet  ├───────────────────────────────────────────────┤
│              │  Totals: Confused Clear Question Excited Slow │
└──────────────┴───────────────────────────────────────────────┘
```

### Audience View (`/audience/[sessionId]`)

Mobile-first, 3 tabs.

```
┌──────────────────────────┐
│ Audience                 │
│ {topic}                  │
│ with {speakerName}        │
│ [★ Primary judge]        │
├──────────────────────────┤
│ [React] [Ask] [Chat]     │
├──────────────────────────┤
│ React tab:               │
│  😕 Confused  ✅ Clear   │
│  🔥 Excited  🐢 Slow     │
│  ✋ Question             │
│  [10s cooldown]          │
│                          │
│ Ask tab:                 │
│  [textarea 200 chars]    │
│  [Submit question]       │
│  [30s cooldown]          │
│                          │
│ Chat tab:                │
│  [AI chat bubbles]       │
│  [Ask something…] [Send] │
└──────────────────────────┘
```

---

## Deployment Architecture

```mermaid
graph LR
  Device[Browsers] --> Next[Next.js 16.2.2 App\nUI + API]
  Next --> Mongo[(MongoDB + GridFS)]
  Next --> Gemini[Gemini API]
  Next --> ElevenLabs[ElevenLabs TTS]
  Next -. "WS (captions)" .-> STDB[(SpacetimeDB)]
  Next -. "WS" .-> Deepgram[Deepgram STT]
```

---

## Known Gaps (not yet implemented)

- `/api/poll` and `/api/mood` — not implemented; Spacetime reducers exist but no Next.js routes/UI wiring.
- Horizontal scaling — in-memory SSE state and signals are per-process; not suitable for multi-instance deployment.

---

## Not Currently Used (present in repo)

- **Audio chunk uploads**: `/api/audio/upload` and `/api/audio/list` exist; audio is stored in GridFS and `TranscriptChunk` is created, but no server-side transcription is wired.
- **Gemini STT helper**: `lib/gemini-transcribe.ts` exists but is not called from API routes.
- **SpacetimeDB as primary state**: SpacetimeDB is used for caption storage; signals and questions use in-memory state + SSE.
