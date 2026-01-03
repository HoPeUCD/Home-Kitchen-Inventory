"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const user = session?.user ?? null;
  const email = user?.email ?? "";

  const suggestions = useMemo(() => {
    // 你希望出现 Hope / Tasha 示例，这里固定给一些推荐值
    return [
      "Hope Home",
      "Hope’s Household",
      "Family Home",
      "My Home Inventory",
    ];
  }, []);

  async function createHousehold() {
    setErr(null);
    setStatus(null);

    const nm = householdName.trim();
    if (!nm) return setErr("Household name required.");

    setBusy(true);
    try {
      const { error } = await supabase.rpc("create_household", { p_name: nm });
      if (error) throw error;

      setStatus("Created. Redirecting…");
      router.replace("/rooms");
    } catch (e: any) {
      setErr(e?.message ?? "Create household failed.");
    } finally {
      setBusy(false);
    }
  }

  async function requestJoin() {
    setErr(null);
    setStatus(null);

    const code = joinCode.trim();
    if (!code) return setErr("Join code required.");

    setBusy(true);
    try {
      const { error } = await supabase.rpc("request_join_by_code", {
        p_join_code: code,
        p_message: message.trim() || null,
      });
      if (error) throw error;

      setStatus("Request submitted. Waiting for approval.");
    } catch (e: any) {
      setErr(e?.message ?? "Request join failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Get started</h1>
          <div style={{ opacity: 0.75, marginTop: 6 }}>
            Signed in as <span style={{ fontWeight: 900 }}>{email || user?.id}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => router.push("/households")} style={{ padding: 10, borderRadius: 12, fontWeight: 900 }}>
            Households
          </button>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              setSession(null);
              router.replace("/");
            }}
            style={{ padding: 10, borderRadius: 12 }}
          >
            Sign out
          </button>
        </div>
      </div>

      {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}
      {status && <div style={{ marginBottom: 12 }}>{status}</div>}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Create a household</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setHouseholdName(s)}
                style={{ padding: "8px 10px", borderRadius: 999, border: "1px solid rgba(0,0,0,.12)", background: "white" }}
              >
                {s}
              </button>
            ))}
          </div>

          <input
            value={householdName}
            onChange={(e) => setHouseholdName(e.target.value)}
            placeholder="Example: Hope & Tasha Home"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,.12)" }}
          />

          <button
            onClick={createHousehold}
            disabled={busy || !householdName.trim()}
            style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, fontWeight: 900 }}
          >
            {busy ? "Working…" : "Create"}
          </button>
        </div>

        <div style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Join with a code</div>

          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Join code (e.g. A1B2C3D4E5)"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,.12)" }}
          />

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Optional message to the admin"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,.12)", marginTop: 10, minHeight: 80 }}
          />

          <button
            onClick={requestJoin}
            disabled={busy || !joinCode.trim()}
            style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, fontWeight: 900 }}
          >
            {busy ? "Working…" : "Request to join"}
          </button>
        </div>
      </div>
    </div>
  );
}
