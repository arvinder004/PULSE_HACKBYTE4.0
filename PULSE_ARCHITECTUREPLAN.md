## Executive Summary

PULSE is a real-time, AI-augmented "room whisperer" that helps speakers monitor audience engagement and receive just-in-time coaching during live sessions. The system combines a Next.js 15 web application, SpacetimeDB for low-latency state synchronization, AI services (Gemini and ElevenLabs), and ArmorIQ — a custom 6-policy enforcement layer that gates every AI-generated intervention before it reaches the speaker.

The architecture is cloud-native, event-driven, and optimized for real-time collaboration: speakers and audiences connect via web clients, all shared state lives in SpacetimeDB, AI services are orchestrated via stateless server-side APIs, and every proposed intervention passes through the ArmorIQ policy engine before execution.

---

## System Context

### System Context Diagram

```mermaid
graph LR
    subgraph Users
        Speaker[Speaker]
        Audience[Audience Members]
        Judge[Judge / Demo Viewer]
    end

    subgraph WebApp
        UI["App Router UI<br/>(React/TypeScript)"]
        API["Server APIs<br/>(REST / SSE / Edge)"]
    end

    subgraph DataPlane
        STDB["SpacetimeDB Module<br/>(tables + reducers)"]
    end

    subgraph AIServices
        Gemini["Gemini API<br/>(Reasoning, Moderation, Clarify)"]
        Eleven["ElevenLabs API<br/>(TTS)"]
    end

    subgraph EnforcementLayer
        ArmorIQ["ArmorIQ<br/>(6-Policy Engine)"]
    end

    Speaker --> UI
    Audience --> UI
    Judge --> UI

    UI --> API
    API <--> STDB

    API --> Gemini
    API --> ArmorIQ
    ArmorIQ --> Eleven
    ArmorIQ --> STDB
```

### Explanation

- **External actors**
  - Speaker: creates sessions, views interventions, engagement metrics, polls, questions, and AI coaching.
  - Audience members: join via QR code, send signals (mood, questions, polls, example requests).
  - Judge: participates as audience; same UI.

- **Core system**
  - Next.js 15 app (App Router) serves UI and all server APIs.
  - SpacetimeDB hosts all shared, real-time state via WebSocket subscriptions.
  - Gemini API handles reasoning, intervention generation, content moderation, and clarifying question generation.
  - ElevenLabs API synthesizes voice for interventions.
  - ArmorIQ sits between Gemini output and execution — every proposed intervention is evaluated against 6 policies before being delivered.

- **Interactions**
  - Users interact via browser → Next.js UI → APIs.
  - APIs read/write state through SpacetimeDB reducers.
  - Gemini output flows through ArmorIQ before any action is taken.
  - SpacetimeDB pushes live updates to connected clients via WebSockets.
  - SSE streams (`/api/signals`, `/api/questions`, `/api/poll`, `/api/mood`, `/api/interventions/stream`) broadcast real-time events to clients that can't use WebSockets directly.

### NFR Coverage

- **Scalability**: Stateless APIs; SpacetimeDB cluster; AI services scale independently.
- **Performance**: WebSocket-based SpacetimeDB updates; SSE for lightweight broadcast; minimal server-side logic in hot paths.
- **Security**: Sessions scoped by opaque IDs; environment secrets for AI APIs; ArmorIQ blocks policy-violating interventions; device fingerprinting for abuse prevention.
- **Reliability**: Centralized state in SpacetimeDB; stateless Next.js layers; graceful degradation if AI is down; ArmorIQ in-memory fallback for audit log.
- **Maintainability**: Clear separation between UI, APIs, SpacetimeDB module, AI orchestration, and enforcement layer.

---

## Architecture Overview

PULSE follows a **hub-and-spokes** architecture with an enforcement gate:

- Next.js 15 app is the interaction hub.
- SpacetimeDB acts as the real-time data backbone.
- AI services (Gemini, ElevenLabs) are downstream "spokes" invoked via well-defined server APIs.
- ArmorIQ enforcement layer intercepts all AI-proposed interventions before execution.
- Clients are thin: they subscribe to state (via SpacetimeProvider + useSpacetimeSession) and render views.

Key patterns:

