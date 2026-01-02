"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { useParams, useRouter } from "next/navigation";
import AuthGate from "@/src/components/AuthGate";

export default function InviteAcceptPage() {
  const router = useRouter();
  const params = useParams();
  const token = (params as any)?.token as string;

  const [session, setSession] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Preparing…");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!token) return;

    (async () => {
      setErr(null);
      setStatus("Accepting invite…");

      const { data, error } = await supabase.rpc("accept_household_invite", { p_token: token });

      if (error) {
        setErr(error.message);
        setStatus("Failed");
        return;
      }

      setStatus("Accepted. Redirecting…");
      router.replace("/rooms");
    })();
  }, [session?.user?.id, token, router]);

  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>{status}</div>
      {err && <div style={{ color: "crimson" }}>{err}</div>}
    </div>
  );
}
