# 🫀 PULSE

> The room speaks. You listen.

PULSE is a real-time AI-powered audience intelligence system for live presentations. Every person in the audience sends live signals from their phone. An AI agent continuously reads the room — detecting confusion, excitement, and disengagement — then autonomously intervenes: speaking aloud to the presenter, surfacing clarifying questions, and generating real-time suggestions. No one asks it to. It just acts.

Built for HackByte 4.0 — SpacetimeDB track.

## Live Demo

https://pulse.venoms.app

---

## What It Does

**For the audience (mobile)**
- Send real-time emoji signals: confused, clear, excited, slow down, question
- Submit questions (1-200 chars) and upvote others
- Transcript-grounded chat (Gemini-backed; heuristic fallback without a key)
- Live captions stream from the speaker

**For the speaker (dashboard)**
- Single ambient circle indicator — one glanceable signal (good / check / confused / fast / slow)
- Floating emoji reactions drifting up the screen as signals arrive
- Live captions via Deepgram streaming STT (toggleable)
- AI interventions via Gemini with optional ElevenLabs TTS (high urgency only)
- Suggestions panel (Agent 2 Suggester) with urgency + category
- Live questions panel with Agent 3 classification (urgency, category, theme tags)
- Post-session coaching report with segment-by-segment analysis

**For the producer (backstage dashboard)**
- Full signal analytics: Room Pulse, pace meter, engagement timeline, signal totals
- Real-time suggestion cards from Agent 2 (Suggester) with urgency-based escalation
- Questions tab with Agent 3 classification enrichment
- Post-session: full archive from MongoDB — signals, questions, suggestions, coach report

---

## Quick Start

