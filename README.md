# 🫀 PULSE

> The room speaks. You listen.

PULSE is a real-time AI-powered audience intelligence system for live presentations. Every person in the audience sends live signals from their phone. An AI agent continuously reads the room — detecting confusion, excitement, and disengagement — then autonomously intervenes: speaking aloud to the presenter, surfacing clarifying questions, and triggering live polls. No one asks it to. It just acts.

Built for HackByte 4.0 — SpacetimeDB track.

---

## What It Does

**For the audience (mobile)**
- Send real-time emoji signals: confused, clear, excited, slow down, question
- Submit typed questions that others can upvote
- Respond to mood prompts after AI interventions

**For the speaker (dashboard)**
- Single ambient circle indicator — one glanceable signal (good / check / confused / fast / slow)
- Floating emoji reactions drifting up the screen as signals arrive
- AI listens via Deepgram streaming STT — suggestions are specific to your words
- AI interventions spoken aloud via ElevenLabs (high urgency only)
- Pause AI voice with one tap
- Live questions panel with Agent 3 classification (urgency, category, theme tags)
- Post-session coaching report with segment-by-segment analysis

**For the producer (backstage dashboard)**
- Full signal analytics: Room Pulse, pace meter, engagement timeline, signal totals
- Real-time suggestion cards from Agent 2 (Suggester) with urgency-based auto-dismiss
- Questions tab with Agent 3 classification enrichment
- Post-session: full archive from MongoDB — signals, questions, suggestions, coach report

---

## Quick Start

### Prerequisites
- Node.js 18+
- Gemini API key ([aistudio.google.com](https://aistudio.google.com))
- Deepgram API key ([deepgram.com](https://deepgram.com))
- ElevenLabs API key ([elevenlabs.io](https://elevenlabs.io))
- MongoDB connection string
- SpacetimeDB CLI ([spacetimedb.com/install](https://spacetimedb.com/install))
- ArmorIQ API key ([platform.armoriq.ai](https://platform.armoriq.ai)) — optional, enables security layer

### Setup

```bash
git clone <repo>
cd pulse
npm install
```

Copy `.env.local.example` to `.env` and fill in:

```bash
NEXT_PUBLIC_SPACETIMEDB_URL=wss://maincloud.spacetimedb.com
NEXT_PUBLIC_SPACETIMEDB_MODULE=pulse
NEXT_PUBLIC_APP_URL=https://your-domain.com

GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.0-flash

NEXT_PUBLIC_DEEPGRAM_API_KEY=your_key
NEXT_PUBLIC_DEEPGRAM_MODEL=nova-2
NEXT_PUBLIC_DEEPGRAM_LANGUAGE=en-US

ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL

MONGODB_URI=mongodb+srv://...
JWT_SECRET=your_secret

# ArmorIQ (optional — agents fall back to direct Gemini if absent)
ARMORIQ_API_KEY=ak_live_...
USER_ID=pulse-system
AGENT_ID=pulse-agent-v1
SUGGEST_AGENT_SECRET=your_random_secret
```

### SpacetimeDB setup (first time)

```bash
npm run stdb:publish    # publish module to SpacetimeDB cloud
npm run stdb:generate   # generate TypeScript client bindings
```

### Run

```bash
npm run dev             # webpack mode on port 3001
```

---

## Project Structure

```
pulse/
├── app/
│   ├── page.tsx                        # Landing — create session
│   ├── speaker/[sessionId]/page.tsx    # Speaker ambient view
│   ├── audience/[sessionId]/page.tsx   # Audience mobile view
│   ├── producer/[sessionId]/page.tsx   # Producer analytics dashboard
│   └── api/
│       ├── session/                    # Session CRUD + /end + /archive + /primary
│       ├── signals/                    # SSE signal stream + snapshot
│       ├── questions/                  # Question submit (+ Agent 3) / upvote / dismiss
│       ├── suggest/                    # Agent 2 Suggester endpoint (ArmorIQ secured)
│       ├── intervene/                  # Gemini intervention trigger + ack
│       ├── summary/                    # 60s caption summary → SegmentSummary
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
│       └── Suggestion.ts              # Live suggestions with escalation history
├── src/module_bindings/                # Auto-generated SpacetimeDB bindings
└── spacetime/src/index.ts              # SpacetimeDB module — tables + reducers
```

---

## AI Agent Architecture

```
Speaker voice
    ↓ Deepgram STT
Raw transcript chunks
    ↓
    ├── MongoDB (SegmentSummary)
    │       ↓
    │   Agent 1 (Gemini) — summarizeSegment
    │   → segment summaries stored for coach report
    │
    ├── Agent 2 — Suggester (ArmorIQ secured)
    │   Receives: transcript + signals + classified questions + previous suggestions
    │   Produces: real-time improvement suggestions for producer
    │   Urgency: urgent (manual dismiss) / medium (60s) / low (30s)
    │   Escalation: detects repeated mistakes → upgrades to urgent
    │
    └── Agent 3 — Question Classifier (ArmorIQ secured)
        Triggered: on every audience question submission
        Receives: question + session topic + recent transcript + existing questions
        Produces: category, urgency, relevance, duplicate detection, theme tag
        Decides: whether to forward to Agent 2
```

**ArmorIQ's role:** Cryptographic intent verification proxy. Every call to `/api/suggest` and `/api/questions` is verified by ArmorIQ before reaching the handler. The agents themselves run on Gemini — ArmorIQ does not proxy LLM calls, it secures the API surface.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, webpack) |
| Styling | Tailwind CSS v4 |
| Real-time state | SpacetimeDB (cloud) |
| Real-time transport | Server-Sent Events (SSE) |
| AI reasoning | Google Gemini 2.0 Flash |
| Speech recognition | Deepgram streaming STT |
| Voice | ElevenLabs TTS |
| Database | MongoDB (Mongoose) |
| Agent security | ArmorIQ SDK |
| Language | TypeScript |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SPACETIMEDB_URL` | Yes | SpacetimeDB WebSocket URL |
| `NEXT_PUBLIC_SPACETIMEDB_MODULE` | Yes | SpacetimeDB module name |
| `NEXT_PUBLIC_APP_URL` | Yes | Public URL (CORS + QR codes) |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `GEMINI_MODEL` | No | Model name (default `gemini-2.0-flash`) |
| `NEXT_PUBLIC_DEEPGRAM_API_KEY` | Yes | Deepgram API key |
| `NEXT_PUBLIC_DEEPGRAM_MODEL` | No | Deepgram model (default `nova-2`) |
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | No | Voice ID (defaults to Rachel) |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | JWT signing secret |
| `ARMORIQ_API_KEY` | No | ArmorIQ API key (`ak_live_...`) |
| `USER_ID` | No | ArmorIQ user identifier |
| `AGENT_ID` | No | ArmorIQ agent identifier |
| `SUGGEST_AGENT_SECRET` | No | Bearer token for `/api/suggest` auth |

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
- Per-user cooldowns — 10s signals, 30s questions (server-enforced)
- 12-character session IDs — 36^12 ≈ 4.7 trillion combinations
- ArmorIQ cryptographic intent verification on agent endpoints
- Rate limiting with `X-RateLimit-*` headers on `/api/suggest`
- 1MB payload size limit on all agent routes
- PII masking — internal fields stripped from all API responses
- CORS restricted to `pulse.venoms.app` and `localhost`

---

## License

MIT