- **Event-driven**: Audience actions → signals written into SpacetimeDB → AI processors react and generate interventions → ArmorIQ evaluates → executor dispatches.
- **CQRS-style separation**: Reducers for writes; subscriptions/hooks for reads.
- **Policy-gated execution**: No AI output reaches the speaker or SpacetimeDB without passing ArmorIQ's 6-policy evaluation.
- **SSE for lightweight broadcast**: Signals, questions, polls, mood, and intervention streams use Server-Sent Events for clients that don't need full WebSocket state.

---

## Component Architecture

### Component Diagram

```mermaid
graph TD
    subgraph Client
        Landing["Landing Page<br/>(app/page.tsx)"]
        SpeakerUI["Speaker Dashboard<br/>(app/speaker/[sessionId])"]
        AudienceUI["Audience View<br/>(app/audience/[sessionId])"]
        SpacetimeProv["SpacetimeProvider"]
        SessionHook["useSpacetimeSession"]

        subgraph SpeakerComponents
            PulseViz["PulseVisualizer"]
            InterventionCard["InterventionCard"]
            PolicyLog["PolicyLog"]
            QuestionQueue["QuestionQueue"]
            PollCreator["PollCreator"]
            ClarifyQ["ClarifyingQuestions"]
            MoodCloud["MoodWordCloud"]
            PaceMeter["PaceMeter"]
            EngTimeline["EngagementTimeline"]
            ExampleCounter["ExampleCounter"]
            VoicePlayer["VoicePlayer"]
            QRCode["QR Code"]
        end

        subgraph AudienceComponents
            SignalButtons["SignalButtons"]
            FloatingReactions["FloatingReactions"]
            QuestionInput["QuestionInput"]
            AudiencePoll["AudiencePoll"]
            AudienceClarify["AudienceClarify"]
            MoodPrompt["MoodPrompt"]
            ExampleButton["ExampleButton"]
        end
    end

    subgraph Server["Next.js API Routes"]
        SessionAPI["/api/session"]
        SignalAPI["/api/signals (SSE)"]
        InterveneAPI["/api/intervene"]
        TTSAPI["/api/tts"]
        EnforceAPI["/api/enforce"]
        QuestionsAPI["/api/questions (SSE)"]
        PollAPI["/api/poll (SSE)"]
        ClarifyAPI["/api/clarify (SSE)"]
        MoodAPI["/api/mood (SSE)"]
        InterventionStream["/api/interventions/stream (SSE)"]
    end

    subgraph Libs["Server Libs"]
        GeminiLib["lib/gemini.ts"]
        ElevenLib["lib/elevenlabs.ts"]
        ModerationLib["lib/moderation.ts"]
        FingerprintLib["lib/fingerprint.ts"]
        SpeechLib["lib/useSpeechTranscript.ts"]
    end

    subgraph Enforcement["ArmorIQ (lib/enforcement/)"]
        PolicyEngine["policy-engine.ts<br/>(6 policies, ALLOW/BLOCK/MODIFY)"]
        Executor["executor.ts<br/>(action dispatch)"]
        AuditLog["audit.ts<br/>(MongoDB + in-memory fallback)"]
        EnfTypes["types.ts"]
        DemoSeeds["demo-seeds.ts"]
    end

    subgraph Spacetime["SpacetimeDB Module"]
        Tables["Tables<br/>(session, signal, intervention,<br/>question, poll, mood_word, etc.)"]
        Reducers["Reducers<br/>(createSession, submitSignal,<br/>logIntervention, upvoteQuestion,<br/>votePoll, submitMood, etc.)"]
    end

    subgraph ExternalAI
        GeminiAPI["Gemini API"]
        ElevenAPI["ElevenLabs API"]
    end

    Landing --> SessionAPI
    SpeakerUI --> SessionAPI
    AudienceUI --> SessionAPI

    SpeakerUI --> SpacetimeProv
    AudienceUI --> SpacetimeProv
    SpacetimeProv --> SessionHook
    SessionHook <--> Tables

    AudienceUI --> SignalAPI
    AudienceUI --> QuestionsAPI
    AudienceUI --> PollAPI
    AudienceUI --> MoodAPI

    SpeakerUI --> InterveneAPI
    SpeakerUI --> EnforceAPI
    SpeakerUI --> ClarifyAPI

    InterveneAPI --> GeminiLib
    InterveneAPI --> PolicyEngine
    PolicyEngine --> Executor
    PolicyEngine --> AuditLog
    Executor --> Reducers
    Executor --> TTSAPI

    EnforceAPI --> PolicyEngine
    QuestionsAPI --> ModerationLib
    ModerationLib --> GeminiLib
    ClarifyAPI --> GeminiLib

    GeminiLib --> GeminiAPI
    ElevenLib --> ElevenAPI
    TTSAPI --> ElevenLib

    SessionAPI --> Reducers
    SignalAPI --> Reducers
```

