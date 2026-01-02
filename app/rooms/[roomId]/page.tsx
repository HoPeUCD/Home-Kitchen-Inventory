"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AuthGate from "@/src/components/AuthGate";

type HouseholdJoin = { household_id: string; households: { id: string; name: string } | null };
type Room = { id: string; household_id: string; name: string; position: number };
type Col = { id: string; room_id: string; name: string; position: number };
type Cell = { id: string; column_id: string; code: string | null; name: string | null; position: number };
type CellFull = {
  cell_id: string;
  cell_code: string;
  cell_name: string;
  cell_position: number;
  column_id: string;
  column_name: string;
  column_position: number;
  room_id: string;
  room_name: string;
  room_position: number;
  household_id: string;
};
type Item = {
  id: string;
  household_id?: string; // may exist
  cell_id: string;
  name: string;
  qty: number;
  unit: string | null;
  expires_at: string | null; // YYYY-MM-DD
  aliases: string[] | null;
  image_path: string | null;
  updated_at: string | null;
};

type MapItem = { name: string; expires_at: string | null };

type IndexItem = {
  id: string;
  cell_id: string;
  name: string;
  qty: number;
  unit: string | null;
  expires_at: string | null;
  aliases: string[] | null;
};

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}
function parseDateOnlyISO(s: string) {
  const [y, m, d] = s.split("-").map((x) => Number(x));
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}
function daysBetween(a: Date, b: Date) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.floor((b.getTime() - a.getTime()) / MS);
}
function toDateOnlyISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function setExpiryPreset(setter: (v: string) => void, preset: "1w" | "1m" | "3m" | "1y") {
  const now = startOfToday();
  const d = new Date(now);
  if (preset === "1w") d.setDate(d.getDate() + 7);
  if (preset === "1m") d.setMonth(d.getMonth() + 1);
  if (preset === "3m") d.setMonth(d.getMonth() + 3);
  if (preset === "1y") d.setFullYear(d.getFullYear() + 1);
  setter(toDateOnlyISO(d));
}
function expiryStatus(expiresAt: string | null) {
  if (!expiresAt) return { kind: "none" as const, days: null as number | null };
  const today = startOfToday();
  const exp = parseDateOnlyISO(expiresAt);
  const d = daysBetween(today, exp);
  if (d < 0) return { kind: "expired" as const, days: d };
  if (d <= 30) return { kind: "soon" as const, days: d };
  return { kind: "ok" as const, days: d };
}
function compareMapItemsByExpiryThenName(a: MapItem, b: MapItem) {
  const sa = expiryStatus(a.expires_at);
  const sb = expiryStatus(b.expires_at);
  const rank = (k: typeof sa.kind) => (k === "expired" ? 0 : k === "soon" ? 1 : k === "ok" ? 2 : 3);
  const ra = rank(sa.kind);
  const rb = rank(sb.kind);
  if (ra !== rb) return ra - rb;

  if (a.expires_at && b.expires_at) {
    const c = a.expires_at.localeCompare(b.expires_at);
    if (c !== 0) return c;
  } else if (a.expires_at && !b.expires_at) return -1;
  else if (!a.expires_at && b.expires_at) return 1;

  return a.name.localeCompare(b.name);
}
function compareItemsForList(a: Item, b: Item) {
  const sa = expiryStatus(a.expires_at);
  const sb = expiryStatus(b.expires_at);
  const rank = (k: typeof sa.kind) => (k === "expired" ? 0 : k === "soon" ? 1 : k === "ok" ? 2 : 3);
  const ra = rank(sa.kind);
  const rb = rank(sb.kind);
  if (ra !== rb) return ra - rb;

  if (a.expires_at && b.expires_at) {
    const c = a.expires_at.localeCompare(b.expires_at);
    if (c !== 0) return c;
  } else if (a.expires_at && !b.expires_at) return -1;
  else if (!a.expires_at && b.expires_at) return 1;

  return a.name.localeCompare(b.name);
}

// ---- fuzzy search helpers (client-side) ----
function norm(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s\-_.,/\\|()[\]{}'"`~!@#$%^&*+=:;?<>]/g, "");
}
function isSubsequence(q: string, t: string) {
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (q[i] === t[j]) i++;
  }
  return i === q.length;
}
function fuzzyScore(qRaw: string, targetRaw: string) {
  const q = norm(qRaw);
  const t = norm(targetRaw);
  if (!q || !t) return 0;

  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - (t.length - q.length);
  const idx = t.indexOf(q);
  if (idx >= 0) return 800 - idx - (t.length - q.length);

  // subsequence match: weaker but helps for small typos / missing chars
  if (q.length >= 2 && isSubsequence(q, t)) return 500 - (t.length - q.length);

  return 0;
}

