"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { useRouter } from "next/navigation";
import AuthGate from "@/src/components/AuthGate";

export default function Households() {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const [rows, setRows] = useState<any[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function load() {
    if (!session?.user?.id) return;

    setErr(null);

    const prof = await supabase
      .from("profiles")
      .select("default_household_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (prof.error) return setErr(prof.error.message);
    setDefaultId(prof.data?.default_household_id ?? null);

    const hm = await supabase
      .from("household_members")
      .select("household_id, role, households(id,name,join_code)")
      .eq("user_id", session.user.id);

    if (hm.error) return setErr(hm.error.message);
    setRows(hm.data ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function setDefault(hid: string) {
    setErr(null);
    const { error } = await supabase.rpc("set_default_household", { p_household_id: hid });
    if (error) return setErr(error.message);
    setDefaultId(hid);
    router.push("/rooms");
  }

  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900 }}>Households</h1>
        <button onClick={() => router.push("/onboarding")} style={{ padding: 10, borderRadius: 12, fontWeight: 900 }}>
          + Create / Join
        </button>
      </div>

      {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r) => {
          const h = r.households;
          const isDefault = defaultId === h?.id;
          return (
            <div key={r.household_id} style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 14 }}>
              <div style={{ fontWeight: 900 }}>{h?.name ?? r.household_id}</div>
              <div style={{ opacity: 0.75, marginTop: 4 }}>Role: {r.role ?? "member"}</div>
              {h?.join_code ? <div style={{ opacity: 0.75, marginTop: 4 }}>Join code: {h.join_code}</div> : null}

              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <button onClick={() => setDefault(h.id)} style={{ padding: 10, borderRadius: 12, fontWeight: 900 }}>
                  {isDefault ? "Default" : "Set as default / Switch"}
                </button>
                <button onClick={() => router.push("/rooms")} style={{ padding: 10, borderRadius: 12 }}>
                  Go to rooms
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