### Component Responsibilities

- **Client — Speaker Components**
  - `PulseVisualizer`: Animated circle + per-signal-type bars driven by SpacetimeDB `onInsert` callbacks.
  - `InterventionCard`: Shows AI message, suggestion, urgency badge, acknowledge button.
  - `PolicyLog`: Live ArmorIQ enforcement decisions with ALLOW/BLOCK/MODIFY badges.
  - `QuestionQueue`: Audience questions sorted by upvotes; dismiss/answered actions.
  - `PollCreator`: Speaker creates polls; live bar chart results.
  - `ClarifyingQuestions`: 3 AI-generated questions; speaker picks one to broadcast.
  - `MoodWordCloud`: Live CSS/SVG word cloud from audience mood responses.
  - `PaceMeter`: slow_down vs excited ratio → pace indicator.
  - `EngagementTimeline`: Live SVG chart of sentiment over time.
  - `ExampleCounter`: Shows how many audience members need an example.
  - `VoicePlayer`: Plays ElevenLabs audio, fires `onDone` callback.
  - `QRCode`: Audience join URL via `react-qrcode-logo`.

- **Client — Audience Components**
  - `SignalButtons`: 5 emoji buttons (confused, clear, excited, slow_down, question).
  - `FloatingReactions`: Emoji reactions drift up the screen as signals arrive via SSE.
  - `QuestionInput`: Textarea with 200-char limit, cooldown UI, moderation feedback.
  - `AudiencePoll`: Full-screen overlay when a poll is active.
  - `AudienceClarify`: Banner when speaker broadcasts a clarifying question.
  - `MoodPrompt`: Overlay triggered 1.5s after an AI intervention.
  - `ExampleButton`: Tap "I need an example"; threshold of 3 fires AI immediately.

- **Server — API Routes**
  - `/api/session`: POST create / GET fetch session; delegates to `createSession` reducer.
  - `/api/signals`: POST signal submission + SSE broadcast to speaker; rate limiting (10s cooldown); outlier detection + variance tracking.
  - `/api/intervene`: Receives signals + live transcript → Gemini → ArmorIQ → executor.
  - `/api/tts`: Proxies text to ElevenLabs, returns audio.
  - `/api/enforce`: Standalone POST for ArmorIQ evaluation + execution; GET for audit log.
  - `/api/questions`: Submit (with Gemini moderation + rate limit), upvote, dismiss, answered, SSE stream.
  - `/api/poll`: Create, vote, close, SSE stream.
  - `/api/clarify`: Gemini generates 3 clarifying questions; broadcast chosen one via SSE.
  - `/api/mood`: Collect mood words; SSE stream to speaker.
  - `/api/interventions/stream`: SSE stream to audience phones for mood prompt trigger.

- **Server Libs**
  - `lib/gemini.ts`: `analyzeAndIntervene` — signal summary → Gemini → intervention result.
  - `lib/elevenlabs.ts`: TTS proxy.
  - `lib/moderation.ts`: Gemini content moderation for audience questions.
  - `lib/fingerprint.ts`: SHA-256 device fingerprinting for abuse prevention.
  - `lib/useSpeechTranscript.ts`: Buffers last 60s of speaker speech in memory.

- **ArmorIQ — Enforcement Layer**
  - `types.ts`: `ProposedIntervention`, `EnforcementDecision`, `SessionPolicyState`, `PolicyEvaluation`, `ExecutionResult`, `AuditLogEntry`.
  - `policy-engine.ts`: 6 pure policies, ALLOW / BLOCK / MODIFY outcomes.
  - `executor.ts`: Action dispatch map, gated behind `EnforcementDecision`.
  - `audit.ts`: MongoDB with in-memory fallback.
  - `demo-seeds.ts`: Pre-built ALLOW, BLOCK, MODIFY scenarios for demo.

