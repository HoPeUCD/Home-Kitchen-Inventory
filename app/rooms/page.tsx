"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import AuthGate from "@/components/AuthGate";

type HouseholdRow = { household_id: string; households: { id: string; name: string } | null };
type Room = { id: string; household_id: string; name: string; position: number };

export default function RoomsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const user: User | null = session?.user ?? null;

  const [household, setHousehold] = useState<{ id: string; name: string } | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [newRoomName, setNewRoomName] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) setSession(data.session);
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
      .select("household_id, households:households(id,name)")
      .eq("user_id", u.id)
      .limit(1)
      .single();

    if (hm.error) {
      setErr(`Household load failed: ${hm.error.message}`);
      return;
    }

    const row = hm.data as unknown as HouseholdRow;
    const hid = row.household_id;
    const h = row.households;
    if (!hid || !h) {
      setErr("No household found. (Check trigger handle_new_user_v2)");
      return;
    }
    setHousehold({ id: h.id, name: h.name });

    const r = await supabase.from("rooms").select("id,household_id,name,position").eq("household_id", hid).order("position", { ascending: true });

    if (r.error) {
      setErr(`Rooms load failed: ${r.error.message}`);
      return;
    }
    setRooms((r.data as Room[]) ?? []);
  }

  useEffect(() => {
    if (!user) return;
    loadHouseholdAndRooms(user);
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

    if (ins.error) {
      setErr(ins.error.message);
      return;
    }
    setRooms((prev) => [...prev, ins.data as Room].sort((a, b) => a.position - b.position));
    setNewRoomName("");
  }

  async function renameRoom(roomId: string, name: string) {
    if (!name.trim()) return;
    const up = await supabase.from("rooms").update({ name: name.trim() }).eq("id", roomId);
    if (up.error) return setErr(up.error.message);
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, name: name.trim() } : r)));
  }

  async function deleteRoom(roomId: string) {
    const del = await supabase.from("rooms").delete().eq("id", roomId);
    if (del.error) return setErr(del.error.message);
    setRooms((prev) => prev.filter((r) => r.id !== roomId));
  }

  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  return (
    <div className="wrap">
      <header className="header">
        <div>
          <div className="title">Rooms</div>
          <div className="sub">
            Household: <span className="mono">{household?.name ?? "…"}</span>
          </div>
        </div>
        <button className="pill ghost" onClick={signOut}>
          Sign out
        </button>
      </header>

      {err && (
        <div className="errBox">
          <div className="errTitle">Error</div>
          <div className="errLine">{err}</div>
        </div>
      )}

      <div className="card">
        <div className="cardTitle">Create room</div>
        <div className="row">
          <input className="input" value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="e.g. Kitchen / Living room / Bathroom 1" />
          <button className="primary" onClick={addRoom} disabled={!newRoomName.trim()}>
            Add
          </button>
        </div>
      </div>

      <div className="grid">
        {rooms.map((r) => (
          <div key={r.id} className="roomCard">
            <button className="roomGo" onClick={() => router.push(`/rooms/${r.id}`)}>
              <div className="roomName">{r.name}</div>
              <div className="roomMeta">Open</div>
            </button>

            <div className="roomOps">
              <button className="pill" onClick={() => {
                const v = prompt("Rename room:", r.name);
                if (v !== null) renameRoom(r.id, v);
              }}>
                Rename
              </button>
              <button className="pill ghost" onClick={() => {
                if (confirm("Delete this room? (Columns/cells/items inside will be deleted due to cascading)")) {
                  deleteRoom(r.id);
                }
              }}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {rooms.length === 0 && <div className="empty">No rooms yet. Create one above.</div>}
      </div>

      <style jsx global>{`
        :root {
          --bg: #fbf7f0;
          --panel: #fffaf2;
          --panel2: #fffdf7;
          --text: #1f2328;
          --muted: #6b6f76;
          --border: #e7ddcf;
          --border2: #efe6d9;
          --blue: #2f5d7c;
          --shadow: 0 10px 24px rgba(31, 35, 40, 0.06);
          --radius: 14px;
        }
        body { margin:0; background:var(--bg); color:var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }
        .wrap { padding: 16px; }
        .header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom: 12px; }
        .title { font-weight: 900; font-size: 20px; }
        .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
        .pill { padding: 8px 10px; border-radius: 999px; border: 1px solid rgba(47, 93, 124, 0.25); background: rgba(47, 93, 124, 0.08); color: var(--blue); font-weight: 900; font-size: 12px; cursor:pointer; }
        .pill.ghost { background: transparent; border-color: var(--border); color: rgba(31,35,40,0.75); }
        .primary { padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(47, 93, 124, 0.35); background: var(--blue); color: #fff; font-weight: 900; cursor: pointer; }
        .primary:disabled { opacity: .6; cursor:not-allowed; }
        .input { padding: 10px; border-radius: 12px; border: 1px solid var(--border); background: var(--panel2); width: 100%; font-size: 14px; }
        .input:focus { outline:none; border-color: rgba(47,93,124,.5); box-shadow: 0 0 0 4px rgba(47,93,124,.12); }
        .card { border:1px solid var(--border2); background: var(--panel); border-radius: var(--radius); box-shadow: var(--shadow); padding: 12px; margin-bottom: 12px; }
        .cardTitle { font-size: 12px; font-weight: 900; margin-bottom: 8px; }
        .row { display:flex; gap: 10px; align-items:center; }
        .grid { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
        .roomCard { border:1px solid var(--border2); background: var(--panel); border-radius: var(--radius); box-shadow: var(--shadow); padding: 12px; display:grid; gap: 10px; }
        .roomGo { border:1px solid var(--border); background: var(--panel2); border-radius: 12px; padding: 12px; cursor:pointer; text-align:left; display:flex; justify-content:space-between; align-items:center; gap: 10px; }
        .roomName { font-weight: 900; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .roomMeta { font-size: 12px; color: var(--muted); font-weight: 900; }
        .roomOps { display:flex; gap: 8px; flex-wrap: wrap; }
        .empty { color: var(--muted); font-size: 13px; padding: 12px; }
        .errBox { border: 1px solid #f0caca; background: #fff1f1; border-radius: var(--radius); padding: 12px; margin-bottom: 12px; }
        .errTitle { font-weight: 900; margin-bottom: 6px; }
        .errLine { font-size: 12px; color: rgba(31,35,40,.85); }
        @media (max-width: 900px) {
          .grid { grid-template-columns: 1fr; }
          .row { flex-direction: column; align-items: stretch; }
          .wrap { padding: 12px; }
        }
      `}</style>
    </div>
  );
}
