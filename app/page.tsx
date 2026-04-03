'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type View = 'login' | 'register' | 'session';
type User = { id: string; email: string; name: string };

export default function Home() {
  const router = useRouter();
  const [view, setView] = useState<View>('login');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Check existing session
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.user) { setUser(d.user); setView('session'); } })
      .finally(() => setLoading(false));
  }, []);

  async function handleAuth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string> = {
      email: fd.get('email') as string,
      password: fd.get('password') as string,
    };
    if (view === 'register') body.name = fd.get('name') as string;

    const res = await fetch(`/api/auth/${view}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) { setError(data.error ?? 'Something went wrong'); return; }
    setUser(data.user);
    setView('session');
  }

  async function handleCreateSession(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        speakerName: fd.get('speakerName') as string,
        topic: fd.get('topic') as string,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) { setError(data.error ?? 'Failed to create session'); return; }
    router.push(`/speaker/${data.sessionId}`);
  }

  async function handleLogout() {
    await fetch('/api/auth/me', { method: 'DELETE' });
    setUser(null);
    setView('login');
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <p className="text-sm text-black/30">Loading…</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">PULSE</h1>
          <p className="text-sm text-black/40 mt-1">Real-time audience intelligence</p>
        </div>

        {/* Auth forms */}
        {(view === 'login' || view === 'register') && (
          <form onSubmit={handleAuth} className="flex flex-col gap-4">
            {view === 'register' && (
              <Field label="Name" name="name" type="text" placeholder="Ada Lovelace" />
            )}
            <Field label="Email" name="email" type="email" placeholder="you@example.com" />
            <Field label="Password" name="password" type="password" placeholder="••••••••" />

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full py-2.5 bg-black text-white text-sm rounded-lg hover:bg-black/80 disabled:opacity-50 transition-colors"
            >
              {submitting ? '…' : view === 'login' ? 'Sign in' : 'Create account'}
            </button>

            <p className="text-xs text-black/40 text-center">
              {view === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                onClick={() => { setView(view === 'login' ? 'register' : 'login'); setError(''); }}
                className="text-black underline underline-offset-2"
              >
                {view === 'login' ? 'Register' : 'Sign in'}
              </button>
            </p>
          </form>
        )}

        {/* Session creation */}
        {view === 'session' && user && (
          <form onSubmit={handleCreateSession} className="flex flex-col gap-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-black/50">Signed in as <span className="text-black font-medium">{user.name}</span></p>
              <button type="button" onClick={handleLogout} className="text-xs text-black/30 hover:text-black underline underline-offset-2">
                Sign out
              </button>
            </div>

            <Field label="Your name" name="speakerName" type="text" placeholder="Ada Lovelace" defaultValue={user.name} />
            <Field label="Topic" name="topic" type="text" placeholder="Intro to distributed systems" />

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full py-2.5 bg-black text-white text-sm rounded-lg hover:bg-black/80 disabled:opacity-50 transition-colors"
            >
              {submitting ? '…' : 'Start presenting'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, name, type, placeholder, defaultValue }: {
  label: string; name: string; type: string; placeholder: string; defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-black/50 font-medium uppercase tracking-wide">{label}</label>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required
        className="w-full border border-black/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-black/30 transition-colors placeholder:text-black/20"
      />
    </div>
  );
}
