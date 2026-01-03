"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGate from "@/src/components/AuthGate";
import { supabase } from "@/src/lib/supabase";

/** =========================
 *  CONFIG: 你的真实数据库列名（已按你最新确认）
 *  ========================= */
const ITEMS_TABLE = "items_v2";
const ITEM_ID_FIELD = "id";
const ITEM_HOUSEHOLD_FIELD = "household_id";
const ITEM_CELL_FIELD = "cell_id";
const ITEM_NAME_FIELD = "name";
const ITEM_QTY_FIELD = "qty";
const ITEM_EXPIRE_FIELD = "expires_at";
const ITEM_IMG_FIELD = "image_path";

const ACTIVE_HOUSEHOLD_KEY = "active_household_id";

const COLORS = {
  oatBg: "#F4EBDD",
  oatCard: "#FBF6EC",
  blue: "#2D6CDF",
  ink: "#1E2430",
  border: "rgba(30,36,48,.12)",
  muted: "rgba(30,36,48,.65)",
  expiredBg: "rgba(220, 38, 38, .18)",
  soonBg: "rgba(234, 179, 8, .22)",
  okBg: "rgba(45, 108, 223, .10)",
};

type Household = { id: string; name: string; join_code: string | null };
type Room = { id: string; household_id: string; name: string; position?: number };
type Column = { id: string; room_id: string; name: string; position: number };
type Cell = { id: string; column_id: string; code: string; position: number };

