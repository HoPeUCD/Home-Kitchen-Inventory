"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { useRouter } from "next/navigation";
import AuthGate from "@/src/components/AuthGate";

type Household = { id: string; name: string; join_code: string | null };
type Room = { id: string; household_id: string; name: string; position: number };

export default function RoomsPage() {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);

  const [household, setHousehold] = useState<Household | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  const [newRoomName, setNewRoomName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const user = session?.user ?? null;
  const userEmail = user?.email ?? "";

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    router.replace("/");
  }

  async function ensureProfileRow(userId: string) {
    // 让老用户也有 profiles 行（需要 profiles insert policy；我已在 SQL patch 里给你了）
    await supabase.from("profiles").upsert({ user_id: userId }, { onConflict: "user_id" });
  }

  async function getDefaultHouseholdId(userId: string) {
    const prof = await supabase
      .from("profiles")
      .select("default_household_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (prof.error) throw new Error(prof.error.message);
    return (prof.data?.default_household_id as string | null) ?? null;
  }

  async function getMyMemberships(userId: string) {
    // 注意：我们把 household_members 的 select policy 改成只读自己行，所以这里不会递归
    const hm = await supabase
      .from("household_members")
      .select("household_id")
      .eq("user_id", userId);

    if (hm.error) throw new Error(hm.error.message);
    return (hm.data ?? []) as { household_id: string }[];
  }

  async function setDefaultHousehold(hid: string) {
    const r = await supabase.rpc("set_default_household", { p_household_id: hid });
    if (r.error) throw new Error(r.error.message);
  }

  async function loadHousehold(hid: string) {
    const h = await supabase
      .from("households")
      .select("id,name,join_code")
      .eq("id", hid)
      .single();

    if (h.error) throw new Error(h.error.message);
    setHousehold(h.data as Household);
  }

  async function loadRooms(hid: string) {
    const r = await supabase
      .from("rooms")
      .select("id,household_id,name,position")
      .eq("household_id", hid)
      .order("position", { ascending: true });

    if (r.error) throw new Error(r.error.message);
    setRooms((r.data as Room[]) ?? []);
  }

  useEffect(() => {
    if (!user?.id) return;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        await ensureProfileRow(user.id);

        let hid = await getDefaultHouseholdId(user.id);

        // 如果没有默认 household：根据 membership 走分流
        if (!hid) {
          const mems = await getMyMemberships(user.id);

          if (mems.length === 0) {
            router.replace("/onboarding");
            return;
          }
          if (mems.length === 1) {
            hid = mems[0].household_id;
            await setDefaultHousehold(hid);
          } else {
            router.replace("/households");
            return;
          }
        }

        await loadHousehold(hid);
        await loadRooms(hid);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load rooms.");
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id, router]);

  const joinCode = household?.join_code ?? null;

  async function createRoom() {
    if (!household) return;
    const nm = newRoomName.trim();
    if (!nm) return;

    setErr(null);
    try {
      const nextPos = (rooms.reduce((m, r) => Math.max(m, r.position ?? 0), 0) || 0) + 1;

      // 如果你的 rooms 表有 created_by 且 NOT NULL，就保留；没有的话删掉这行即可
      const ins = await supabase
        .from("rooms")
        .insert({
          household_id: household.id,
          name: nm,
          position: nextPos,
          created_by: user.id,
        } as any)
        .select("id,household_id,name,position")
        .single();

      if (ins.error) throw ins.error;

      setNewRoomName("");
      const newRoom = ins.data as Room;
      setRooms((prev) => [...prev, newRoom].sort((a, b) => a.position - b.position));
    } catch (e: any) {
      setErr(e?.message ?? "Create room failed.");
    }
  }

  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Rooms</div>
          <div style={{ opacity: 0.75, marginTop: 4 }}>
            Signed in as <span style={{ fontWeight: 900 }}>{userEmail || user.id}</span>
          </div>
          {household && (
            <div style={{ opacity: 0.75, marginTop: 4 }}>
              Household: <span style={{ fontWeight: 900 }}>{household.name}</span>
              {joinCode ? (
                <>
                  {" "}
                  · Join code: <span style={{ fontWeight: 900 }}>{joinCode}</span>
                </>
              ) : null}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => router.push("/households")} style={{ padding: 10, borderRadius: 12, fontWeight: 900 }}>
            Households
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

      {loading ? (
        <div style={{ opacity: 0.75 }}>Loading…</div>
      ) : (
        <>
          <div style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 14, marginBottom: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Create a room</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="Examples: Kitchen, Living Room, Bathroom 1…"
                style={{ flex: "1 1 260px", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,.12)" }}
              />
              <button
                onClick={createRoom}
                disabled={!newRoomName.trim()}
                style={{ padding: 10, borderRadius: 12, fontWeight: 900 }}
              >
                Create
              </button>
            </div>
          </div>

          {rooms.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No rooms yet. Create one above.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => router.push(`/rooms/${r.id}`)}
                  style={{
                    textAlign: "left",
                    border: "1px solid rgba(0,0,0,.08)",
                    borderRadius: 14,
                    padding: 14,
                    background: "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 900 }}>{r.name}</div>
                  <div style={{ opacity: 0.7, marginTop: 4 }}>Open</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
