'use client';

import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/src/lib/supabase';

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

  // 你原来如果有更复杂的“未登录提示/跳转”，可以在这里替换；
  // 先给出一个安全默认：未登录就显示一个简单提示。
  if (checking) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-black/60">Checking session…</div>;
  }

  if (!session) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-black/60">Please sign in.</div>;
  }

  return <>{children}</>;
}