### Prerequisites
- Node.js 20+ (Node 18+ may work, Docker uses Node 20)
- MongoDB connection string
- Deepgram API key (required for live captions)
- SpacetimeDB CLI ([spacetimedb.com/install](https://spacetimedb.com/install))
- Gemini API key (optional, enables AI features)
- ElevenLabs API key (optional, enables TTS)
- ArmorIQ API key (optional, integration scaffold only)

### Setup

```bash
git clone <repo>
cd PULSE_HACKBYTE4.0
npm install
```

Create a `.env` file in the repo root and fill in:

```bash
NEXT_PUBLIC_SPACETIMEDB_URL=wss://maincloud.spacetimedb.com
NEXT_PUBLIC_SPACETIMEDB_MODULE=pulse
NEXT_PUBLIC_APP_URL=http://localhost:3001

MONGODB_URI=mongodb+srv://...
JWT_SECRET=your_secret

NEXT_PUBLIC_DEEPGRAM_API_KEY=your_key
NEXT_PUBLIC_DEEPGRAM_MODEL=nova-2
NEXT_PUBLIC_DEEPGRAM_LANGUAGE=en-US

GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.0-flash
# GEMINI_API_URL=https://your-gateway.example.com

ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL=eleven_monolingual_v1

# Suggester auth (optional)
SUGGEST_AGENT_SECRET=your_random_secret

# ArmorIQ (optional scaffold)
ARMORIQ_API_KEY=ak_live_...
USER_ID=pulse-system
AGENT_ID=pulse-agent
ARMORIQ_ENV=production
```

### SpacetimeDB setup (first time or when module changes)

```bash
npm run stdb:publish    # publish module to SpacetimeDB cloud
npm run stdb:generate   # generate TypeScript client bindings
```

### Run

```bash
npm run dev             # Next dev on port 3001
npm run webpack         # Force webpack dev mode
```

### Production build

```bash
npm run build
npm start
```

### Docker

```bash
docker-compose up --build
```

---

## Project Structure

```
PULSE_HACKBYTE4.0/
├── app/
│   ├── page.tsx                        # Landing — create session
│   ├── speaker/[sessionId]/page.tsx    # Speaker ambient view
│   ├── audience/[sessionId]/page.tsx   # Audience mobile view
│   ├── producer/[sessionId]/page.tsx   # Producer analytics dashboard
│   └── api/
│       ├── auth/                       # Login/register/me
│       ├── session/                    # Create/get/start/end/archive/primary
│       ├── signals/                    # SSE signal stream + snapshot
│       ├── captions/                   # Caption broadcast buffer (SSE)
│       ├── questions/                  # Question submit + upvote + dismiss
│       ├── suggest/                    # Agent 2 Suggester run/list/dismiss
│       ├── intervene/                  # Gemini intervention trigger + ack
│       ├── summary/                    # 60s caption summary → SegmentSummary + Suggester
│       ├── coach/                      # Post-session CoachReport compilation
│       ├── transcript/                 # Transcript fetch from SegmentSummary
│       ├── chat/                       # Audience Q&A chat (Gemini)
│       ├── tts/                        # ElevenLabs TTS proxy
│       ├── audio/                      # Audio chunk upload/list
│       └── deepgram-token/             # Deepgram token endpoint
├── components/
│   ├── PulseVisualizer.tsx             # Animated pulse circle + signal bars
│   ├── FloatingReactions.tsx           # Emoji reactions drifting up
│   ├── SignalButtons.tsx               # Audience signal buttons
│   ├── InterventionCard.tsx            # AI intervention overlay (speaker)
│   ├── SuggestionCard.tsx              # Agent 2 suggestion overlay (producer)
│   ├── SessionReport.tsx               # Post-session coach report cards
│   ├── DashboardNav.tsx                # Shared nav bar
│   └── SpacetimeProvider.tsx           # SpacetimeDB connection provider
├── lib/
│   ├── armoriq.ts                      # ArmorIQ SDK integration + agent registry
│   ├── agents/
│   │   ├── suggester.ts                # Agent 2 system prompt + prompt builder
│   │   ├── question-classifier.ts      # Agent 3 system prompt + prompt builder
│   │   └── runner.ts                   # Gemini runner for both agents
│   ├── gemini.ts                       # analyzeIntervention + summarizeSegment + compileCoachReport
│   ├── elevenlabs.ts                   # ElevenLabs TTS
│   ├── fingerprint.ts                  # Device fingerprinting
│   ├── session.ts                      # Session ID generation
│   ├── useSpeechTranscript.ts          # Deepgram streaming STT
│   ├── useSpacetimeSession.ts          # SpacetimeDB subscriptions + reducers
│   ├── useTheme.ts                     # Dark/light mode
│   └── models/
│       ├── Session.ts                  # Session + signals + questions + interventions
│       ├── SegmentSummary.ts           # 60s caption summaries
│       ├── CoachReport.ts              # Post-session coaching report
│       ├── Suggestion.ts               # Live suggestions with escalation history
│       └── TranscriptChunk.ts          # Uploaded audio chunk metadata
├── src/module_bindings/                # Auto-generated SpacetimeDB bindings
└── spacetime/src/index.ts              # SpacetimeDB module — tables + reducers
```

---

## AI Agent Architecture

```
Speaker voice
    ↓ Deepgram STT
Final captions
    ↓
    ├── SpacetimeDB caption table + local buffer
    │       ↓
    │   /api/summary every 60s → SegmentSummary (Mongo)
    │       ↓
    │   Agent 2 — Suggester (Gemini)
    │   Produces: suggestions stored in Mongo + SSE broadcast
    │
    └── /api/captions SSE broadcast → audience captions

Agent 1 — Interventions (Gemini)
    Speaker view calls /api/intervene with transcript + signals
    Optional ElevenLabs TTS for high urgency; persisted to Mongo + GridFS

Agent 3 — Question Classifier (Gemini)
    Triggered on /api/questions submission
    Produces: category, urgency, relevance, duplicate detection, theme tag
```

**ArmorIQ's role:** Integration scaffold only. `/api/suggest` can be protected with `SUGGEST_AGENT_SECRET` (bearer token). Full ArmorIQ intent verification is not wired by default; the agents call Gemini directly.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.2 (App Router) |
| Styling | Tailwind CSS v4 |
| Real-time state | SpacetimeDB (captions + optional tables) |
| Real-time transport | Server-Sent Events (SSE) |
| AI reasoning | Google Gemini (interventions, summaries, suggester, chat) |
| Speech recognition | Deepgram streaming STT |
| Voice | ElevenLabs TTS (optional) |
| Database | MongoDB + GridFS (Mongoose) |
| Agent security | Optional bearer token for `/api/suggest` + ArmorIQ scaffold |
| Language | TypeScript |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Yes | Public base URL (CORS + HMR) |
| `NEXT_PUBLIC_SPACETIMEDB_URL` | Yes | SpacetimeDB WebSocket URL |
| `NEXT_PUBLIC_SPACETIMEDB_MODULE` | Yes | SpacetimeDB module name |
| `NEXT_PUBLIC_DEEPGRAM_API_KEY` | Yes | Deepgram API key (browser + `/api/deepgram-token`) |
| `NEXT_PUBLIC_DEEPGRAM_MODEL` | No | Deepgram model (default `nova-2`) |
| `NEXT_PUBLIC_DEEPGRAM_LANGUAGE` | No | Deepgram language (default `en-US`) |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | No | JWT signing secret (defaults to `dev-secret`) |
| `GEMINI_API_KEY` | No* | Gemini API key (required for AI features) |
| `GEMINI_MODEL` | No | Gemini model name (defaults vary by feature) |
| `GEMINI_API_URL` | No | Optional Gemini gateway URL |
| `ELEVENLABS_API_KEY` | No | ElevenLabs API key (required for TTS) |
| `ELEVENLABS_VOICE_ID` | No | Voice ID for TTS |
| `ELEVENLABS_MODEL` | No | TTS model (default `eleven_monolingual_v1`) |
| `ELEVENLABS_STT_URL` | No | STT endpoint override |
| `ELEVENLABS_STT_MODEL` | No | STT model id |
| `ELEVENLABS_STT_LANGUAGE` | No | STT language code |
| `SUGGEST_AGENT_SECRET` | No | Bearer token for `/api/suggest` auth |
| `ARMORIQ_API_KEY` | No | ArmorIQ scaffold only |
| `USER_ID` | No | ArmorIQ user identifier |
| `AGENT_ID` | No | ArmorIQ agent identifier |
| `ARMORIQ_ENV` | No | ArmorIQ environment (`production` or `development`) |
| `PULSE_AUDIO_LOCAL_DIR` | No | Local mirror directory for audio uploads |

---

## SpacetimeDB Scripts

```bash
npm run stdb:publish    # compile + publish module
npm run stdb:generate   # generate TypeScript client bindings
npm run stdb:logs       # tail live module logs
```

---

## Security

- Device fingerprinting — SHA-256 rate-limits by device
- Per-user cooldowns — 10s signals, 30s questions, 5s chat (server-enforced)
- 12-character session IDs — 36^12 ≈ 4.7 trillion combinations
- Optional bearer token for `/api/suggest` + rate limiting with `X-RateLimit-*` headers
- 1MB payload size limit on `/api/suggest`
- Suggestion responses sanitize internal fields before returning to clients
- CORS allows `pulse.venoms.app`, `localhost:3001`, and `NEXT_PUBLIC_APP_URL`

---

## License

MIT
