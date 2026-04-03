import { notFound } from "next/navigation";

interface AudiencePageProps {
  params: Promise<{ sessionId: string }>;
}

async function fetchSession(sessionId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  const res = await fetch(`${baseUrl}/api/session?sessionId=${encodeURIComponent(sessionId)}`, {
    // Avoid caching so the shell always reflects latest state
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

export default async function AudiencePage({ params }: AudiencePageProps) {
  const { sessionId } = await params;
  const session = await fetchSession(sessionId);
  if (!session) {
    notFound();
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Audience view
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {session.topic}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          with <span className="font-medium text-zinc-900 dark:text-zinc-100">{session.speakerName}</span>
        </p>

        <div className="mt-6 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          This is the audience shell for session <span className="font-mono text-xs">{session.sessionId}</span>.
          Real-time signals, questions, and mood features will appear here in later phases.
        </div>
      </main>
    </div>
  );
}