- **SpacetimeDB Module**
  - **Tables**: `session`, `signal`, `intervention`, `question`, `question_upvote`, `poll`, `poll_vote`, `mood_word`, `rate_limit`.
  - **Reducers**: `createSession`, `submitSignal`, `logIntervention`, `acknowledgeIntervention`, `submitQuestion`, `upvoteQuestion`, `dismissQuestion`, `answerQuestion`, `submitMood`, `createPoll`, `votePoll`, `closePoll`, `endSession`.

---

## Deployment Architecture

### Deployment Diagram

```mermaid
graph LR
    subgraph UserDevices
        Browser
        MobilePhone["Mobile Phone<br/>(Audience / Judge)"]
    end

    subgraph Edge
        EdgeLB["Edge / CDN"]
    end

    subgraph AppTier
        NextRuntime["Next.js 15 Runtime<br/>(API Routes + SSR)"]
        StaticAssets["Static Assets"]
    end

    subgraph DataTier
        STDBCluster["SpacetimeDB Cluster<br/>(WebSocket)"]
        MongoDB["MongoDB<br/>(ArmorIQ Audit Log)"]
        Logs["Logs"]
    end

    subgraph AICloud
        GeminiSvc["Gemini API"]
        ElevenSvc["ElevenLabs API"]
    end

    Browser --> EdgeLB
    MobilePhone --> EdgeLB
    EdgeLB --> NextRuntime
    EdgeLB --> StaticAssets

    NextRuntime <-->|WebSocket| STDBCluster
    NextRuntime <-->|SSE| Browser
    NextRuntime <-->|SSE| MobilePhone
    NextRuntime --> GeminiSvc
    NextRuntime --> ElevenSvc
    NextRuntime --> MongoDB

    NextRuntime --> Logs
    STDBCluster --> Logs
```

### Explanation

- **Environments**: Dev and production share the same topology; differ in scale and credentials.
- **Network boundaries**:
  - Public internet → Edge/CDN → Next.js runtime (public zone).
  - Next.js runtime → SpacetimeDB (protected zone, WebSocket).
  - Next.js runtime → MongoDB (protected zone, ArmorIQ audit persistence).
  - Next.js runtime → AICloud (outbound-only HTTPS to external providers).
- **Mobile-first audience**: Audience and judges connect on phones via QR code; SSE streams deliver real-time updates without requiring a persistent WebSocket per client.

---

## Data Flow

### Data Flow Diagram — Session Creation & Participation

```mermaid
flowchart TD
  Speaker[Speaker Browser] -->|1. Open /| LandingPage["Landing Page (app/page.tsx)"]
  LandingPage -->|2. POST speakerName, topic| SessionAPI["/api/session POST"]
  SessionAPI -->|3. createSession reducer| STDB["SpacetimeDB: session table"]
  STDB -->|4. session row inserted| SessionAPI
  SessionAPI -->|5. Return sessionId| LandingPage
  LandingPage -->|6. Redirect /speaker/:sessionId| SpeakerUI["Speaker Dashboard"]
  SpeakerUI -->|7. Show QR code| QR["react-qrcode-logo"]

  Audience[Audience Browser] -->|8. Scan QR → /audience/:sessionId| AudienceUI["Audience View"]
  AudienceUI -->|9. Subscribe via SpacetimeProvider| STDB
  STDB -->|10. Push session + signals| AudienceUI
  STDB -->|11. Push updates| SpeakerUI
```

### Data Flow Diagram — Signal → ArmorIQ → Intervention

```mermaid
flowchart TD
  AudPhone[Audience Phone] -->|1. Tap signal button| SignalBtn["SignalButtons component"]
  SignalBtn -->|2. POST /api/signals| SignalAPI["/api/signals"]
  SignalAPI -->|3. Rate limit check | Ratecheck["10s cooldown, fingerprint"]
  RateCheck -->|No| Blocked["429 Too Many Requests"]
  RateCheck -->|Yes| STDB["SpacetimeDB: submitSignal reducer"]
  STDB -->|4. SSE broadcast| SpeakerUI["Speaker Dashboard"]
  STDB -->|5. FloatingReactions| AudienceUI["Audience View"]

  SpeakerUI -->|6. Every 8s + guards| InterveneAPI["/api/intervene"]
  InterveneAPI -->|7. Signal summary + transcript| Gemini["Gemini API"]
  Gemini -->|8. ProposedIntervention| ArmorIQ["ArmorIQ Policy Engine (6 policies)"]
  ArmorIQ -->|9. BLOCK| AuditLog["Audit Log (MongoDB)"]
  ArmorIQ -->|10. ALLOW/MODIFY| Executor["Executor"]
  Executor -->|11. logIntervention reducer| STDB2["SpacetimeDB: intervention table"]
  Executor -->|12. POST /api/tts| TTS["ElevenLabs TTS"]
  TTS -->|13. Audio| VoicePlayer["VoicePlayer component"]
  STDB2 -->|14. Live update| InterventionCard["InterventionCard on Speaker UI"]
```

