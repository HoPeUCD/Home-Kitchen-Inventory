"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import AuthGate from "@/src/components/AuthGate";

type HouseholdJoin = { household_id: string; households: { id: string; name: string } | null };
type Room = { id: string; household_id: string; name: string; position: number };

export default function RoomsPage() {
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const user: User | null = session?.user ?? null;

  const [household, setHousehold] = useState<{ id: string; name: string } | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [newRoomName, setNewRoomName] = useState("");
  const [err, setErr] = useState<string | null>(null);

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
    setHousehold(null);
    setRooms([]);
  }

  async function loadHouseholdAndRooms(u: User) {
    setErr(null);

    const hm = await supabase
      .from("household_members")
      .select("household_id, households(id,name)")
      .eq("user_id", u.id)
      .limit(1)
      .maybeSingle();

    if (hm.error) {
      setErr(`Household load failed: ${hm.error.message}`);
      return;
    }

    const row = hm.data as unknown as HouseholdJoin | null;
    if (!row?.households?.id) {
      setErr("No household found for this user. If this is an existing user, run the bootstrap SQL once.");
      return;
    }

    setHousehold({ id: row.households.id, name: row.households.name });

    const r = await supabase
      .from("rooms")
      .select("id,household_id,name,position")
      .eq("household_id", row.household_id)
      .order("position", { ascending: true });

    if (r.error) {
      setErr(`Rooms load failed: ${r.error.message}`);
      return;
    }

    setRooms((r.data as Room[]) ?? []);
  }

  useEffect(() => {
    if (!user) return;
    loadHouseholdAndRooms(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function addRoom() {
    if (!user || !household) return;
    const name = newRoomName.trim();
    if (!name) return;

    const nextPos = (rooms.reduce((m, r) => Math.max(m, r.position ?? 0), 0) || 0) + 1;

    const ins = await supabase
      .from("rooms")
      .insert({ household_id: household.id, name, position: nextPos, created_by: user.id })
      .select("id,household_id,name,position")
      .single();

    if (ins.error) return setErr(ins.error.message);

    setRooms((prev) => [...prev, ins.data as Room].sort((a, b) => a.position - b.position));
    setNewRoomName("");
  }

  async function renameRoom(roomId: string, current: string) {
    const v = prompt("Rename room:", current);
    if (v === null) return;
    const name = v.trim();
    if (!name) return;

    const up = await supabase.from("rooms").update({ name }).eq("id", roomId);
    if (up.error) return setErr(up.error.message);

    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, name } : r)));
  }

  async function deleteRoom(roomId: string) {
    if (!confirm("Delete this room? (Columns/cells will be deleted by cascade)")) return;
    const del = await supabase.from("rooms").delete().eq("id", roomId);
    if (del.error) return setErr(del.error.message);
    setRooms((prev) => prev.filter((r) => r.id !== roomId));
  }

  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <div className="h1">Rooms</div>
          <div className="muted">
            Household: <span style={{ fontWeight: 900 }}>{household?.name ?? "…"}</span>
          </div>
        </div>
        <div className="headerOps">
          <button className="pill ghost" onClick={signOut}>Sign out</button>
        </div>
      </div>

      {err && <div className="alert">{err}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="h2" style={{ marginBottom: 8 }}>Create room</div>
        <div className="row">
          <input className="input" value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="e.g. Kitchen / Living room / Bathroom 1" />
          <button className="btn primary" onClick={addRoom} disabled={!newRoomName.trim()}>
            Add
          </button>
        </div>
      </div>

      <div className="grid">
        {rooms.map((r) => (
          <div key={r.id} className="card roomCard">
            <button className="roomGo" onClick={() => router.push(`/rooms/${r.id}`)}>
              <div className="roomName">{r.name}</div>
              <div className="roomMeta">Open</div>
            </button>

            <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="pill" onClick={() => renameRoom(r.id, r.name)}>Rename</button>
              <button className="pill ghost" onClick={() => deleteRoom(r.id)}>Delete</button>
            </div>
          </div>
        ))}
        {rooms.length === 0 && <div className="muted">No rooms yet. Create one above.</div>}
      </div>
    </div>
  );
}
