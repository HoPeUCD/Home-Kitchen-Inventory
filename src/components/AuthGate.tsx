'use client';

import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/src/lib/supabase';

function SignInForm({ onSuccess }: { onSuccess: (s: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'signin') {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        if (data.session) onSuccess(data.session);
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          onSuccess(data.session);
        } else {
          setError('Please check your email to confirm your account.');
        }
      }
    } catch (err: any) {
      setError(err?.message ?? 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F1E6] px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-black/10 bg-[#FBF7EF] p-6 shadow-lg">
          <h1 className="text-2xl font-bold mb-2 text-black">Kitchen Inventory</h1>
          <p className="text-sm text-black/60 mb-6">Sign in to continue</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-black/80 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-black/80 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 rounded-xl bg-black text-white font-semibold hover:bg-black/90 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
            >
              {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError(null);
              }}
              className="text-sm text-black/70 hover:text-black underline"
            >
              {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthGate(props: {
  children: React.ReactNode;
  onAuthed?: (s: Session) => void; // ✅ 改成可选
}) {
  const { children, onAuthed } = props;

  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      setSession(data.session ?? null);
      setChecking(false);

      if (data.session && onAuthed) onAuthed(data.session);
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession ?? null);
      setChecking(false);
      if (newSession && onAuthed) onAuthed(newSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [onAuthed]);

  // 你原来如果有更复杂的"未登录提示/跳转"，可以在这里替换；
  // 先给出一个安全默认：未登录就显示一个简单提示。
  if (checking) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-black/60">Checking session…</div>;
  }

  if (!session) {
    return <SignInForm onSuccess={(s) => setSession(s)} />;
  }

  return <>{children}</>;
}
