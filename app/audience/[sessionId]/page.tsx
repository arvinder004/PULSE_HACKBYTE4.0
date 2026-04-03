'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AudiencePage() {
  const params = useParams();
  const sessionId = params?.sessionId as string;

  const [session, setSession] = useState<{ speakerName: string; topic: string } | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/session?sessionId=${sessionId}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then(d => d && setSession({ speakerName: d.speakerName, topic: d.topic }));
  }, [sessionId]);

  if (notFound) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen bg-zinc-50 px-4">
        <div className="text-center">
          <p className="text-sm text-zinc-500 uppercase tracking-widest mb-2">Session not found</p>
          <p className="text-xs text-zinc-400">The session may have ended or the link is invalid.</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen bg-zinc-50 px-4">
        <p className="text-sm text-zinc-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-screen bg-zinc-50 px-4 py-10">
      <main className="w-full max-w-sm mx-auto">
        <p className="text-xs text-zinc-400 uppercase tracking-widest mb-3">Audience</p>
        <h1 className="text-2xl font-semibold leading-tight text-zinc-900">{session.topic}</h1>
        <p className="text-sm text-zinc-500 mt-1">with {session.speakerName}</p>
        <div className="mt-8 border border-zinc-200 rounded-xl px-4 py-5 text-sm text-zinc-400 bg-white">
          Signal buttons and questions will appear here in Phase 2.
        </div>
      </main>
    </div>
  );
}
