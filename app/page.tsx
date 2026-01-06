"use client";

import React, { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { useRouter } from "next/navigation";
import AuthGate from "@/src/components/AuthGate";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function Home() {
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Preparing…");

  // theme（与其他页面保持一致的 oat）
  const oatBg = "bg-[#F7F1E6]";

  // 监听 auth 状态（可选，但能让 sign out 后状态同步）
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;

    (async () => {
      setErr(null);
      setStatus("Checking profile…");

      const userId = session.user.id;

      // profiles 表使用 user_id 作为主键
      const profRes = await supabase
        .from("profiles")
        .select("default_household_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (profRes.error) {
        setErr(profRes.error.message);
        setStatus("Failed");
        return;
      }

      const defaultHouseholdId: string | null = (profRes.data as any)?.default_household_id ?? null;

      if (!defaultHouseholdId) {
        setStatus("No default household. Redirecting…");
        router.replace("/onboarding");
        return;
      }

      setStatus("Redirecting…");
      router.replace("/rooms");
    })();
  }, [session?.user?.id, router]);

  return (
    <AuthGate onAuthed={(s) => setSession(s)}>
      <div className={cx("min-h-screen flex items-center justify-center", oatBg)}>
        <div className="px-4 py-3 rounded-2xl border border-black/10 bg-white/60 text-sm text-black/70">
          {err ? <span className="text-red-700">{err}</span> : <span>{status}</span>}
        </div>
      </div>
    </AuthGate>
  );
}

