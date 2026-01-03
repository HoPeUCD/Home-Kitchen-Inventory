"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "@/src/components/AuthGate";
import { supabase } from "@/src/lib/supabase";

// ====== 你确认过的 items_v2 字段 ======
const ITEMS_TABLE = "items_v2";
const ITEM_ID_FIELD = "id";
const ITEM_HOUSEHOLD_FIELD = "household_id";
const ITEM_CELL_FIELD = "cell_id";

// localStorage key（你已确认）
const ACTIVE_HOUSEHOLD_KEY = "active_household_id";

type Household = { id: string; name: string; join_code: string | null };
type Room = { id: string; household_id: string; name: string; position?: number };
type Column = { id: string; room_id: string; name: string; position: number };
type Cell = { id: string; column_id: string; code: string; position: number };

const COLORS = {
  oatBg: "#F4EBDD",
  oatCard: "#FBF6EC",
  blue: "#2D6CDF",
  ink: "#1E2430",
  border: "rgba(30,36,48,.12)",
  muted: "rgba(30,36,48,.65)",
};

function safeGetLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSetLS(key: string, val: string | null) {
  try {
    if (!val) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch {}
}

export default function RoomsPage() {
  const router = useRouter();

  const [session, setSession] = useState<any>(null);
  const user = session?.user ?? null;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [defaultHouseholdId, setDefaultHouseholdId] = useState<string | null>(null);
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(null);

  const [household, setHousehold] = useState<Household | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);

  // Create room
  const [newRoomName, setNewRoomName] = useState("");

  // Edit room
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingRoomName, setEditingRoomName] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function ensureProfileRow() {
    if (!user?.id) return;
    await supabase.from("profiles").upsert({ user_id: user.id }, { onConflict: "user_id" });
  }

  async function loadRoomsContext() {
    if (!user?.id) return;

    setLoading(true);
    setErr(null);

    try {
      await ensureProfileRow();

      // membership
      const memRes = await supabase.from("household_members").select("household_id").eq("user_id", user.id);
      if (memRes.error) throw new Error(memRes.error.message);
      const mems = memRes.data ?? [];
      const myHids = new Set(mems.map((m: any) => m.household_id as string));

      // default household
      const profRes = await supabase
        .from("profiles")
        .select("default_household_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profRes.error) throw new Error(profRes.error.message);

      const def = (profRes.data?.default_household_id as string | null) ?? null;
      setDefaultHouseholdId(def);

      // local active household
      let active = safeGetLS(ACTIVE_HOUSEHOLD_KEY);
      if (active && !myHids.has(active)) {
        safeSetLS(ACTIVE_HOUSEHOLD_KEY, null);
        active = null;
      }

      let hid: string | null = active || def;

      if (!hid) {
        if (mems.length === 0) {
          router.replace("/onboarding");
          return;
        }
        if (mems.length === 1) {
          hid = mems[0].household_id;
          const rpc = await supabase.rpc("set_default_household", { p_household_id: hid });
          if (rpc.error) throw new Error(rpc.error.message);
          setDefaultHouseholdId(hid);
        } else {
          router.replace("/households");
          return;
        }
      }

      setActiveHouseholdId(hid);

      // household
      const hRes = await supabase.from("households").select("id,name,join_code").eq("id", hid).single();
      if (hRes.error) throw new Error(hRes.error.message);
      setHousehold(hRes.data as Household);

      // rooms
      const rRes = await supabase
        .from("rooms")
        .select("id,household_id,name,position")
        .eq("household_id", hid)
        .order("position", { ascending: true });
      if (rRes.error) throw new Error(rRes.error.message);
      setRooms((rRes.data as Room[]) ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load rooms.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.id) return;
    loadRoomsContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const modeLabel = useMemo(() => {
    if (!household?.id) return "";
    if (defaultHouseholdId && household.id === defaultHouseholdId) return "default";
    return "temporary";
  }, [household?.id, defaultHouseholdId]);

  // ====== Room create / edit / delete ======

  async function createRoom() {
    if (!activeHouseholdId) return;
    const nm = newRoomName.trim();
    if (!nm) return;

    setBusy(true);
    setErr(null);

    try {
      const nextPos = (rooms.reduce((m, r) => Math.max(m, r.position ?? 0), 0) || 0) + 1;
      const ins = await supabase
        .from("rooms")
        .insert({ household_id: activeHouseholdId, name: nm, position: nextPos })
        .select("id,household_id,name,position")
        .single();

      if (ins.error) throw new Error(ins.error.message);

      setRooms((prev) => [...prev, ins.data as Room].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));
      setNewRoomName("");
    } catch (e: any) {
      setErr(e?.message ?? "Create room failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRoomName(roomId: string) {
    const nm = editingRoomName.trim();
    if (!nm) return;

    setBusy(true);
    setErr(null);

    try {
      const upd = await supabase
        .from("rooms")
        .update({ name: nm })
        .eq("id", roomId)
        .select("id,household_id,name,position")
        .single();

      if (upd.error) throw new Error(upd.error.message);

      setRooms((prev) => prev.map((r) => (r.id === roomId ? (upd.data as Room) : r)));
      setEditingRoomId(null);
      setEditingRoomName("");
    } catch (e: any) {
      setErr(e?.message ?? "Update room failed.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * ✅ 删除 room：默认级联删除
   * - room_columns where room_id=...
   * - room_cells where column_id in (...)
   * - items_v2 where cell_id in (...)
   * - 然后删 cells/columns/room
   */
  async function deleteRoom(room: Room) {
    const ok = window.confirm(
      `Delete room "${room.name}"?\n\nThis will delete ALL columns, cells, and items inside this room.`
    );
    if (!ok) return;

    setBusy(true);
    setErr(null);

    try {
      // 1) columns in room
      const colRes = await supabase
        .from("room_columns")
        .select("id,room_id,name,position")
        .eq("room_id", room.id);

      if (colRes.error) throw new Error(colRes.error.message);
      const cols = (colRes.data as Column[]) ?? [];
      const colIds = cols.map((c) => c.id);

      // 2) cells in those columns
      let cellIds: string[] = [];
      if (colIds.length > 0) {
        const cellRes = await supabase
          .from("room_cells")
          .select("id,column_id,code,position")
          .in("column_id", colIds);

        if (cellRes.error) throw new Error(cellRes.error.message);
        const cs = (cellRes.data as Cell[]) ?? [];
        cellIds = cs.map((c) => c.id);
      }

      // 3) delete items in those cells
      if (cellIds.length > 0) {
        const delItems = await supabase.from(ITEMS_TABLE).delete().in(ITEM_CELL_FIELD, cellIds);
        if (delItems.error) throw new Error(delItems.error.message);

        const delCells = await supabase.from("room_cells").delete().in("id", cellIds);
        if (delCells.error) throw new Error(delCells.error.message);
      }

      // 4) delete columns
      if (colIds.length > 0) {
        const delCols = await supabase.from("room_columns").delete().in("id", colIds);
        if (delCols.error) throw new Error(delCols.error.message);
      }

      // 5) delete room
      const delRoom = await supabase.from("rooms").delete().eq("id", room.id);
      if (delRoom.error) throw new Error(delRoom.error.message);

      setRooms((prev) => prev.filter((r) => r.id !== room.id));
    } catch (e: any) {
      setErr(e?.message ?? "Delete room failed.");
    } finally {
      setBusy(false);
    }
  }

  // ====== early return (after hooks) ======
  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.oatBg, color: COLORS.ink }}>
      <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
        {/* Top bar */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Rooms</div>

            <button
              onClick={() => router.push("/households")}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: `1px solid ${COLORS.border}`,
                background: "white",
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Switch household
            </button>

            <button
              onClick={() => loadRoomsContext()}
              disabled={busy}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: `1px solid ${COLORS.border}`,
                background: "white",
                cursor: "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              Refresh
            </button>
          </div>

          <button
            onClick={async () => {
              safeSetLS(ACTIVE_HOUSEHOLD_KEY, null);
              await supabase.auth.signOut();
              router.replace("/");
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
              background: "white",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            Sign out
          </button>
        </div>

        {/* Household info */}
        {household ? (
          <div style={{ marginBottom: 12, color: COLORS.muted }}>
            Household: <span style={{ fontWeight: 900, color: COLORS.ink }}>{household.name}</span>{" "}
            <span style={{ fontWeight: 900 }}>({modeLabel})</span>
            {household.join_code ? (
              <>
                {" "}
                · Join code: <span style={{ fontWeight: 900, color: COLORS.ink }}>{household.join_code}</span>
              </>
            ) : null}
          </div>
        ) : null}

        {err ? (
          <div style={{ marginBottom: 12, color: "crimson", fontWeight: 900 }}>
            {err}
          </div>
        ) : null}

        {loading ? (
          <div style={{ opacity: 0.85 }}>Loading…</div>
        ) : (
          <>
            {/* Create room */}
            <div
              style={{
                background: COLORS.oatCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 16,
                padding: 14,
                marginBottom: 12,
              }}
            >
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Create a room</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder='Examples: Kitchen, Living Room, Bathroom 1'
                  style={{
                    flex: "1 1 260px",
                    padding: 10,
                    borderRadius: 12,
                    border: `1px solid ${COLORS.border}`,
                    background: "white",
                  }}
                />
                <button
                  onClick={createRoom}
                  disabled={busy || !newRoomName.trim()}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    fontWeight: 900,
                    background: COLORS.blue,
                    color: "white",
                    border: "none",
                    cursor: "pointer",
                    opacity: busy || !newRoomName.trim() ? 0.6 : 1,
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            {/* Rooms list */}
            <div style={{ display: "grid", gap: 12 }}>
              {rooms.length === 0 ? (
                <div style={{ color: COLORS.muted }}>No rooms yet. Create one above.</div>
              ) : (
                rooms.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      background: "white",
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 16,
                      padding: 14,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    {/* Left: name / edit */}
                    <div style={{ minWidth: 220, flex: "1 1 260px" }}>
                      {editingRoomId === r.id ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <input
                            value={editingRoomName}
                            onChange={(e) => setEditingRoomName(e.target.value)}
                            style={{
                              flex: "1 1 220px",
                              padding: 10,
                              borderRadius: 12,
                              border: `1px solid ${COLORS.border}`,
                              background: "white",
                              fontWeight: 900,
                            }}
                          />
                          <button
                            onClick={() => saveRoomName(r.id)}
                            disabled={busy || !editingRoomName.trim()}
                            style={{
                              padding: "10px 12px",
                              borderRadius: 12,
                              fontWeight: 900,
                              background: COLORS.blue,
                              color: "white",
                              border: "none",
                              cursor: "pointer",
                              opacity: busy || !editingRoomName.trim() ? 0.6 : 1,
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingRoomId(null);
                              setEditingRoomName("");
                            }}
                            style={{
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: `1px solid ${COLORS.border}`,
                              background: "white",
                              cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontWeight: 900, fontSize: 16 }}>{r.name}</div>
                          <div style={{ color: COLORS.muted, fontSize: 12 }}>room_id: {r.id}</div>
                        </>
                      )}
                    </div>

                    {/* Right: actions */}
                    {editingRoomId !== r.id ? (
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <button
                          onClick={() => router.push(`/rooms/${r.id}`)}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: `1px solid ${COLORS.border}`,
                            background: COLORS.oatCard,
                            cursor: "pointer",
                            fontWeight: 900,
                          }}
                        >
                          Open
                        </button>

                        <button
                          onClick={() => {
                            setEditingRoomId(r.id);
                            setEditingRoomName(r.name);
                          }}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: `1px solid ${COLORS.border}`,
                            background: "white",
                            cursor: "pointer",
                            fontWeight: 900,
                          }}
                        >
                          Edit
                        </button>

                        <button
                          onClick={() => deleteRoom(r)}
                          disabled={busy}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: `1px solid rgba(220,0,0,.25)`,
                            background: "rgba(220,0,0,.06)",
                            color: "crimson",
                            cursor: "pointer",
                            fontWeight: 900,
                            opacity: busy ? 0.6 : 1,
                          }}
                        >
                          Del
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            <div style={{ marginTop: 14, color: COLORS.muted, fontSize: 12 }}>
              Tip: Delete room will remove all columns/cells/items in that room. If you want “archive room” instead, tell me and I’ll add it.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
