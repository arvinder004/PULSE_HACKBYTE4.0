import { notFound } from "next/navigation";

interface SpeakerPageProps {
  params: Promise<{ sessionId: string }>;
}

async function fetchSession(sessionId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  const res = await fetch(`${baseUrl}/api/session?sessionId=${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as {
    sessionId: string;
    speakerName: string;
    topic: string;
  };
}

export default async function SpeakerPage({ params }: SpeakerPageProps) {
  const { sessionId } = await params;
  const session = await fetchSession(sessionId);
  if (!session) {
    notFound();
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
        <header className="flex flex-col gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Speaker dashboard
          </p>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {session.topic}
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                with <span className="font-medium text-zinc-900 dark:text-zinc-100">{session.speakerName}</span>
              </p>
            </div>
            <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              Session ID: <span className="font-mono text-[11px]">{session.sessionId}</span>
            </div>
          </div>
        </header>

        <section className="mt-6 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          This is the speaker dashboard shell for Phase 1.
          Real-time pulse visualizations, AI interventions, questions, polls, and mood will be added in later phases.
        </section>
      </main>
    </div>
  );
}