type Item = {
  id: string;
  household_id: string;
  cell_id: string;
  name: string;
  qty: number;
  expires_at?: string | null;
  image_path?: string | null;
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

function toDateOnly(d: string): Date {
  return new Date(`${d}T00:00:00`);
}
function daysUntil(expiresAt?: string | null): number | null {
  if (!expiresAt) return null;
  const d = toDateOnly(expiresAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = d.getTime() - today.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
function urgencyRank(it: Item): number {
  const du = daysUntil(it.expires_at ?? null);
  if (du === null) return 3;
  if (du < 0) return 0;
  if (du <= 30) return 1;
  return 2;
}
function chipBg(it: Item): string {
  const du = daysUntil(it.expires_at ?? null);
  if (du === null) return COLORS.okBg;
  if (du < 0) return COLORS.expiredBg;
  if (du <= 30) return COLORS.soonBg;
  return COLORS.okBg;
}
function sortItemsByExpiry(a: Item, b: Item): number {
  const ra = urgencyRank(a);
  const rb = urgencyRank(b);
  if (ra !== rb) return ra - rb;

  const da = daysUntil(a.expires_at ?? null);
  const db = daysUntil(b.expires_at ?? null);

  if (da === null && db !== null) return 1;
  if (da !== null && db === null) return -1;
  if (da !== null && db !== null && da !== db) return da - db;

  return a.name.localeCompare(b.name);
}

// --- 模糊搜索（客户端） ---
function normalize(s: string): string {
  return (s || "").toLowerCase().trim();
}
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}
function fuzzyMatch(query: string, text: string): boolean {
  const q = normalize(query);
  const t = normalize(text);
  if (!q) return true;
  if (t.includes(q)) return true;

  const qTokens = q.split(/\s+/).filter(Boolean);
  const tTokens = t.split(/\s+/).filter(Boolean);

  let hits = 0;
  for (const qt of qTokens) {
    if (tTokens.some((tt) => tt.includes(qt))) hits++;
  }
  if (hits > 0 && hits >= Math.max(1, Math.ceil(qTokens.length * 0.5))) return true;

  if (q.length <= 6) {
    const dist = levenshtein(q, t.slice(0, Math.min(t.length, 12)));
    if (dist <= 2) return true;
  }
  return false;
}

function normalizeItemRow(row: any): Item {
  const qtyNum = Number(row?.[ITEM_QTY_FIELD] ?? 0);
  return {
    id: String(row?.[ITEM_ID_FIELD]),
    household_id: String(row?.[ITEM_HOUSEHOLD_FIELD]),
    cell_id: String(row?.[ITEM_CELL_FIELD]),
    name: String(row?.[ITEM_NAME_FIELD] ?? ""),
    qty: Number.isFinite(qtyNum) ? qtyNum : 0,
    expires_at: row?.[ITEM_EXPIRE_FIELD] ?? null,
    image_path: row?.[ITEM_IMG_FIELD] ?? null,
  };
}

/** 防止 Enter 在 IME 输入中误触发提交 */
function isComposingEvent(e: any): boolean {
  return Boolean(e?.nativeEvent?.isComposing) || Boolean(e?.isComposing);
}

export default function RoomPage() {
  const router = useRouter();
  const params = useParams();
  const roomId = (params as any)?.roomId as string;

  const [session, setSession] = useState<any>(null);
  const user = session?.user ?? null;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [defaultHouseholdId, setDefaultHouseholdId] = useState<string | null>(null);
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(null);

  const [household, setHousehold] = useState<Household | null>(null);
  const [room, setRoom] = useState<Room | null>(null);

  const [columns, setColumns] = useState<Column[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  // household-level layout (all rooms / columns / cells)
  const [hhRooms, setHhRooms] = useState<Room[]>([]);
  const [hhColumns, setHhColumns] = useState<Column[]>([]);
  const [hhCells, setHhCells] = useState<Cell[]>([]);

  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const [newColumnName, setNewColumnName] = useState("");
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingColumnName, setEditingColumnName] = useState("");

  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [editingCellCode, setEditingCellCode] = useState("");

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemQty, setItemQty] = useState<number>(1);
  const [itemExpire, setItemExpire] = useState<string>("");
  const [itemCellId, setItemCellId] = useState<string>("");

  // 两级联动 location：先选 room，再选 cell
  const [locationRoomId, setLocationRoomId] = useState<string>("");

  const cellRefMap = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Esc 关闭 modal（桌面很实用；移动端不影响）
  useEffect(() => {
    if (!itemModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setItemModalOpen(false);
        setEditingItem(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [itemModalOpen]);

  async function ensureProfileRow() {
    if (!user?.id) return;
    await supabase.from("profiles").upsert({ user_id: user.id }, { onConflict: "user_id" });
  }

  async function loadContextAndData() {
    if (!user?.id) return;

    setLoading(true);
    setErr(null);

    try {
      await ensureProfileRow();

      const memRes = await supabase.from("household_members").select("household_id").eq("user_id", user.id);
      if (memRes.error) throw new Error(memRes.error.message);
      const mems = memRes.data ?? [];
      const myHids = new Set(mems.map((m: any) => m.household_id as string));

      const profRes = await supabase
        .from("profiles")
        .select("default_household_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profRes.error) throw new Error(profRes.error.message);

      const def = (profRes.data?.default_household_id as string | null) ?? null;
      setDefaultHouseholdId(def);

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

      const hRes = await supabase.from("households").select("id,name,join_code").eq("id", hid).single();
      if (hRes.error) throw new Error(hRes.error.message);
      setHousehold(hRes.data as Household);

      // Household rooms/columns/cells
      const hhRoomRes = await supabase
        .from("rooms")
        .select("id,household_id,name,position")
        .eq("household_id", hid)
        .order("position", { ascending: true });
      if (hhRoomRes.error) throw new Error(hhRoomRes.error.message);
      const allRooms = (hhRoomRes.data as Room[]) ?? [];
      setHhRooms(allRooms);

      const roomIds = allRooms.map((r) => r.id);
      let allCols: Column[] = [];
      let allCells: Cell[] = [];

      if (roomIds.length > 0) {
        const hhColRes = await supabase
          .from("room_columns")
          .select("id,room_id,name,position")
          .in("room_id", roomIds)
          .order("room_id", { ascending: true })
          .order("position", { ascending: true });
        if (hhColRes.error) throw new Error(hhColRes.error.message);
        allCols = (hhColRes.data as Column[]) ?? [];
        setHhColumns(allCols);

        const colIds = allCols.map((c) => c.id);
        if (colIds.length > 0) {
          const hhCellRes = await supabase
            .from("room_cells")
            .select("id,column_id,code,position")
            .in("column_id", colIds)
            .order("column_id", { ascending: true })
            .order("position", { ascending: true });
          if (hhCellRes.error) throw new Error(hhCellRes.error.message);
          allCells = (hhCellRes.data as Cell[]) ?? [];
          setHhCells(allCells);
        } else {
          setHhCells([]);
        }
      } else {
        setHhColumns([]);
        setHhCells([]);
      }

      // Current room
      const roomRes = await supabase
        .from("rooms")
        .select("id,household_id,name,position")
        .eq("id", roomId)
        .eq("household_id", hid)
        .maybeSingle();
      if (roomRes.error) throw new Error(roomRes.error.message);
      if (!roomRes.data) {
        setRoom(null);
        setColumns([]);
        setCells([]);
        setItems([]);
        throw new Error("Room not found in the current household. Use Rooms or Switch household.");
      }
      setRoom(roomRes.data as Room);

      const colRes = await supabase
        .from("room_columns")
        .select("id,room_id,name,position")
        .eq("room_id", roomId)
        .order("position", { ascending: true });
      if (colRes.error) throw new Error(colRes.error.message);

      const cols = (colRes.data as Column[]) ?? [];
      setColumns(cols);

      const curColIds = cols.map((c) => c.id);
      if (curColIds.length === 0) {
        setCells([]);
      } else {
        const cellRes = await supabase
          .from("room_cells")
          .select("id,column_id,code,position")
          .in("column_id", curColIds)
          .order("column_id", { ascending: true })
          .order("position", { ascending: true });
        if (cellRes.error) throw new Error(cellRes.error.message);
        setCells((cellRes.data as Cell[]) ?? []);
      }

      // Items across household
      const hhCellIds = allCells.map((c) => c.id);
      if (hhCellIds.length === 0) {
        setItems([]);
      } else {
        const selectCols = [
          ITEM_ID_FIELD,
          ITEM_HOUSEHOLD_FIELD,
          ITEM_CELL_FIELD,
          ITEM_NAME_FIELD,
          ITEM_QTY_FIELD,
          ITEM_EXPIRE_FIELD,
          ITEM_IMG_FIELD,
        ].join(",");

        const itemRes = await supabase
          .from(ITEMS_TABLE)
          .select(selectCols)
          .eq(ITEM_HOUSEHOLD_FIELD, hid)
          .in(ITEM_CELL_FIELD, hhCellIds);

        if (itemRes.error) throw new Error(itemRes.error.message);
        setItems((itemRes.data ?? []).map(normalizeItemRow));
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load room.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.id || !roomId) return;
    loadContextAndData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, roomId]);

  const columnsWithCells = useMemo(() => {
    const byCol: Record<string, Cell[]> = {};
    for (const c of cells) {
      byCol[c.column_id] = byCol[c.column_id] || [];
      byCol[c.column_id].push(c);
    }
    for (const k of Object.keys(byCol)) byCol[k].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return columns.map((col) => ({ col, cells: byCol[col.id] || [] }));
  }, [columns, cells]);

  const itemsByCell = useMemo(() => {
    const map: Record<string, Item[]> = {};
    const curCellIds = new Set(cells.map((c) => c.id));
    for (const it of items) {
      if (Number(it.qty ?? 0) <= 0) continue;
      if (!curCellIds.has(it.cell_id)) continue;
      map[it.cell_id] = map[it.cell_id] || [];
      map[it.cell_id].push(it);
    }
    for (const k of Object.keys(map)) map[k].sort(sortItemsByExpiry);
    return map;
  }, [items, cells]);

  const hhIndex = useMemo(() => {
    const roomById = new Map(hhRooms.map((r) => [r.id, r]));
    const colById = new Map(hhColumns.map((c) => [c.id, c]));
    const m = new Map<
      string,
      { roomId: string; roomName: string; colId: string; colName: string; cellCode: string; label: string }
    >();

    for (const ce of hhCells) {
      const col = colById.get(ce.column_id);
      const room = roomById.get(col?.room_id ?? "");
      const roomName = room?.name ?? "Room";
      const colName = col?.name ?? "Column";
      const label = `${roomName} / ${colName} / ${ce.code}`;
      m.set(ce.id, {
        roomId: room?.id ?? "",
        roomName,
        colId: col?.id ?? "",
        colName,
        cellCode: ce.code,
        label,
      });
    }
    return m;
  }, [hhRooms, hhColumns, hhCells]);

  const expiring0to7 = useMemo(() => {
    return items
      .filter((it) => it.qty > 0)
      .map((it) => ({ it, du: daysUntil(it.expires_at ?? null) }))
      .filter(({ du }) => du !== null && du >= 0 && du <= 7)
      .sort((a, b) => (a.du! - b.du!) || a.it.name.localeCompare(b.it.name));
  }, [items]);

  const expiring8to30 = useMemo(() => {
    return items
      .filter((it) => it.qty > 0)
      .map((it) => ({ it, du: daysUntil(it.expires_at ?? null) }))
      .filter(({ du }) => du !== null && du >= 8 && du <= 30)
      .sort((a, b) => (a.du! - b.du!) || a.it.name.localeCompare(b.it.name));
  }, [items]);

  function expLine(it: Item, du: number) {
    const loc = hhIndex.get(it.cell_id);
    const where = loc ? `${loc.roomName} / ${loc.colName} / ${loc.cellCode}` : "Unknown";
    return `${it.name} — ${where} (in ${du}d)`;
  }

  function goToCell(it: Item) {
    const loc = hhIndex.get(it.cell_id);
    if (!loc?.roomId) return;
    if (loc.roomId === roomId) {
      const ref = cellRefMap.current[it.cell_id];
      if (ref) ref.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      return;
    }
    router.push(`/rooms/${loc.roomId}`);
  }

  const filteredItemsSummary = useMemo(() => {
    const q = search.trim();
    if (!q) return [];
    return items
      .filter((it) => it.qty > 0)
      .filter((it) => fuzzyMatch(q, it.name))
      .slice(0, 50)
      .map((it) => ({ it, loc: hhIndex.get(it.cell_id) }));
  }, [search, items, hhIndex]);

  // 两级联动：Room -> Cells (按 code 字母顺序 / numeric)
  const roomCellOptions = useMemo(() => {
    const rid = locationRoomId;
    if (!rid) return [];

    const list = hhCells
      .map((c) => {
        const loc = hhIndex.get(c.id);
        if (!loc || loc.roomId !== rid) return null;
        return { cell: c, loc };
      })
      .filter(Boolean) as { cell: Cell; loc: any }[];

    list.sort((a, b) => {
      const c = a.loc.cellCode.localeCompare(b.loc.cellCode, undefined, { numeric: true, sensitivity: "base" });
      if (c !== 0) return c;
      return a.loc.colName.localeCompare(b.loc.colName, undefined, { numeric: true, sensitivity: "base" });
    });

    return list.map(({ cell, loc }) => ({
      id: cell.id,
      code: loc.cellCode as string,
      label: `${loc.colName} / ${loc.cellCode}` as string,
    }));
  }, [locationRoomId, hhCells, hhIndex]);

  function openAddItem(cellId: string) {
    setEditingItem(null);
    setItemName("");
    setItemQty(1);
    setItemExpire("");
    setItemCellId(cellId);

    setLocationRoomId(roomId);

    setItemModalOpen(true);
  }

  function openEditItem(it: Item) {
    setEditingItem(it);
    setItemName(it.name ?? "");
    setItemQty(Number(it.qty ?? 1));
    setItemExpire(it.expires_at ?? "");
    setItemCellId(it.cell_id);

    const loc = hhIndex.get(it.cell_id);
    setLocationRoomId(loc?.roomId || roomId);

    setItemModalOpen(true);
  }

  async function saveItem() {
    if (!user?.id || !activeHouseholdId) return;

    const nm = itemName.trim();
    if (!nm) return setErr("Item name required.");
    if (!itemCellId) return setErr("Cell required.");

    setBusy(true);
    setErr(null);

    try {
      const payload: any = {};
      payload[ITEM_HOUSEHOLD_FIELD] = activeHouseholdId;
      payload[ITEM_CELL_FIELD] = itemCellId;
      payload[ITEM_NAME_FIELD] = nm;
      payload[ITEM_QTY_FIELD] = Number(itemQty ?? 0);
      payload[ITEM_EXPIRE_FIELD] = itemExpire ? itemExpire : null;

      const selectCols = [
        ITEM_ID_FIELD,
        ITEM_HOUSEHOLD_FIELD,
        ITEM_CELL_FIELD,
        ITEM_NAME_FIELD,
        ITEM_QTY_FIELD,
        ITEM_EXPIRE_FIELD,
        ITEM_IMG_FIELD,
      ].join(",");

      if (!editingItem) {
        const ins = await supabase.from(ITEMS_TABLE).insert(payload).select(selectCols).single();
        if (ins.error) throw new Error(ins.error.message);
        setItems((prev) => [...prev, normalizeItemRow(ins.data)]);
      } else {
        const upd = await supabase
          .from(ITEMS_TABLE)
          .update(payload)
          .eq(ITEM_ID_FIELD, editingItem.id)
          .select(selectCols)
          .single();
        if (upd.error) throw new Error(upd.error.message);
        setItems((prev) => prev.map((x) => (x.id === editingItem.id ? normalizeItemRow(upd.data) : x)));
      }

      setItemModalOpen(false);
      setEditingItem(null);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  // Delete：成功后关掉 edit modal
  async function deleteItem(itemId: string) {
    setBusy(true);
    setErr(null);
    try {
      const del = await supabase.from(ITEMS_TABLE).delete().eq(ITEM_ID_FIELD, itemId);
      if (del.error) throw new Error(del.error.message);

      setItems((prev) => prev.filter((x) => x.id !== itemId));

      // ✅ 你要求：delete 后直接关闭 edit
      setItemModalOpen(false);
      setEditingItem(null);
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function addColumn() {
    if (!roomId) return;
    const nm = newColumnName.trim();
    if (!nm) return;

    setBusy(true);
    setErr(null);
    try {
      const nextPos = (columns.reduce((m, c) => Math.max(m, c.position ?? 0), 0) || 0) + 1;
      const ins = await supabase
        .from("room_columns")
        .insert({ room_id: roomId, name: nm, position: nextPos })
        .select("id,room_id,name,position")
        .single();
      if (ins.error) throw new Error(ins.error.message);
      setColumns((prev) => [...prev, ins.data as Column].sort((a, b) => a.position - b.position));
      setNewColumnName("");
    } catch (e: any) {
      setErr(e?.message ?? "Add column failed.");
    } finally {
      setBusy(false);
    }
  }

  async function renameColumn(colId: string) {
    const nm = editingColumnName.trim();
    if (!nm) return;

    setBusy(true);
    setErr(null);
    try {
      const upd = await supabase
        .from("room_columns")
        .update({ name: nm })
        .eq("id", colId)
        .select("id,room_id,name,position")
        .single();
      if (upd.error) throw new Error(upd.error.message);
      setColumns((prev) => prev.map((c) => (c.id === colId ? (upd.data as Column) : c)));
      setEditingColumnId(null);
      setEditingColumnName("");
    } catch (e: any) {
      setErr(e?.message ?? "Rename failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteColumn(col: Column) {
    const ok = window.confirm(`Delete column "${col.name}"?\n\nThis will delete ALL cells under it and their items.`);
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      const colCells = cells.filter((c) => c.column_id === col.id).map((c) => c.id);

      if (colCells.length > 0) {
        const delItems = await supabase.from(ITEMS_TABLE).delete().in(ITEM_CELL_FIELD, colCells);
        if (delItems.error) throw new Error(delItems.error.message);

        const delCells = await supabase.from("room_cells").delete().in("id", colCells);
        if (delCells.error) throw new Error(delCells.error.message);
      }

      const delCol = await supabase.from("room_columns").delete().eq("id", col.id);
      if (delCol.error) throw new Error(delCol.error.message);

      setItems((prev) => prev.filter((it) => !colCells.includes(it.cell_id)));
      setCells((prev) => prev.filter((c) => c.column_id !== col.id));
      setColumns((prev) => prev.filter((c) => c.id !== col.id));
    } catch (e: any) {
      setErr(e?.message ?? "Delete column failed.");
    } finally {
      setBusy(false);
    }
  }

  async function addCell(colId: string) {
    const existing = cells.filter((c) => c.column_id === colId);
    const nextPos = (existing.reduce((m, c) => Math.max(m, c.position ?? 0), 0) || 0) + 1;
    const code = `C${nextPos}`;

    setBusy(true);
    setErr(null);
    try {
      const ins = await supabase
        .from("room_cells")
        .insert({ column_id: colId, code, position: nextPos })
        .select("id,column_id,code,position")
        .single();
      if (ins.error) throw new Error(ins.error.message);
      setCells((prev) => [...prev, ins.data as Cell]);
      setHhCells((prev) => [...prev, ins.data as Cell]);
    } catch (e: any) {
      setErr(e?.message ?? "Add cell failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCellCode(cellId: string) {
    const next = editingCellCode.trim();
    if (!next) return;

    setBusy(true);
    setErr(null);
    try {
      const upd = await supabase
        .from("room_cells")
        .update({ code: next })
        .eq("id", cellId)
        .select("id,column_id,code,position")
        .single();
      if (upd.error) throw new Error(upd.error.message);

      setCells((prev) => prev.map((c) => (c.id === cellId ? (upd.data as Cell) : c)));
      setHhCells((prev) => prev.map((c) => (c.id === cellId ? (upd.data as Cell) : c)));

      setEditingCellId(null);
      setEditingCellCode("");
    } catch (e: any) {
      setErr(e?.message ?? "Edit cell failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCell(cell: Cell) {
    const ok = window.confirm(`Delete cell "${cell.code}"?\n\nThis will delete ALL items inside this cell.`);
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      const delItems = await supabase.from(ITEMS_TABLE).delete().eq(ITEM_CELL_FIELD, cell.id);
      if (delItems.error) throw new Error(delItems.error.message);

      const delCell = await supabase.from("room_cells").delete().eq("id", cell.id);
      if (delCell.error) throw new Error(delCell.error.message);

      setItems((prev) => prev.filter((it) => it.cell_id !== cell.id));
      setCells((prev) => prev.filter((c) => c.id !== cell.id));
      setHhCells((prev) => prev.filter((c) => c.id !== cell.id));
    } catch (e: any) {
      setErr(e?.message ?? "Delete cell failed.");
    } finally {
      setBusy(false);
    }
  }

  const modeLabel = useMemo(() => {
    if (!household?.id) return "";
    if (defaultHouseholdId && household.id === defaultHouseholdId) return "default";
    return "temporary";
  }, [household?.id, defaultHouseholdId]);

  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.oatBg, color: COLORS.ink }}>
      <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => router.push("/rooms")}
              style={{ padding: "8px 10px", borderRadius: 12, fontWeight: 900, border: `1px solid ${COLORS.border}`, background: "white" }}
            >
              Rooms
            </button>

            <button
              onClick={() => router.push("/households")}
              style={{ padding: "8px 10px", borderRadius: 12, fontWeight: 900, border: `1px solid ${COLORS.border}`, background: "white" }}
            >
              Switch household
            </button>

            <div style={{ fontWeight: 900, fontSize: 18 }}>{room?.name ?? "Room"}</div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => loadContextAndData()}
              disabled={busy}
              style={{ padding: "8px 10px", borderRadius: 12, border: `1px solid ${COLORS.border}`, background: "white", opacity: busy ? 0.6 : 1 }}
            >
              Refresh
            </button>
            <button
              onClick={async () => {
                safeSetLS(ACTIVE_HOUSEHOLD_KEY, null);
                await supabase.auth.signOut();
                router.replace("/");
              }}
              style={{ padding: "8px 10px", borderRadius: 12, border: `1px solid ${COLORS.border}`, background: "white" }}
            >
              Sign out
            </button>
          </div>
        </div>

        {household ? (
          <div style={{ marginBottom: 10, color: COLORS.muted }}>
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
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => loadContextAndData()}
                style={{ padding: "8px 10px", borderRadius: 12, border: `1px solid ${COLORS.border}`, background: "white" }}
              >
                Retry
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div style={{ opacity: 0.8 }}>Loading…</div>
        ) : (
          <>
            {/* Expiring soon */}
            <div style={{ background: COLORS.oatCard, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Expiring soon</div>

              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Within 7 days</div>
                  {expiring0to7.length === 0 ? (
                    <div style={{ color: COLORS.muted }}>None</div>
                  ) : (
                    <div style={{ display: "grid", gap: 4 }}>
                      {expiring0to7.slice(0, 40).map(({ it, du }) => (
                        <div key={it.id} style={{ cursor: "pointer" }} onClick={() => goToCell(it)}>
                          {expLine(it, du!)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>8 to 30 days</div>
                  {expiring8to30.length === 0 ? (
                    <div style={{ color: COLORS.muted }}>None</div>
                  ) : (
                    <div style={{ display: "grid", gap: 4 }}>
                      {expiring8to30.slice(0, 60).map(({ it, du }) => (
                        <div key={it.id} style={{ cursor: "pointer" }} onClick={() => goToCell(it)}>
                          {expLine(it, du!)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Search */}
            <div style={{ background: COLORS.oatCard, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Search items</div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type an item name (fuzzy match supported)"
                style={{ width: "100%", padding: 10, borderRadius: 12, border: `1px solid ${COLORS.border}`, background: "white" }}
              />
              {search.trim() ? (
                <div style={{ marginTop: 10, color: COLORS.muted }}>
                  {filteredItemsSummary.length === 0 ? (
                    <div>No matches.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 4 }}>
                      {filteredItemsSummary.map(({ it, loc }) => (
                        <div key={it.id} style={{ cursor: "pointer" }} onClick={() => goToCell(it)}>
                          <span style={{ fontWeight: 900, color: COLORS.ink }}>{it.name}</span>{" "}
                          <span>— {loc ? loc.label : "Unknown"} · qty {it.qty}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Add column */}
            <div style={{ background: COLORS.oatCard, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Add column</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  placeholder="Example: Pantry / Dresser / Shelf"
                  style={{ flex: "1 1 260px", padding: 10, borderRadius: 12, border: `1px solid ${COLORS.border}`, background: "white" }}
                />
                <button
                  onClick={addColumn}
                  disabled={!newColumnName.trim() || busy}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    fontWeight: 900,
                    background: COLORS.blue,
                    color: "white",
                    border: "none",
                    cursor: "pointer",
                    opacity: !newColumnName.trim() || busy ? 0.6 : 1,
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            {/* Columns */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", overflowX: "auto", paddingBottom: 6 }}>
              {columnsWithCells.map(({ col, cells }) => (
                <div
                  key={col.id}
                  style={{
                    minWidth: 290,
                    maxWidth: 320,
                    flex: "0 0 auto",
                    background: COLORS.oatCard,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 16,
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {/* Column header */}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    {editingColumnId === col.id ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
                        <input
                          value={editingColumnName}
                          onChange={(e) => setEditingColumnName(e.target.value)}
                          style={{ flex: 1, padding: 8, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "white" }}
                        />
                        <button
                          onClick={() => renameColumn(col.id)}
                          disabled={busy || !editingColumnName.trim()}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            fontWeight: 900,
                            background: COLORS.blue,
                            color: "white",
                            border: "none",
                            cursor: "pointer",
                            opacity: busy || !editingColumnName.trim() ? 0.6 : 1,
                          }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setEditingColumnId(null);
                            setEditingColumnName("");
                          }}
                          style={{ padding: "8px 10px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "white", cursor: "pointer" }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 900 }}>{col.name}</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => {
                              setEditingColumnId(col.id);
                              setEditingColumnName(col.name);
                            }}
                            style={{ padding: "6px 8px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "white", cursor: "pointer" }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteColumn(col)}
                            style={{
                              padding: "6px 8px",
                              borderRadius: 10,
                              border: `1px solid rgba(220,0,0,.25)`,
                              background: "rgba(220,0,0,.06)",
                              color: "crimson",
                              cursor: "pointer",
                              fontWeight: 900,
                            }}
                          >
                            Del
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Cells */}
                  <div style={{ display: "grid", gap: 10 }}>
                    {cells.map((cell) => {
                      const list = itemsByCell[cell.id] || [];
                      const isEditingThis = editingCellId === cell.id;

                      return (
                        <div
                          key={cell.id}
                          ref={(el) => {
                            cellRefMap.current[cell.id] = el;
                          }}
                          style={{
                            border: `1px solid ${COLORS.border}`,
                            borderRadius: 14,
                            background: "white",
                            padding: 10,
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            {isEditingThis ? (
                              <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
                                <input
                                  value={editingCellCode}
                                  onChange={(e) => setEditingCellCode(e.target.value)}
                                  placeholder="Cell code (e.g. K21)"
                                  style={{ flex: 1, padding: 8, borderRadius: 10, border: `1px solid ${COLORS.border}` }}
                                />
                                <button
                                  onClick={() => saveCellCode(cell.id)}
                                  disabled={busy || !editingCellCode.trim()}
                                  style={{
                                    padding: "8px 10px",
                                    borderRadius: 10,
                                    fontWeight: 900,
                                    background: COLORS.blue,
                                    color: "white",
                                    border: "none",
                                    cursor: "pointer",
                                    opacity: busy || !editingCellCode.trim() ? 0.6 : 1,
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingCellId(null);
                                    setEditingCellCode("");
                                  }}
                                  style={{ padding: "8px 10px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "white" }}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <>
                                <div style={{ fontWeight: 900 }}>{cell.code}</div>
                                <button
                                  onClick={() => openAddItem(cell.id)}
                                  style={{ padding: "6px 8px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "white", cursor: "pointer" }}
                                >
                                  + Item
                                </button>
                              </>
                            )}
                          </div>

                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {list.length === 0 ? (
                              <div style={{ color: COLORS.muted, fontSize: 12 }}>Empty</div>
                            ) : (
                              list
                                .filter((it) => (search.trim() ? fuzzyMatch(search, it.name) : true))
                                .map((it) => (
                                  <button
                                    key={it.id}
                                    onClick={() => openEditItem(it)}
                                    title={it.name}
                                    style={{
                                      maxWidth: "100%",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 6,
                                      padding: "6px 8px",
                                      borderRadius: 999,
                                      border: `1px solid ${COLORS.border}`,
                                      background: chipBg(it),
                                      cursor: "pointer",
                                    }}
                                  >
                                    <span
                                      style={{
                                        maxWidth: 190,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        fontWeight: 900,
                                        fontSize: 12,
                                        color: COLORS.ink,
                                      }}
                                    >
                                      {it.name}
                                    </span>
                                    <span style={{ fontSize: 12, color: COLORS.muted }}>×{it.qty}</span>
                                  </button>
                                ))
                            )}
                          </div>

                          {!isEditingThis ? (
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
                              <button
                                onClick={() => {
                                  setEditingCellId(cell.id);
                                  setEditingCellCode(cell.code);
                                }}
                                style={{
                                  flex: 1,
                                  padding: "8px 10px",
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
                                onClick={() => deleteCell(cell)}
                                style={{
                                  flex: 1,
                                  padding: "8px 10px",
                                  borderRadius: 12,
                                  border: `1px solid rgba(220,0,0,.25)`,
                                  background: "rgba(220,0,0,.06)",
                                  color: "crimson",
                                  cursor: "pointer",
                                  fontWeight: 900,
                                }}
                              >
                                Del
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => addCell(col.id)}
                    disabled={busy}
                    style={{
                      marginTop: 6,
                      padding: "10px 12px",
                      borderRadius: 12,
                      fontWeight: 900,
                      background: "white",
                      border: `1px solid ${COLORS.border}`,
                      cursor: "pointer",
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    + Add cell
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ✅ Modal: mobile/ipad/desktop 优化 + Enter submit */}
      {itemModalOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/40 p-3 sm:p-6 overflow-y-auto"
          onClick={() => {
            setItemModalOpen(false);
            setEditingItem(null);
          }}
        >
          {/* 让移动端从顶部开始展示，避免键盘弹出时把内容顶没 */}
          <div className="mx-auto w-full max-w-2xl flex justify-center sm:items-center items-start">
            <div
              className="w-full bg-white rounded-2xl border border-black/10 shadow-xl overflow-hidden"
              style={{
                // 关键：用 100dvh 适配移动端动态视口（键盘弹出）
                maxHeight: "calc(100dvh - 24px)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header sticky：永远能看到 Close */}
              <div
                className="sticky top-0 z-10 bg-white border-b border-black/10"
                style={{ padding: 14 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>{editingItem ? "Edit item" : "Add item"}</div>
                  <button
                    onClick={() => {
                      setItemModalOpen(false);
                      setEditingItem(null);
                    }}
                    style={{ padding: "6px 8px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "white" }}
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Content scroll area */}
              <div
                className="overflow-y-auto"
                style={{
                  padding: 14,
                  WebkitOverflowScrolling: "touch",
                  // 留出 footer 的高度，避免最后一行被按钮遮挡
                  paddingBottom: 96,
                }}
              >
                {/* ✅ 用 form + onSubmit 实现 Enter 提交 */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (busy) return;
                    void saveItem();
                  }}
                  onKeyDown={(e) => {
                    // Enter 提交（排除 IME composition，避免中文输入法误提交）
                    if (e.key === "Enter" && !isComposingEvent(e)) {
                      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
                      if (tag === "textarea") return;
                      // select 的 Enter 有时用于打开/选择；这里依然允许 submit（符合你要求）
                      e.preventDefault();
                      if (!busy) void saveItem();
                    }
                  }}
                >
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontWeight: 900 }}>Name</div>
                      <input
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        placeholder="e.g. Olive oil"
                        style={{ padding: 10, borderRadius: 12, border: `1px solid ${COLORS.border}` }}
                      />
                    </div>

                    <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 900 }}>Quantity</div>
                        <input
                          type="number"
                          value={itemQty}
                          onChange={(e) => setItemQty(Number(e.target.value))}
                          style={{ padding: 10, borderRadius: 12, border: `1px solid ${COLORS.border}` }}
                        />
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 900 }}>Expire date</div>
                        <input
                          type="date"
                          value={itemExpire}
                          onChange={(e) => setItemExpire(e.target.value)}
                          style={{ padding: 10, borderRadius: 12, border: `1px solid ${COLORS.border}` }}
                        />
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {[
                            { label: "1 week", days: 7 },
                            { label: "1 month", days: 30 },
                            { label: "3 months", days: 90 },
                            { label: "1 year", days: 365 },
                          ].map((x) => (
                            <button
                              key={x.label}
                              type="button"
                              onClick={() => {
                                const now = new Date();
                                const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + x.days);
                                const yyyy = d.getFullYear();
                                const mm = String(d.getMonth() + 1).padStart(2, "0");
                                const dd = String(d.getDate()).padStart(2, "0");
                                setItemExpire(`${yyyy}-${mm}-${dd}`);
                              }}
                              style={{ padding: "6px 8px", borderRadius: 999, border: `1px solid ${COLORS.border}`, background: "white", cursor: "pointer" }}
                            >
                              +{x.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setItemExpire("")}
                            style={{ padding: "6px 8px", borderRadius: 999, border: `1px solid ${COLORS.border}`, background: "white", cursor: "pointer" }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 两级联动 location */}
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 900 }}>Room</div>
                        <select
                          value={locationRoomId}
                          onChange={(e) => setLocationRoomId(e.target.value)}
                          style={{ padding: 10, borderRadius: 12, border: `1px solid ${COLORS.border}` }}
                        >
                          <option value="">Select a room</option>
                          {hhRooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 900 }}>Cell (in selected room)</div>
                        <select
                          value={itemCellId}
                          onChange={(e) => setItemCellId(e.target.value)}
                          style={{ padding: 10, borderRadius: 12, border: `1px solid ${COLORS.border}` }}
                          disabled={!locationRoomId}
                        >
                          <option value="">Select a cell</option>
                          {roomCellOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.code} · {opt.label}
                            </option>
                          ))}
                        </select>

                        {locationRoomId ? (
                          <AutoFixCellSelection
                            roomCellOptions={roomCellOptions}
                            itemCellId={itemCellId}
                            setItemCellId={setItemCellId}
                          />
                        ) : null}
                      </div>
                    </div>

                    {busy ? <div style={{ color: COLORS.muted }}>Working…</div> : null}
                  </div>

                  {/* Footer sticky：按钮永远在屏幕底部可见 */}
                  <div
                    className="sticky bottom-0 z-10 bg-white border-t border-black/10"
                    style={{ padding: 14 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                          type="submit"
                          disabled={busy}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 12,
                            fontWeight: 900,
                            background: COLORS.blue,
                            color: "white",
                            border: "none",
                            cursor: "pointer",
                            opacity: busy ? 0.6 : 1,
                          }}
                        >
                          {editingItem ? "Save changes" : "Add item"}
                        </button>

                        {editingItem ? (
                          <button
                            type="button"
                            onClick={() => deleteItem(editingItem.id)}
                            disabled={busy}
                            style={{
                              padding: "10px 12px",
                              borderRadius: 12,
                              fontWeight: 900,
                              border: `1px solid rgba(220,0,0,.25)`,
                              background: "rgba(220,0,0,.06)",
                              color: "crimson",
                              cursor: "pointer",
                              opacity: busy ? 0.6 : 1,
                            }}
                          >
                            Delete item
                          </button>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setItemModalOpen(false);
                          setEditingItem(null);
                        }}
                        style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${COLORS.border}`, background: "white" }}
                      >
                        Cancel
                      </button>
                    </div>

                    <div style={{ marginTop: 6, color: COLORS.muted, fontSize: 12 }}>
                      Tip: Press Enter to {editingItem ? "save" : "add"} (Esc to close on desktop)
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AutoFixCellSelection(props: {
  roomCellOptions: { id: string; code: string; label: string }[];
  itemCellId: string;
  setItemCellId: (v: string) => void;
}) {
  const { roomCellOptions, itemCellId, setItemCellId } = props;

  useEffect(() => {
    if (roomCellOptions.length === 0) return;
    const exists = roomCellOptions.some((x) => x.id === itemCellId);
    if (!exists) {
      setItemCellId(roomCellOptions[0].id);
    }
  }, [roomCellOptions, itemCellId, setItemCellId]);

  return null;
}
