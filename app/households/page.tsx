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
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    router.replace("/");
  }

  async function setDefault(hid: string) {
    setErr(null);
    setBusyId(hid);
    try {
      const { error } = await supabase.rpc("set_default_household", { p_household_id: hid });
      if (error) throw error;
      setDefaultId(hid);
      router.push("/rooms");
    } catch (e: any) {
      setErr(e?.message ?? "Set default failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteHousehold(hid: string, name: string) {
    // Strong confirmation: confirm + typed name
    const ok = window.confirm(
      `Delete household "${name}"?\n\nThis will permanently delete rooms, columns, cells, items, invites, and requests under this household (if cascades are enabled).`
    );
    if (!ok) return;

    const typed = window.prompt(`Type the household name exactly to confirm deletion:\n\n${name}`);
    if (typed !== name) {
      alert("Confirmation did not match. Deletion cancelled.");
      return;
    }

    setErr(null);
    setBusyId(hid);
    try {
      const { error } = await supabase.rpc("delete_household", { p_household_id: hid });
      if (error) throw error;

      // refresh list + default
      await load();

      // If deleted household was default, you will now have defaultId null.
      // Redirect user appropriately:
      if (defaultId === hid) {
        // After deletion, default_household_id becomes NULL by FK (ON DELETE SET NULL).
        // If user still has other households, let them pick; otherwise onboarding.
        const remaining = (rows ?? []).filter((r) => r.households?.id && r.households.id !== hid);
        if (remaining.length === 0) router.replace("/onboarding");
        else router.replace("/households");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Delete household failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900 }}>Households</h1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => router.push("/rooms")} style={{ padding: 10, borderRadius: 12, fontWeight: 900 }}>
            Rooms
          </button>
          <button onClick={() => router.push("/onboarding")} style={{ padding: 10, borderRadius: 12 }}>
            Create / Join
          </button>
          <button onClick={signOut} style={{ padding: 10, borderRadius: 12 }}>
            Sign out
          </button>
        </div>
      </div>

      {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r) => {
          const h = r.households;
          if (!h?.id) return null;

          const isDefault = defaultId === h.id;
          const isOwner = (r.role ?? "") === "owner";
          const busy = busyId === h.id;

          return (
            <div key={h.id} style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 900 }}>{h.name}</div>
                  <div style={{ opacity: 0.75, marginTop: 4 }}>Role: {r.role ?? "member"}</div>
                  {h.join_code ? <div style={{ opacity: 0.75, marginTop: 4 }}>Join code: {h.join_code}</div> : null}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    onClick={() => setDefault(h.id)}
                    disabled={busy}
                    style={{ padding: 10, borderRadius: 12, fontWeight: 900 }}
                  >
                    {isDefault ? "Default" : "Set as default / Switch"}
                  </button>

                  {isOwner ? (
                    <button
                      onClick={() => deleteHousehold(h.id, h.name)}
                      disabled={busy}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid rgba(220,0,0,.25)",
                        background: "rgba(220,0,0,.06)",
                        color: "crimson",
                        fontWeight: 900,
                      }}
                    >
                      Delete household
                    </button>
                  ) : null}
                </div>
              </div>

              {busy ? <div style={{ opacity: 0.7, marginTop: 8 }}>Working…</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