---

## Key Workflows

### Sequence Diagram — Audience Signal → AI Intervention → Voice

```mermaid
sequenceDiagram
    participant Aud as Audience Phone
    participant AudUI as Audience View
    participant SigAPI as /api/signals
    participant STDB as SpacetimeDB
    participant SpkUI as Speaker Dashboard
    participant IntAPI as /api/intervene
    participant Gem as Gemini
    participant ArmorIQ as ArmorIQ Engine
    participant Exec as Executor
    participant TTS as /api/tts
    participant Eleven as ElevenLabs

    Aud->>AudUI: Tap 😕 Confused
    AudUI->>SigAPI: POST signal (sessionId, type, fingerprint)
    SigAPI->>SigAPI: Rate limit + outlier check
    SigAPI->>STDB: submitSignal reducer
    STDB-->>SpkUI: Realtime signal update (SSE + WebSocket)
    STDB-->>AudUI: FloatingReactions emoji

    Note over SpkUI: Every 8s — 4 guards checked
    SpkUI->>IntAPI: POST signals + live transcript
    IntAPI->>Gem: Prompt with context + signals + transcript
    Gem-->>IntAPI: ProposedIntervention (text, severity)
    IntAPI->>ArmorIQ: Evaluate against 6 policies
    ArmorIQ-->>IntAPI: EnforcementDecision (ALLOW/BLOCK/MODIFY)
    IntAPI->>ArmorIQ: Log to audit (MongoDB)

    alt ALLOW or MODIFY
        IntAPI->>Exec: Dispatch action
        Exec->>STDB: logIntervention reducer
        STDB-->>SpkUI: New InterventionCard (live)
        Exec->>TTS: POST text
        TTS->>Eleven: Synthesize speech
        Eleven-->>TTS: Audio
        TTS-->>SpkUI: VoicePlayer plays audio
    else BLOCK
        IntAPI-->>SpkUI: PolicyLog shows BLOCK + reason
    end
```

### Sequence Diagram — Poll Lifecycle

```mermaid
sequenceDiagram
    participant SpkUI as Speaker Dashboard
    participant PollAPI as /api/poll
    participant STDB as SpacetimeDB
    participant AudUI as Audience View

    SpkUI->>PollAPI: POST create poll (question, options)
    PollAPI->>STDB: createPoll reducer
    STDB-->>AudUI: SSE → AudiencePoll full-screen overlay
    AudUI->>PollAPI: POST vote (optionIndex, fingerprint)
    PollAPI->>STDB: votePoll reducer
    STDB-->>SpkUI: Live bar chart update
    SpkUI->>PollAPI: POST close poll
    PollAPI->>STDB: closePoll reducer
    STDB-->>AudUI: Overlay dismissed
```

### Sequence Diagram — Clarify Flow

```mermaid
sequenceDiagram
    participant SpkUI as Speaker Dashboard
    participant ClarAPI as /api/clarify
    participant Gem as Gemini
    participant STDB as SpacetimeDB
    participant AudUI as Audience View

    SpkUI->>ClarAPI: POST (topic, recent signals)
    ClarAPI->>Gem: Generate 3 clarifying questions
    Gem-->>ClarAPI: 3 questions
    ClarAPI-->>SpkUI: ClarifyingQuestions component
    SpkUI->>ClarAPI: POST broadcast chosen question
    ClarAPI->>STDB: SSE → AudienceClarify banner
    STDB-->>AudUI: Banner appears on all phones
```

---

## Additional Diagrams

### Domain Model (ERD) — SpacetimeDB Schema

