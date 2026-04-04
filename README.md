# 🫀 PULSE

> The room speaks. You listen.

PULSE is a real-time AI-powered audience intelligence system for live presentations. Every person in the audience sends live signals from their phone. An AI agent continuously reads the room — detecting confusion, excitement, and disengagement — then autonomously intervenes: speaking aloud to the presenter, surfacing clarifying questions, and triggering live polls. No one asks it to. It just acts.

Built for HackByte 4.0 — SpacetimeDB track.

---

## What It Does

**For the audience (mobile)**
- Send real-time emoji signals: confused, clear, excited, slow down, question
- Submit typed questions that others can upvote
- Tap "I need an example" — when 3+ people hit it simultaneously, AI fires immediately
- Respond to mood prompts after AI interventions (builds a live word cloud)
- Vote on live polls launched by the speaker

**For the speaker (dashboard)**
- Live pulse visualizer showing room sentiment in real time
- Floating emoji reactions drifting up the screen as signals arrive
- AI listens to what you're saying via Deepgram streaming STT — suggestions are specific to your words, not generic
- AI interventions spoken aloud via ElevenLabs (high urgency only — medium/low appear silently)
- Pause AI voice with one tap when you're in flow
- Pace meter showing if you're going too fast, too slow, or just right
- Live engagement timeline — see exactly when you lost the room and recovered
- AI-generated clarifying questions — pick one, it appears on all audience phones
- Live question queue sorted by upvotes
- Launch quick polls — results stream back as a live bar chart
- Mood word cloud built from audience responses after each intervention

---

## Quick Start

