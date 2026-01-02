"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { useRouter } from "next/navigation";
import AuthGate from "@/src/components/AuthGate";

export default function Onboarding() {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);

  const [householdName, setHouseholdName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState("");

  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function createHousehold() {
    setErr(null);
    setStatus(null);

    const nm = householdName.trim();
    if (!nm) return setErr("Household name required.");

    const { data, error } = await supabase.rpc("create_household", { p_name: nm });
    if (error) return setErr(error.message);

    setStatus("Created. Redirecting…");
    router.replace("/rooms");
  }

  async function requestJoin() {
    setErr(null);
    setStatus(null);

    const code = joinCode.trim();
    if (!code) return setErr("Join code required.");

    const { data, error } = await supabase.rpc("request_join_by_code", {
      p_join_code: code,
      p_message: message.trim() || null,
    });

    if (error) return setErr(error.message);

    setStatus("Request submitted. Waiting for approval. You can leave this page; you’ll see it after approval.");
    // 你也可以跳到 /households 看 pending requests（可选）
  }

  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Get started</h1>
      <div style={{ opacity: 0.8, marginBottom: 16 }}>
        Create your own household or request to join an existing one using a join code.
      </div>

      {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}
      {status && <div style={{ marginBottom: 12 }}>{status}</div>}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Create a household</div>
          <input
            value={householdName}
            onChange={(e) => setHouseholdName(e.target.value)}
            placeholder="Household name (e.g. Hope & Tasha)"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,.12)" }}
          />
          <button
            onClick={createHousehold}
            style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, fontWeight: 900 }}
          >
            Create
          </button>
        </div>

        <div style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Join with a code</div>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Join code"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,.12)" }}
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Optional message to the household admin"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,.12)", marginTop: 10, minHeight: 80 }}
          />
          <button
            onClick={requestJoin}
            style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, fontWeight: 900 }}
          >
            Request to join
          </button>
        </div>
      </div>
    </div>
  );
}
