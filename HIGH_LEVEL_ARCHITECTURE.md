# High-Level Architecture

This diagram summarizes the primary runtime components and external dependencies for PULSE.

```mermaid
flowchart TB
  subgraph Clients
    Audience["Audience (mobile)"]
    Speaker["Speaker (dashboard)"]
    Producer["Producer (dashboard)"]
  end

  subgraph App["Next.js App"]
    UI["UI (App Router)"]
    API["API Routes"]
    SSE["SSE streams"]
  end

  subgraph Data["Data Stores"]
    Mongo["MongoDB + GridFS"]
    Memory["In-memory state"]
    STDB["SpacetimeDB (captions)"]
  end

  subgraph External["External Services"]
    Deepgram["Deepgram STT"]
    Gemini["Gemini API"]
  end

  Audience --> UI
  Speaker --> UI
  Producer --> UI

  UI --> API
  API --> Mongo
  API --> Memory
  API --> SSE

  SSE --> Audience
  SSE --> Speaker
  SSE --> Producer

  UI --> STDB
  UI --> Deepgram

  API --> Gemini
```

Notes:
- Clients consume SSE streams for signals, captions, suggestions, and interventions.
- SpacetimeDB holds caption rows; MongoDB + GridFS persist sessions, summaries, suggestions, and audio.
- Gemini powers interventions, summaries, suggester, and chat; ElevenLabs is used for optional TTS.