### Prerequisites
- Node.js 18+
- A Gemini API key ([get one here](https://aistudio.google.com))
- A Deepgram API key ([get one here](https://deepgram.com))
- An ElevenLabs API key ([get one here](https://elevenlabs.io))
- SpacetimeDB CLI ([install here](https://spacetimedb.com/install))

### Setup

```bash
git clone <repo>
cd pulse
npm install
```

Fill in `.env.local`:

```bash
NEXT_PUBLIC_SPACETIMEDB_URL=wss://maincloud.spacetimedb.com
NEXT_PUBLIC_SPACETIMEDB_MODULE=pulse
GEMINI_API_KEY=your_key_here
NEXT_PUBLIC_DEEPGRAM_API_KEY=your_key_here
NEXT_PUBLIC_DEEPGRAM_MODEL=nova-2
NEXT_PUBLIC_DEEPGRAM_LANGUAGE=en-US
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

### SpacetimeDB setup (first time)

```bash
npm run stdb:publish    # publish module to SpacetimeDB cloud
npm run stdb:generate   # generate TypeScript client bindings
```

### Run

```bash
npm run dev
```

Open `http://localhost:3001`, enter your name and topic, click "Start presenting."

Share the audience URL or QR code with your audience.

---

## Project Structure

```
pulse/
├── app/
│   ├── page.tsx                    # Landing — create session
│   ├── speaker/[sessionId]/        # Speaker dashboard
│   ├── audience/[sessionId]/       # Audience mobile view
│   └── api/
│       ├── session/                # Session create/get
│       ├── signals/                # Real-time signal stream (SSE)
│       ├── intervene/              # Gemini AI intervention trigger
│       ├── interventions/stream/   # SSE stream to audience phones
│       ├── questions/              # Question submit/upvote/dismiss
│       ├── mood/                   # Post-intervention mood words
│       ├── example/                # "Need example" threshold trigger
│       ├── clarify/                # AI clarifying question generation + broadcast
│       ├── poll/                   # Poll create/vote/close
│       └── tts/                    # ElevenLabs text-to-speech proxy
├── components/
│   ├── PulseVisualizer.tsx         # Animated pulse circle + signal bars
│   ├── FloatingReactions.tsx       # Emoji reactions drifting up the screen
│   ├── SignalButtons.tsx           # Audience signal buttons
│   ├── ExampleButton.tsx           # "I need an example" button
│   ├── ExampleCounter.tsx          # Speaker-side example request counter
│   ├── InterventionCard.tsx        # AI intervention card (urgency-aware)
│   ├── VoicePlayer.tsx             # ElevenLabs audio playback
│   ├── QuestionQueue.tsx           # Speaker question queue
│   ├── QuestionInput.tsx           # Audience question submission
│   ├── MoodWordCloud.tsx           # Live word cloud (pure CSS/SVG)
│   ├── MoodPrompt.tsx              # Post-intervention mood prompt overlay
│   ├── AudiencePoll.tsx            # Poll voting overlay on audience phone
│   ├── AudienceClarify.tsx         # Clarifying question banner on audience phone
│   ├── PollCreator.tsx             # Speaker poll creation + live results
│   ├── ClarifyingQuestions.tsx     # AI question generation + broadcast
│   ├── PaceMeter.tsx               # Pace indicator
│   ├── EngagementTimeline.tsx      # Live SVG sentiment timeline
│   └── SpacetimeProvider.tsx       # SpacetimeDB connection provider
├── lib/
│   ├── gemini.ts                   # Gemini API — intervention reasoning with transcript
│   ├── elevenlabs.ts               # ElevenLabs TTS
│   ├── moderation.ts               # Gemini content moderation for questions
│   ├── fingerprint.ts              # Device fingerprinting (abuse prevention)
│   ├── session.ts                  # Session ID generation
│   ├── useSpeechTranscript.ts      # Deepgram streaming STT — live transcript buffer
│   ├── models/SegmentSummary.ts    # 60s caption summaries stored in MongoDB
│   └── useSpacetimeSession.ts      # SpacetimeDB table subscriptions + reducers
├── src/
│   └── module_bindings/            # Auto-generated SpacetimeDB TypeScript bindings
└── spacetime/
    └── src/index.ts                # SpacetimeDB module — tables + reducers
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Styling | Tailwind CSS v4 |
| Real-time state | SpacetimeDB (cloud) |
| Real-time transport | Server-Sent Events (SSE) |
| AI reasoning | Google Gemini 3 Flash |
| Speech recognition | Deepgram streaming STT |
| Voice | ElevenLabs TTS |
| QR codes | react-qrcode-logo |
| Language | TypeScript |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SPACETIMEDB_URL` | Yes | SpacetimeDB WebSocket URL |
| `NEXT_PUBLIC_SPACETIMEDB_MODULE` | Yes | SpacetimeDB module name |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `NEXT_PUBLIC_DEEPGRAM_API_KEY` | Yes | Deepgram API key (client-side streaming) |
| `NEXT_PUBLIC_DEEPGRAM_MODEL` | No | Deepgram model (default `nova-2`) |
| `NEXT_PUBLIC_DEEPGRAM_LANGUAGE` | No | Deepgram language (default `en-US`) |
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | No | Voice ID (defaults to Rachel) |
| `NEXT_PUBLIC_APP_URL` | No | Public URL for QR code generation |

---

## SpacetimeDB Scripts

```bash
npm run stdb:publish    # compile + publish module to SpacetimeDB
npm run stdb:generate   # generate TypeScript client bindings
npm run stdb:logs       # tail live module logs
```

---

## AI Intervention Design

The AI is designed to be a coach, not a heckler. Key constraints:

- 90-second minimum cooldown between interventions
- Won't fire while voice is still playing
- Won't fire if the speaker hasn't acknowledged the last intervention
- Speaker can pause AI voice for 2 minutes with one tap
- Only HIGH urgency interventions are spoken aloud — medium/low appear silently as cards
- Gemini receives the last 60 seconds of Deepgram captions (buffered in SpacetimeDB) so suggestions are specific to what was actually being said, not generic

---

## Security & Abuse Prevention

- Device fingerprinting — SHA-256 hash of browser signals rate-limits by device, not session ID
- Per-user cooldowns — 10s signals, 30s questions, 15s example button (server-enforced)
- Statistical outlier detection — one user dominating >60% of signals gets weight 0.2
- Variance tracking — flip-flopping users get down-weighted
- Question moderation — every question checked by Gemini before reaching the speaker
- 12-character session IDs — 36^12 ≈ 4.7 trillion combinations

---

## License

MIT