```mermaid
erDiagram
    SESSION {
        string id
        string speaker_name
        string topic
        timestamp created_at
        boolean active
    }

    SIGNAL {
        string id
        string session_id
        string type
        json payload
        string audience_id
        timestamp created_at
    }

    INTERVENTION {
        string id
        string session_id
        string source
        string message
        string suggestion
        string severity
        boolean acknowledged
        timestamp created_at
    }

    QUESTION {
        string id
        string session_id
        string author
        string text
        string status
        int upvotes
        timestamp created_at
    }

    QUESTION_UPVOTE {
        string id
        string question_id
        string voter_fingerprint
        timestamp created_at
    }

    POLL {
        string id
        string session_id
        string question
        json options
        boolean open
        timestamp created_at
    }

    POLL_VOTE {
        string id
        string poll_id
        string voter_fingerprint
        int option_index
        timestamp created_at
    }

    MOOD_WORD {
        string id
        string session_id
        string word
        timestamp created_at
    }

    RATE_LIMIT {
        string key
        int count
        timestamp window_start
    }

    SESSION ||--o{ SIGNAL : has
    SESSION ||--o{ INTERVENTION : has
    SESSION ||--o{ QUESTION : has
    SESSION ||--o{ POLL : has
    SESSION ||--o{ MOOD_WORD : has

    QUESTION ||--o{ QUESTION_UPVOTE : has
    POLL ||--o{ POLL_VOTE : has
```

### ArmorIQ Policy Engine — Decision Flow

```mermaid
flowchart TD
    Gemini["Gemini Output (ProposedIntervention)"] --> PE["Policy Engine"]

    PE --> P1["P1: Cooldown<br/>(min interval between interventions)"]
    PE --> P2["P2: Voice Busy<br/>(audio already playing)"]
    PE --> P3["P3: Pending Ack<br/>(unacknowledged intervention exists)"]
    PE --> P4["P4: AI Paused<br/>(speaker toggled pause)"]
    PE --> P5["P5: Content Safety<br/>(message passes safety check)"]
    PE --> P6["P6: Severity Threshold<br/>(urgency meets minimum bar)"]

    P1 & P2 & P3 & P4 & P5 & P6 --> Decision{All pass?}

    Decision -->|All ALLOW| Exec["Executor → logIntervention + TTS"]
    Decision -->|Any BLOCK| Block["BLOCK → Audit Log only"]
    Decision -->|MODIFY| Modify["MODIFY<br/>→ Adjusted intervention<br/>→ Executor"]

    Exec --> Audit["Audit Log<br/>(MongoDB / in-memory)"]
    Block --> Audit
    Modify --> Audit
```

---

## Phased Development

### Phase 0 — Scaffolding (Complete)
- Next.js 15 + TypeScript + Tailwind CSS v4.
- SpacetimeDB module: all tables and reducers defined.
- `SpacetimeProvider` and `useSpacetimeSession` hook.
- `.env.local` structure with all required keys.

### Phase 1 — Session Management (Complete)
- `lib/session.ts`: 12-character session ID generation.
- `/api/session`: POST create / GET fetch.
- Landing page, audience shell, speaker shell.
- Basic session lifecycle: create, join by URL, display header.

### Phase 2 — Real-Time Signals
- `SignalButtons`, `FloatingReactions`, `PulseVisualizer` components.
- `/api/signals` with SSE broadcast, rate limiting (10s cooldown), outlier detection.
- `lib/fingerprint.ts` for device-based abuse prevention.
- Wire audience → `submitSignal` reducer → speaker dashboard.

### Phase 3 — AI Intervention Engine
- `lib/gemini.ts`, `lib/elevenlabs.ts`, `lib/useSpeechTranscript.ts`.
- `/api/intervene`, `/api/tts`.
- `VoicePlayer`, `InterventionCard` components.
- Periodic intervention check (every 8s) with 4 guards.
- AI pause toggle + mic toggle on speaker header.

### Phase 4 — ArmorIQ Enforcement Layer
- `lib/enforcement/types.ts`, `policy-engine.ts`, `executor.ts`, `audit.ts`, `demo-seeds.ts`.
- `/api/enforce` route.
- `PolicyLog` component + 🛡️ Policy tab on speaker dashboard.
- Wire enforcement into `/api/intervene` pipeline.