export default function RoomPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const rawRoomId = (params as any)?.roomId;
  const roomId = Array.isArray(rawRoomId) ? rawRoomId[0] : (rawRoomId as string);

  const [session, setSession] = useState<Session | null>(null);
  const user: User | null = session?.user ?? null;

  const [household, setHousehold] = useState<{ id: string; name: string } | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [room, setRoom] = useState<Room | null>(null);

  const [cols, setCols] = useState<Col[]>([]);
  const [cellsByCol, setCellsByCol] = useState<Record<string, Cell[]>>({});
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);

  // right panel items in selected cell
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // used for global location dropdown
  const [cellsFull, setCellsFull] = useState<CellFull[]>([]);
  const [locQuery, setLocQuery] = useState("");

  // signed urls for thumbnails
  const [signedUrlByPath, setSignedUrlByPath] = useState<Record<string, string>>({});

  // map preview items shown inside each cell button
  const [cellItemsMap, setCellItemsMap] = useState<Record<string, MapItem[]>>({});

  // household-wide index (for fuzzy search + compact expiry lists)
  const [indexItems, setIndexItems] = useState<IndexItem[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  // Add form
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [aliasesCsv, setAliasesCsv] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("1");
  const [editUnit, setEditUnit] = useState("");
  const [editAliasesCsv, setEditAliasesCsv] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [editCellId, setEditCellId] = useState<string>("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [pickMode, setPickMode] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const cid = searchParams.get("cell");
    if (cid) setSelectedCellId(cid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPickMode(false);
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
  }

  function csvToAliases(s: string): string[] {
    return s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  function aliasesToCsv(a: string[] | null | undefined) {
    return (a ?? []).join(", ");
  }

  async function loadHousehold(u: User) {
    const hm = await supabase
      .from("household_members")
      .select("household_id, households(id,name)")
      .eq("user_id", u.id)
      .limit(1)
      .maybeSingle();

    if (hm.error) throw new Error(`Household load failed: ${hm.error.message}`);

    const row = hm.data as unknown as HouseholdJoin | null;
    if (!row?.households?.id) {
      throw new Error("No household found. If this is an existing user, run the bootstrap SQL once.");
    }

    setHousehold({ id: row.households.id, name: row.households.name });
    return row.household_id;
  }

  async function loadRooms(hid: string) {
    const r = await supabase.from("rooms").select("id,household_id,name,position").eq("household_id", hid).order("position", { ascending: true });
    if (r.error) throw new Error(`Rooms load failed: ${r.error.message}`);
    setRooms((r.data as Room[]) ?? []);
  }

  async function loadRoom(roomId: string) {
    const r = await supabase.from("rooms").select("id,household_id,name,position").eq("id", roomId).single();
    if (r.error) throw new Error(`Room load failed: ${r.error.message}`);
    setRoom(r.data as Room);
  }

  async function loadLayout(roomId: string) {
    const c = await supabase.from("room_columns").select("id,room_id,name,position").eq("room_id", roomId).order("position", { ascending: true });
    if (c.error) throw new Error(`Columns load failed: ${c.error.message}`);
    const colsData = (c.data as Col[]) ?? [];
    setCols(colsData);

    if (colsData.length === 0) {
      setCellsByCol({});
      return;
    }

    const colIds = colsData.map((x) => x.id);
    const rc = await supabase.from("room_cells").select("id,column_id,code,name,position").in("column_id", colIds).order("position", { ascending: true });
    if (rc.error) throw new Error(`Cells load failed: ${rc.error.message}`);

    const by: Record<string, Cell[]> = {};
    ((rc.data as Cell[]) ?? []).forEach((cell) => {
      by[cell.column_id] ||= [];
      by[cell.column_id].push(cell);
    });
    Object.keys(by).forEach((k) => by[k].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));
    setCellsByCol(by);
  }

  async function loadCellsFull(hid: string) {
    const q = await supabase
      .from("v_room_cells_full")
      .select("cell_id,cell_code,cell_name,cell_position,column_id,column_name,column_position,room_id,room_name,room_position,household_id")
      .eq("household_id", hid)
      .order("room_position", { ascending: true })
      .order("column_position", { ascending: true })
      .order("cell_position", { ascending: true });

    if (q.error) throw new Error(`Cells view load failed: ${q.error.message}`);
    setCellsFull((q.data as CellFull[]) ?? []);
  }

  async function ensureSignedUrls(paths: string[]) {
    const bucket = "item-images";
    const unique = Array.from(new Set(paths.filter(Boolean)));
    const missing = unique.filter((p) => !signedUrlByPath[p]);
    if (missing.length === 0) return;

    const results = await Promise.all(
      missing.map(async (p) => {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(p, 60 * 60);
        if (error) return [p, ""] as const;
        return [p, data?.signedUrl ?? ""] as const;
      })
    );

    setSignedUrlByPath((prev) => {
      const next = { ...prev };
      for (const [p, url] of results) if (url) next[p] = url;
      return next;
    });
  }

  const roomCellIds = useMemo(() => {
    const ids: string[] = [];
    for (const colId of Object.keys(cellsByCol)) {
      for (const cell of cellsByCol[colId] ?? []) ids.push(cell.id);
    }
    return ids;
  }, [cellsByCol]);

  async function refreshMapItems(cellIds: string[]) {
    if (!cellIds.length) {
      setCellItemsMap({});
      return;
    }

    const q = await supabase.from("items_v2").select("cell_id,name,expires_at,qty").in("cell_id", cellIds).gt("qty", 0).limit(5000);
    if (q.error) throw new Error(`Map items load failed: ${q.error.message}`);

    const by: Record<string, MapItem[]> = {};
    for (const row of (q.data as any[] ?? [])) {
      const cid = String(row.cell_id);
      by[cid] ||= [];
      by[cid].push({ name: String(row.name ?? ""), expires_at: row.expires_at ?? null });
    }

    for (const cid of Object.keys(by)) {
      by[cid] = by[cid].filter((x) => x.name && x.name.trim()).slice().sort(compareMapItemsByExpiryThenName);
    }

    setCellItemsMap(by);
  }

  async function refreshItems(cellId: string) {
    const q = await supabase
      .from("items_v2")
      .select("id,cell_id,name,qty,unit,expires_at,aliases,image_path,updated_at")
      .eq("cell_id", cellId)
      .gt("qty", 0)
      .limit(2000);

    if (q.error) throw new Error(`Items load failed: ${q.error.message}`);

    const rows = ((q.data as Item[]) ?? []).slice().sort(compareItemsForList);
    setItems(rows);

    const paths = rows.map((r) => r.image_path).filter(Boolean) as string[];
    await ensureSignedUrls(paths);
  }

  // household-wide index: used for fuzzy search + expiry lists
  async function refreshIndexItems(householdId: string) {
    // Preferred: items_v2 has household_id; this is typical in your schema.
    const q = await supabase
      .from("items_v2")
      .select("id,cell_id,name,qty,unit,expires_at,aliases,household_id")
      .eq("household_id", householdId)
      .gt("qty", 0)
      .limit(5000);

    // If you do NOT have items_v2.household_id, replace the query with a join-by-cells strategy:
    //   - build list of cell_ids from cellsFull and chunk in batches (avoid 1000+ IN list issues)
    //   - then query items_v2 per chunk with .in("cell_id", chunk)
    // Tell me if you don't have household_id and I’ll give you the chunked version.

    if (q.error) throw new Error(`Index items load failed: ${q.error.message}`);
    setIndexItems((q.data as IndexItem[]) ?? []);
  }

  useEffect(() => {
    if (!user || !roomId) return;
    (async () => {
      try {
        setErr(null);
        const hid = await loadHousehold(user);
        await loadRooms(hid);
        await loadRoom(roomId);
        await loadLayout(roomId);
        await loadCellsFull(hid);
        await refreshIndexItems(hid);
      } catch (e: any) {
        setErr(e?.message ?? "Load failed.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, roomId]);

  useEffect(() => {
    (async () => {
      try {
        setErr(null);
        await refreshMapItems(roomCellIds);
      } catch (e: any) {
        setErr(e?.message ?? "Load map items failed.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCellIds.join(",")]);

  useEffect(() => {
    if (!selectedCellId) {
      setItems([]);
      return;
    }
    (async () => {
      try {
        setErr(null);
        await refreshItems(selectedCellId);
      } catch (e: any) {
        setErr(e?.message ?? "Load items failed.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCellId]);

  function fmtCellLabel(c: CellFull) {
    const short = c.cell_code?.trim() ? c.cell_code.trim() : "Cell";
    const nm = c.cell_name?.trim() ? c.cell_name.trim() : "";
    return `${c.room_name} / ${c.column_name} / ${short}${nm ? ` (${nm})` : ""}`;
  }

  const cellFullById = useMemo(() => {
    const m: Record<string, CellFull> = {};
    for (const c of cellsFull) m[c.cell_id] = c;
    return m;
  }, [cellsFull]);

  const selectedCellFull = useMemo(() => {
    if (!selectedCellId) return null;
    return cellsFull.find((c) => c.cell_id === selectedCellId) ?? null;
  }, [cellsFull, selectedCellId]);

  // -------- compact expiry lists (<=7, 8-30) --------
  const expLists = useMemo(() => {
    const today = startOfToday();
    const rows = indexItems
      .filter((it) => !!it.expires_at)
      .map((it) => {
        const exp = parseDateOnlyISO(it.expires_at!);
        const d = daysBetween(today, exp); // negative => expired
        return { it, days: d };
      })
      .filter((x) => x.days <= 30); // include expired + within 30d

    rows.sort((a, b) => {
      // expired and sooner first
      if (a.days !== b.days) return a.days - b.days;
      return a.it.name.localeCompare(b.it.name);
    });

    const within7 = rows.filter((x) => x.days <= 7); // includes expired
    const within30 = rows.filter((x) => x.days > 7 && x.days <= 30);

    return { within7, within30 };
  }, [indexItems]);

  // -------- fuzzy search results (client-side) --------
  const searchResults = useMemo(() => {
    const q = searchQ.trim();
    if (!q) return [];

    const scored = indexItems
      .map((it) => {
        const candidates = [it.name, ...(it.aliases ?? [])].filter(Boolean);
        let best = 0;
        for (const c of candidates) best = Math.max(best, fuzzyScore(q, c));
        return { it, score: best };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.it.name.localeCompare(b.it.name))
      .slice(0, 50);

    return scored;
  }, [searchQ, indexItems]);

  // location options for edit dropdown
  const locationOptions = useMemo(() => {
    const t = locQuery.trim().toLowerCase();
    const list = cellsFull.map((c) => ({
      id: c.cell_id,
      label: fmtCellLabel(c),
      hay: `${c.room_name} ${c.column_name} ${c.cell_code} ${c.cell_name}`.toLowerCase(),
      room_id: c.room_id,
    }));
    if (!t) return list;
    return list.filter((x) => x.hay.includes(t));
  }, [cellsFull, locQuery]);

  async function addColumn() {
    if (!room || !user) return;
    const v = prompt("Column name (e.g. Pantry / Dresser):", "New column");
    if (!v) return;
    const nm = v.trim();
    if (!nm) return;

    const nextPos = (cols.reduce((m, c) => Math.max(m, c.position ?? 0), 0) || 0) + 1;

    const ins = await supabase.from("room_columns").insert({ room_id: room.id, name: nm, position: nextPos, created_by: user.id }).select("id,room_id,name,position").single();
    if (ins.error) return setErr(ins.error.message);

    setCols((prev) => [...prev, ins.data as Col].sort((a, b) => a.position - b.position));
    setCellsByCol((prev) => ({ ...prev, [(ins.data as Col).id]: [] }));
    if (household) await loadCellsFull(household.id);
  }

  async function renameColumn(colId: string, current: string) {
    const v = prompt("Rename column:", current);
    if (v === null) return;
    const nm = v.trim();
    if (!nm) return;

    const up = await supabase.from("room_columns").update({ name: nm }).eq("id", colId);
    if (up.error) return setErr(up.error.message);

    setCols((prev) => prev.map((c) => (c.id === colId ? { ...c, name: nm } : c)));
    if (household) await loadCellsFull(household.id);
  }

  async function deleteColumn(colId: string) {
    if (!confirm("Delete this column? (Cells inside will be deleted)")) return;
    const del = await supabase.from("room_columns").delete().eq("id", colId);
    if (del.error) return setErr(del.error.message);

    setCols((prev) => prev.filter((c) => c.id !== colId));
    setCellsByCol((prev) => {
      const n = { ...prev };
      delete n[colId];
      return n;
    });
    if (household) await loadCellsFull(household.id);
  }

  async function addCell(colId: string) {
    if (!user) return;

    const code = prompt("Cell code (short label, optional):", "");
    if (code === null) return;
    const nm = prompt("Cell name (optional):", "");
    if (nm === null) return;

    const arr = cellsByCol[colId] ?? [];
    const nextPos = (arr.reduce((m, c) => Math.max(m, c.position ?? 0), 0) || 0) + 1;

    const ins = await supabase
      .from("room_cells")
      .insert({ column_id: colId, code: code.trim() || null, name: nm.trim() || null, position: nextPos, created_by: user.id })
      .select("id,column_id,code,name,position")
      .single();

    if (ins.error) return setErr(ins.error.message);

    setCellsByCol((prev) => {
      const next = { ...prev };
      next[colId] = [...(next[colId] ?? []), ins.data as Cell].sort((a, b) => a.position - b.position);
      return next;
    });

    if (household) {
      await loadCellsFull(household.id);
      await refreshIndexItems(household.id);
    }
  }

  async function editCell(cell: Cell) {
    const code = prompt("Edit cell code:", cell.code ?? "");
    if (code === null) return;
    const nm = prompt("Edit cell name:", cell.name ?? "");
    if (nm === null) return;

    const up = await supabase.from("room_cells").update({ code: code.trim() || null, name: nm.trim() || null }).eq("id", cell.id);
    if (up.error) return setErr(up.error.message);

    setCellsByCol((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        next[k] = (next[k] ?? []).map((c) => (c.id === cell.id ? { ...c, code: code.trim() || null, name: nm.trim() || null } : c));
      }
      return next;
    });
    if (household) await loadCellsFull(household.id);
  }

  async function deleteCell(cellId: string) {
    const ok = confirm("Delete this cell AND delete all items inside it?");
    if (!ok) return;

    try {
      setErr(null);

      const di = await supabase.from("items_v2").delete().eq("cell_id", cellId);
      if (di.error) throw di.error;

      const del = await supabase.from("room_cells").delete().eq("id", cellId);
      if (del.error) throw del.error;

      setCellsByCol((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) next[k] = (next[k] ?? []).filter((c) => c.id !== cellId);
        return next;
      });

      setCellItemsMap((prev) => {
        const next = { ...prev };
        delete next[cellId];
        return next;
      });

      if (selectedCellId === cellId) {
        setSelectedCellId(null);
        setItems([]);
      }

      if (editingId && editCellId === cellId) cancelEdit();

      if (household) {
        await loadCellsFull(household.id);
        await refreshIndexItems(household.id);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Delete cell failed.");
    }
  }

  async function uploadItemImage(hid: string, itemId: string, file: File) {
    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Image too large. Keep under ${MAX_MB}MB.`);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = safeName.includes(".") ? safeName.split(".").pop() : "jpg";
    const path = `${hid}/${itemId}/${Date.now()}.${ext}`;

    const bucket = "item-images";
    const up = await supabase.storage.from(bucket).upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
      cacheControl: "3600",
    });
    if (up.error) throw up.error;
    return path;
  }

  async function addItem() {
    if (!selectedCellId || !household) return;
    const n = name.trim();
    if (!n) return;

    const qn = Number(qty || "1");
    const safeQty = Number.isFinite(qn) ? qn : 1;

    try {
      setErr(null);

      const ins = await supabase
        .from("items_v2")
        .insert({
          cell_id: selectedCellId,
          household_id: household.id, // ok if column exists; if not, remove this line
          name: n,
          qty: safeQty,
          unit: unit.trim() || null,
          expires_at: expiresAt ? expiresAt : null,
          aliases: csvToAliases(aliasesCsv),
          image_path: null,
        })
        .select("id")
        .single();

      if (ins.error) throw ins.error;

      const itemId = String((ins.data as any).id);

      if (newImageFile) {
        setUploading(true);
        const path = await uploadItemImage(household.id, itemId, newImageFile);
        const up = await supabase.from("items_v2").update({ image_path: path }).eq("id", itemId);
        if (up.error) throw up.error;
        await ensureSignedUrls([path]);
      }

      setName("");
      setQty("1");
      setUnit("");
      setAliasesCsv("");
      setExpiresAt("");
      setNewImageFile(null);

      await refreshItems(selectedCellId);
      await refreshMapItems(roomCellIds);
      await refreshIndexItems(household.id);
    } catch (e: any) {
      setErr(e?.message ?? "Add item failed.");
    } finally {
      setUploading(false);
    }
  }

  function startEdit(it: Item) {
    setEditingId(it.id);
    setEditName(it.name ?? "");
    setEditQty(String(it.qty ?? 1));
    setEditUnit(it.unit ?? "");
    setEditAliasesCsv(aliasesToCsv(it.aliases));
    setEditExpiresAt(it.expires_at ?? "");
    setEditCellId(it.cell_id);
    setEditImageFile(null);
    setLocQuery("");
    setPickMode(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditQty("1");
    setEditUnit("");
    setEditAliasesCsv("");
    setEditExpiresAt("");
    setEditCellId("");
    setEditImageFile(null);
    setPickMode(false);
    setLocQuery("");
  }

  async function saveEdit(itemId: string) {
    if (!household) return;
    const n = editName.trim();
    if (!n) return;
    if (!editCellId) return setErr("Location is required.");

    const qn = Number(editQty || "1");
    const safeQty = Number.isFinite(qn) ? qn : 1;

    try {
      setSaving(true);
      setErr(null);

      const up = await supabase
        .from("items_v2")
        .update({
          name: n,
          qty: safeQty,
          unit: editUnit.trim() || null,
          expires_at: editExpiresAt ? editExpiresAt : null,
          aliases: csvToAliases(editAliasesCsv),
          cell_id: editCellId,
        })
        .eq("id", itemId);

      if (up.error) throw up.error;

      if (editImageFile) {
        setUploading(true);
        const path = await uploadItemImage(household.id, itemId, editImageFile);
        const up2 = await supabase.from("items_v2").update({ image_path: path }).eq("id", itemId);
        if (up2.error) throw up2.error;
        await ensureSignedUrls([path]);
      }

      const target = cellsFull.find((c) => c.cell_id === editCellId);
      cancelEdit();

      if (target && target.room_id !== roomId) {
        router.push(`/rooms/${target.room_id}?cell=${target.cell_id}`);
        return;
      }

      if (selectedCellId) await refreshItems(selectedCellId);
      await refreshMapItems(roomCellIds);
      await refreshIndexItems(household.id);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed.");
    } finally {
      setUploading(false);
      setSaving(false);
    }
  }

  async function deleteItem(itemId: string) {
    const del = await supabase.from("items_v2").delete().eq("id", itemId);
    if (del.error) return setErr(del.error.message);

    setItems((prev) => prev.filter((x) => x.id !== itemId));
    if (editingId === itemId) cancelEdit();

    await refreshMapItems(roomCellIds);
    if (household) await refreshIndexItems(household.id);
  }

  function onCellClick(cellId: string) {
    if (pickMode && editingId) {
      setEditCellId(cellId);
      setPickMode(false);
      return;
    }
    setSelectedCellId(cellId);
  }

  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  const selectedLabel = selectedCellFull ? fmtCellLabel(selectedCellFull) : "Select a cell";
  const pickBannerOn = pickMode && !!editingId;

  function chipStyle(expires_at: string | null): React.CSSProperties {
    const st = expiryStatus(expires_at);
    const base: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      maxWidth: "100%",
      padding: "4px 8px",
      borderRadius: 10,
      border: "1px solid rgba(31,35,40,.12)",
      background: "transparent",
      fontSize: 12,
      fontWeight: 900,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      minWidth: 0,
    };

    if (st.kind === "expired") return { ...base, background: "var(--expBg)", borderColor: "var(--expBorder)" };
    if (st.kind === "soon") return { ...base, background: "var(--warnBg)", borderColor: "var(--warnBorder)" };
    return { ...base, background: "rgba(47,93,124,.08)", borderColor: "rgba(47,93,124,.22)", color: "var(--blue)" };
  }

  const topCardListStyle: React.CSSProperties = {
    margin: 0,
    paddingLeft: 18,
    lineHeight: 1.35,
    fontSize: 13,
  };

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <div className="h1">{room?.name ?? "Room"}</div>
          <div className="muted">
            Household: <span style={{ fontWeight: 900 }}>{household?.name ?? "…"}</span>
          </div>
        </div>

        <div className="headerOps">
          <select className="select" value={roomId} onChange={(e) => router.push(`/rooms/${e.target.value}`)} style={{ width: 220 }}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          <button className="pill ghost" onClick={() => router.push("/rooms")}>
            Rooms
          </button>
          <button className="pill ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      {err && (
        <div className="alert" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

      {/* ===== TOP: compact expiry lists + fuzzy search ===== */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 240, flex: "1 1 320px" }}>
            <div className="h2" style={{ marginBottom: 6 }}>
              Expiring soon (compact)
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div className="muted" style={{ fontWeight: 900 }}>
                  ≤ 7 days (incl. expired)
                </div>
                {expLists.within7.length === 0 ? (
                  <div className="muted">None</div>
                ) : (
                  <ul style={topCardListStyle}>
                    {expLists.within7.slice(0, 20).map(({ it, days }) => {
                      const loc = cellFullById[it.cell_id];
                      const label = loc ? fmtCellLabel(loc) : it.cell_id;
                      const tag = days < 0 ? `expired ${Math.abs(days)}d` : `${days}d`;
                      return (
                        <li key={`e7-${it.id}`}>
                          <span style={{ fontWeight: 900 }}>{it.name}</span> — {label} — {tag}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <div className="muted" style={{ fontWeight: 900 }}>
                  8–30 days
                </div>
                {expLists.within30.length === 0 ? (
                  <div className="muted">None</div>
                ) : (
                  <ul style={topCardListStyle}>
                    {expLists.within30.slice(0, 20).map(({ it, days }) => {
                      const loc = cellFullById[it.cell_id];
                      const label = loc ? fmtCellLabel(loc) : it.cell_id;
                      return (
                        <li key={`e30-${it.id}`}>
                          <span style={{ fontWeight: 900 }}>{it.name}</span> — {label} — {days}d
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div style={{ minWidth: 240, flex: "1 1 320px" }}>
            <div className="h2" style={{ marginBottom: 6 }}>
              Search (fuzzy)
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <input
                className="input"
                value={searchQ}
                onChange={(e) => {
                  setSearchQ(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search item name / alias (fuzzy)…"
              />

              {searchOpen && searchQ.trim() && (
                <div className="card" style={{ padding: 10, background: "rgba(47,93,124,.03)" }}>
                  {searchResults.length === 0 ? (
                    <div className="muted">No matches.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {searchResults.map(({ it, score }) => {
                        const loc = cellFullById[it.cell_id];
                        const label = loc ? fmtCellLabel(loc) : it.cell_id;
                        const st = expiryStatus(it.expires_at);
                        const expTag =
                          st.kind === "expired"
                            ? `expired ${Math.abs(st.days ?? 0)}d`
                            : st.kind === "soon"
                              ? `${st.days}d`
                              : it.expires_at
                                ? `${st.days}d`
                                : "";

                        return (
                          <button
                            key={`sr-${it.id}`}
                            className="cellBtn"
                            style={{ textAlign: "left" }}
                            onClick={() => {
                              // jump to location
                              if (loc && loc.room_id !== roomId) router.push(`/rooms/${loc.room_id}?cell=${it.cell_id}`);
                              else setSelectedCellId(it.cell_id);

                              setSearchOpen(false);
                            }}
                          >
                            <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                                <div className="muted" style={{ fontSize: 12 }}>
                                  {label}
                                  {expTag ? ` · ${expTag}` : ""}
                                </div>
                              </div>
                              <div className="muted" style={{ fontSize: 12, flex: "0 0 auto" }}>
                                score {score}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                      <button className="pill ghost" onClick={() => setSearchOpen(false)}>
                        Close
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="muted">Tip: supports partials, starts-with, and subsequence matching (better than plain ilike).</div>
            </div>
          </div>
        </div>
      </div>

      {pickBannerOn && (
        <div className="card" style={{ marginBottom: 12, background: "var(--blueSoft)" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="h2">Pick a cell on the map</div>
              <div className="muted">Click a cell (left) to set location. Press ESC to cancel.</div>
            </div>
            <button className="pill ghost" onClick={() => setPickMode(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="main">
        {/* Left */}
        <section className="left">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div className="h2">Layout</div>
            <button className="pill" onClick={addColumn}>
              + Column
            </button>
          </div>

          <div className="cols" style={{ alignItems: "start" }}>
            {cols.length === 0 && <div className="muted">No columns yet. Click “+ Column”.</div>}

            {cols.map((col) => {
              const cells = cellsByCol[col.id] ?? [];
              return (
                <div key={col.id} className="card colCard" style={{ alignContent: "start" }}>
                  <div className="colHead">
                    <div className="colTitle">{col.name}</div>
                    <div className="row" style={{ gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button className="pill" onClick={() => renameColumn(col.id, col.name)}>
                        Rename
                      </button>
                      <button className="pill ghost" onClick={() => deleteColumn(col.id)}>
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="cells">
                    {cells.length === 0 ? (
                      <div className="muted">No cells yet.</div>
                    ) : (
                      cells.map((cell) => {
                        const code = (cell.code ?? "Cell").trim() || "Cell";
                        const nm = (cell.name ?? "").trim();
                        const selected = selectedCellId === cell.id;

                        const previewItems = (cellItemsMap[cell.id] ?? []).slice().sort(compareMapItemsByExpiryThenName);

                        return (
                          <button key={cell.id} className={`cellBtn ${selected ? "selected" : ""}`} onClick={() => onCellClick(cell.id)}>
                            <div className="cellTop">
                              <div className="cellCode">{code}</div>
                              <div className="row" style={{ gap: 6, flex: "0 0 auto" }}>
                                <button
                                  className="tiny"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    editCell(cell);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="tiny danger"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteCell(cell.id);
                                  }}
                                >
                                  Del
                                </button>
                              </div>
                            </div>

                            {nm ? <div className="cellName">{nm}</div> : null}

                            {previewItems.length > 0 && (
                              <div
                                style={{
                                  marginTop: 8,
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 6,
                                  alignItems: "flex-start",
                                  minWidth: 0,
                                }}
                              >
                                {previewItems.map((pi, idx) => (
                                  <span key={`${cell.id}-${idx}-${pi.name}`} style={chipStyle(pi.expires_at)} title={pi.name}>
                                    {pi.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <button className="pill" onClick={() => addCell(col.id)} style={{ width: "100%", justifyContent: "center" } as any}>
                      + Cell
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right */}
        <aside className="right">
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="h2" style={{ marginBottom: 6 }}>
              Selected
            </div>
            <div className="muted">{selectedLabel}</div>
          </div>

          {!selectedCellId ? (
            <div className="muted">Select a cell on the left.</div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="h2" style={{ marginBottom: 8 }}>
                  Add item
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />

                  <div className="split2">
                    <input className="input" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" inputMode="decimal" />
                    <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit" />
                  </div>

                  <input className="input" value={aliasesCsv} onChange={(e) => setAliasesCsv(e.target.value)} placeholder="Aliases (comma-separated): e.g. 黑胡椒, peppercorn" />

                  <div style={{ display: "grid", gap: 8 }}>
                    <div className="muted">Expire date</div>
                    <div className="row" style={{ flexWrap: "wrap" }}>
                      <button className="pill" type="button" onClick={() => setExpiryPreset(setExpiresAt, "1y")}>
                        +1 year
                      </button>
                      <button className="pill" type="button" onClick={() => setExpiryPreset(setExpiresAt, "3m")}>
                        +3 months
                      </button>
                      <button className="pill" type="button" onClick={() => setExpiryPreset(setExpiresAt, "1m")}>
                        +1 month
                      </button>
                      <button className="pill" type="button" onClick={() => setExpiryPreset(setExpiresAt, "1w")}>
                        +1 week
                      </button>
                      <button className="pill ghost" type="button" onClick={() => setExpiresAt("")}>
                        Clear
                      </button>
                    </div>
                    <input className="input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                  </div>

                  <input className="input" type="file" accept="image/*" onChange={(e) => setNewImageFile(e.target.files?.[0] ?? null)} />
                  <button className="btn primary" onClick={addItem} disabled={!name.trim() || uploading}>
                    {uploading ? "Uploading…" : "Add"}
                  </button>
                </div>
              </div>

              <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <div className="h2">Items</div>
                <div className="muted">{items.length}</div>
              </div>

              {items.length === 0 ? (
                <div className="muted">No items.</div>
              ) : (
                <ul className="list">
                  {items.map((it) => {
                    const st = expiryStatus(it.expires_at);
                    const klass = st.kind === "expired" ? "item expired" : st.kind === "soon" ? "item soon" : "item";
                    const isEditing = editingId === it.id;

                    const img = it.image_path ? signedUrlByPath[it.image_path] ?? null : null;

                    return (
                      <li key={it.id} className={klass}>
                        {!isEditing ? (
                          <>
                            {img ? <img className="thumb" src={img} alt={it.name} /> : <div className="thumb placeholder" />}
                            <div className="itemLeft">
                              <div className="itemName">{it.name}</div>
                              <div className="itemMeta">
                                {it.qty} {it.unit ?? ""}
                                {it.expires_at ? ` · ${it.expires_at}` : ""}
                              </div>
                            </div>
                            <div className="itemOps">
                              <button className="pill" onClick={() => startEdit(it)}>
                                Edit
                              </button>
                              <button className="pill ghost" onClick={() => deleteItem(it.id)}>
                                Delete
                              </button>
                            </div>
                          </>
                        ) : (
                          <div style={{ width: "100%", display: "grid", gap: 10 }}>
                            <div className="card" style={{ padding: 10, background: "rgba(47,93,124,.03)" }}>
                              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                  <div className="h2">Location</div>
                                  <div className="muted">Search any room, or pick on map (this room)</div>
                                </div>
                                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                  <button className="pill" type="button" onClick={() => setPickMode((v) => !v)}>
                                    {pickMode ? "Picking…" : "Pick on map"}
                                  </button>
                                  <button className="pill ghost" type="button" onClick={() => setPickMode(false)}>
                                    Stop
                                  </button>
                                </div>
                              </div>

                              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                                <input className="input" value={locQuery} onChange={(e) => setLocQuery(e.target.value)} placeholder="Search location (room / column / code / name)…" />
                                <select className="select" value={editCellId} onChange={(e) => setEditCellId(e.target.value)}>
                                  <option value="" disabled>
                                    Select a location…
                                  </option>
                                  {locationOptions.map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                                {pickMode && <div className="muted">Pick mode ON: click a cell on the left (ESC to cancel).</div>}
                              </div>
                            </div>

                            <div className="split2">
                              <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" />
                              <input className="input" value={editQty} onChange={(e) => setEditQty(e.target.value)} placeholder="Qty" inputMode="decimal" />
                            </div>

                            <input className="input" value={editUnit} onChange={(e) => setEditUnit(e.target.value)} placeholder="Unit" />
                            <input className="input" value={editAliasesCsv} onChange={(e) => setEditAliasesCsv(e.target.value)} placeholder="Aliases (comma-separated)" />

                            <div style={{ display: "grid", gap: 8 }}>
                              <div className="muted">Expire date</div>
                              <div className="row" style={{ flexWrap: "wrap" }}>
                                <button className="pill" type="button" onClick={() => setExpiryPreset(setEditExpiresAt, "1y")}>
                                  +1 year
                                </button>
                                <button className="pill" type="button" onClick={() => setExpiryPreset(setEditExpiresAt, "3m")}>
                                  +3 months
                                </button>
                                <button className="pill" type="button" onClick={() => setExpiryPreset(setEditExpiresAt, "1m")}>
                                  +1 month
                                </button>
                                <button className="pill" type="button" onClick={() => setExpiryPreset(setEditExpiresAt, "1w")}>
                                  +1 week
                                </button>
                                <button className="pill ghost" type="button" onClick={() => setEditExpiresAt("")}>
                                  Clear
                                </button>
                              </div>
                              <input className="input" type="date" value={editExpiresAt} onChange={(e) => setEditExpiresAt(e.target.value)} />
                            </div>

                            <input className="input" type="file" accept="image/*" onChange={(e) => setEditImageFile(e.target.files?.[0] ?? null)} />

                            <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                              <button className="pill ghost" onClick={cancelEdit} disabled={saving || uploading}>
                                Cancel
                              </button>
                              <button className="btn primary" onClick={() => saveEdit(it.id)} disabled={saving || uploading || !editName.trim()}>
                                {saving ? "Saving…" : "Save"}
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