### Phase 5 — Questions & Moderation
- `lib/moderation.ts` (Gemini content moderation).
- `/api/questions` with SSE, moderation, rate limiting.
- `QuestionInput`, `QuestionQueue` components.
- Wire upvoting to `upvoteQuestion` reducer.

### Phase 6 — Polls, Clarify, Mood
- `/api/poll`, `/api/clarify`, `/api/mood` routes with SSE.
- `PollCreator`, `AudiencePoll`, `ClarifyingQuestions`, `AudienceClarify`, `MoodPrompt`, `MoodWordCloud` components.

### Phase 7 — Engagement Metrics & UX Polish
- `PaceMeter`, `EngagementTimeline`, `ExampleButton`, `ExampleCounter` components.
- `/api/interventions/stream` SSE route.
- QR code on speaker dashboard.
- Audience page tabs (React / Ask), cooldown countdown, error states.
- Speaker dashboard tab badges, auto-switch on first question, signal totals grid.

### Phase 8 — Demo Seeds & Hardening
- Demo seed data for ArmorIQ (ALLOW, BLOCK, MODIFY scenarios).
- Tune intervention thresholds for small audiences (3–5 judges): `uniqueContributors >= 2`, `confusionRate >= 40%`.
- ElevenLabs volume/latency verification.
- SpacetimeDB WebSocket stability on mobile hotspot.
- Final cleanup: remove console.logs, verify TypeScript, document all env vars.

---

## Non-Functional Requirements Analysis

### Scalability
- Stateless Next.js APIs; horizontal scaling via containers/serverless.
- SpacetimeDB designed for real-time, multi-client scenarios.
- AI calls rate-limited and batched; ArmorIQ is pure/stateless per evaluation.

### Performance
- WebSockets minimize polling; only deltas propagate to clients.
- SSE for lightweight one-way broadcast (signals, questions, polls, mood).
- Reducers keep business logic close to data, reducing round-trips.
- CDN and static asset optimization for fast initial load.

### Security
- Environment variables for all secrets; no keys in client bundle.
- Opaque session IDs; device fingerprinting for rate limiting.
- ArmorIQ blocks policy-violating interventions before execution.
- Future-ready for JWT/OAuth around moderator/speaker roles.

### Reliability
- Single source of truth in SpacetimeDB.
- Stateless app tier; straightforward blue/green deployments.
- AI failures degrade gracefully; ArmorIQ has in-memory fallback for audit log.
- 4 guards on intervention check prevent runaway AI calls.

### Maintainability
- Clear module boundaries: UI / API routes / server libs / SpacetimeDB module / ArmorIQ.
- Strong domain schema in SpacetimeDB maps to business language.
- App Router route structure aligns with business screens (speaker, audience).
- ArmorIQ policies are pure functions — easy to test and extend.

---

## Risks and Mitigations

- **AI dependency risk**: Gemini or ElevenLabs outages.
  - Mitigation: Fallback to text-only interventions; circuit breakers; AI pause toggle.
- **ArmorIQ over-blocking**: Policies too aggressive for small demo audiences.
  - Mitigation: Tune thresholds for 3–5 judges; demo seeds bypass real signal requirements.
- **Real-time complexity**: Race conditions or state drift across WebSocket + SSE channels.
  - Mitigation: Centralize all writes in reducers; strict typing; replay tools.
- **Cost risks**: Gemini + ElevenLabs usage can spike.
  - Mitigation: Rate limiting; 8s intervention interval; cooldown guards in ArmorIQ.
- **Mobile network instability**: Judges on hotspot may drop WebSocket.
  - Mitigation: SpacetimeDB reconnect logic; SSE as fallback for audience-side updates.

---

## Technology Stack

- **Frontend**: Next.js 15 (App Router), React 19, Tailwind CSS v4, `react-qrcode-logo`, Web Speech API.
- **Real-Time**: SpacetimeDB (`@clockworklabs/spacetimedb-sdk`), Server-Sent Events.
- **AI**: Gemini API (reasoning, moderation, clarify), ElevenLabs API (TTS).
- **Enforcement**: ArmorIQ — custom policy engine (`lib/enforcement/`), MongoDB + in-memory audit log.
- **Utilities**: SHA-256 device fingerprinting, 60s rolling speech transcript buffer.
