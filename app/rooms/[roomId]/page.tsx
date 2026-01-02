"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AuthGate from "@/components/AuthGate";

type HouseholdRow = { household_id: string; households: { id: string; name: string } | null };
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
  cell_id: string;
  name: string;
  qty: number | string;
  unit: string | null;
  expires_at: string | null; // YYYY-MM-DD
  aliases: string[] | null;
  image_path: string | null;
  updated_at: string | null;
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
function expiryStatus(expiresAt: string | null) {
  if (!expiresAt) return { kind: "none" as const, days: null as number | null };
  const today = startOfToday();
  const exp = parseDateOnlyISO(expiresAt);
  const d = daysBetween(today, exp);
  if (d < 0) return { kind: "expired" as const, days: d };
  if (d <= 30) return { kind: "soon" as const, days: d };
  return { kind: "ok" as const, days: d };
}
function compareByExpiry(a: { expires_at: string | null; name: string }, b: { expires_at: string | null; name: string }) {
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
function parseQty(v: Item["qty"]) {
  if (v === null || v === undefined) return 1;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
}
function aliasesToCsv(a: string[] | null | undefined) {
  return (a ?? []).join(", ");
}
function csvToAliases(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
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

export default function RoomPage() {
  const router = useRouter();
  const params = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();
  const roomId = params.roomId;

  const [session, setSession] = useState<Session | null>(null);
  const user: User | null = session?.user ?? null;

  const [household, setHousehold] = useState<{ id: string; name: string } | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [room, setRoom] = useState<Room | null>(null);

  const [cols, setCols] = useState<Col[]>([]);
  const [cellsByCol, setCellsByCol] = useState<Record<string, Cell[]>>({});
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // All cells across household (for location picker)
  const [cellsFull, setCellsFull] = useState<CellFull[]>([]);
  const [cellsFullErr, setCellsFullErr] = useState<string | null>(null);

  // Storage signed urls
  const [signedUrlByPath, setSignedUrlByPath] = useState<Record<string, string>>({});

  // Add item form
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [aliasesCsv, setAliasesCsv] = useState("");
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Edit item
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("1");
  const [editUnit, setEditUnit] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [editAliasesCsv, setEditAliasesCsv] = useState("");
  const [editCellId, setEditCellId] = useState<string>("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Pick-on-map (within this room)
  const [pickMode, setPickMode] = useState(false);

  // Location search filter
  const [locQuery, setLocQuery] = useState("");

  // Selected cell object (from view)
  const selectedCellFull = useMemo(() => {
    if (!selectedCellId) return null;
    return cellsFull.find((c) => c.cell_id === selectedCellId) ?? null;
  }, [cellsFull, selectedCellId]);

  // When landing with ?cell=... select it
  useEffect(() => {
    const cid = searchParams.get("cell");
    if (cid) setSelectedCellId(cid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

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
  }

  // ESC cancels pick mode
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPickMode(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function loadHousehold(u: User) {
    setErr(null);

    const hm = await supabase
      .from("household_members")
      .select("household_id, households:households(id,name)")
      .eq("user_id", u.id)
      .limit(1)
      .single();

    if (hm.error) {
      setErr(`Household load failed: ${hm.error.message}`);
      return null;
    }

    const row = hm.data as unknown as HouseholdRow;
    const hid = row.household_id;
    const h = row.households;
    if (!hid || !h) {
      setErr("No household found. (Check trigger handle_new_user_v2)");
      return null;
    }
    setHousehold({ id: h.id, name: h.name });
    return h.id;
  }

  async function loadRooms(hid: string) {
    const r = await supabase.from("rooms").select("id,household_id,name,position").eq("household_id", hid).order("position", { ascending: true });
    if (r.error) {
      setErr(`Rooms load failed: ${r.error.message}`);
      return;
    }
    setRooms((r.data as Room[]) ?? []);
  }

  async function loadRoom(roomId: string) {
    const r = await supabase.from("rooms").select("id,household_id,name,position").eq("id", roomId).single();
    if (r.error) {
      setErr(`Room load failed: ${r.error.message}`);
      return;
    }
    setRoom(r.data as Room);
  }

  async function loadLayout(roomId: string) {
    // columns
    const c = await supabase.from("room_columns").select("id,room_id,name,position").eq("room_id", roomId).order("position", { ascending: true });
    if (c.error) {
      setErr(`Columns load failed: ${c.error.message}`);
      return;
    }
    const colsData = (c.data as Col[]) ?? [];
    setCols(colsData);

    // cells for all columns
    if (colsData.length === 0) {
      setCellsByCol({});
      return;
    }
    const colIds = colsData.map((x) => x.id);
    const rc = await supabase.from("room_cells").select("id,column_id,code,name,position").in("column_id", colIds).order("position", { ascending: true });
    if (rc.error) {
      setErr(`Cells load failed: ${rc.error.message}`);
      return;
    }
    const by: Record<string, Cell[]> = {};
    ((rc.data as Cell[]) ?? []).forEach((cell) => {
      const k = cell.column_id;
      if (!by[k]) by[k] = [];
      by[k].push(cell);
    });
    // ensure order
    for (const k of Object.keys(by)) by[k].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    setCellsByCol(by);
  }

  async function loadCellsFull(hid: string) {
    setCellsFullErr(null);
    const q = await supabase
      .from("v_room_cells_full")
      .select("cell_id,cell_code,cell_name,cell_position,column_id,column_name,column_position,room_id,room_name,room_position,household_id")
      .eq("household_id", hid)
      .order("room_position", { ascending: true })
      .order("column_position", { ascending: true })
      .order("cell_position", { ascending: true });

    if (q.error) {
      setCellsFullErr(q.error.message);
      setCellsFull([]);
      return;
    }
    setCellsFull((q.data as CellFull[]) ?? []);
  }

  async function refreshItems(cellId: string) {
    const q = await supabase
      .from("items_v2")
      .select("id,cell_id,name,qty,unit,expires_at,aliases,image_path,updated_at")
      .eq("cell_id", cellId)
      .gt("qty", 0)
      .limit(1000);

    if (q.error) {
      setErr(`Items load failed: ${q.error.message}`);
      setItems([]);
      return;
    }

    const rows = ((q.data as Item[]) ?? [])
      .slice()
      .sort((a, b) => compareByExpiry({ expires_at: a.expires_at, name: a.name }, { expires_at: b.expires_at, name: b.name }));

    setItems(rows);

    const paths = rows.map((r) => r.image_path).filter(Boolean) as string[];
    await ensureSignedUrls(paths);
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

  useEffect(() => {
    if (!user) return;
    (async () => {
      const hid = await loadHousehold(user);
      if (!hid) return;
      await loadRooms(hid);
      await loadRoom(roomId);
      await loadLayout(roomId);
      await loadCellsFull(hid);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, roomId]);

  // If selected cell changes, load items
  useEffect(() => {
    if (!selectedCellId) {
      setItems([]);
      return;
    }
    refreshItems(selectedCellId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCellId]);

  function fmtCellLabel(c: CellFull) {
    const short = c.cell_code?.trim() ? c.cell_code.trim() : "Cell";
    const nm = c.cell_name?.trim() ? c.cell_name.trim() : "";
    return `${c.room_name} / ${c.column_name} / ${short}${nm ? ` (${nm})` : ""}`;
  }

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
    const name = prompt("Column name (e.g. Pantry / Dresser):", "New column");
    if (!name) return;
    const nextPos = (cols.reduce((m, c) => Math.max(m, c.position ?? 0), 0) || 0) + 1;

    const ins = await supabase
      .from("room_columns")
      .insert({ room_id: room.id, name: name.trim(), position: nextPos, created_by: user.id })
      .select("id,room_id,name,position")
      .single();

    if (ins.error) return setErr(ins.error.message);
    const newCol = ins.data as Col;
    setCols((prev) => [...prev, newCol].sort((a, b) => a.position - b.position));
    setCellsByCol((prev) => ({ ...prev, [newCol.id]: [] }));
    await loadCellsFull(room.household_id);
  }

  async function renameColumn(colId: string, current: string) {
    const v = prompt("Rename column:", current);
    if (v === null) return;
    const up = await supabase.from("room_columns").update({ name: v.trim() }).eq("id", colId);
    if (up.error) return setErr(up.error.message);
    setCols((prev) => prev.map((c) => (c.id === colId ? { ...c, name: v.trim() } : c)));
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
    const name = prompt("Cell name (optional):", "");
    if (name === null) return;

    const arr = cellsByCol[colId] ?? [];
    const nextPos = (arr.reduce((m, c) => Math.max(m, c.position ?? 0), 0) || 0) + 1;

    const ins = await supabase
      .from("room_cells")
      .insert({ column_id: colId, code: code.trim() || null, name: name.trim() || null, position: nextPos, created_by: user.id })
      .select("id,column_id,code,name,position")
      .single();

    if (ins.error) return setErr(ins.error.message);

    setCellsByCol((prev) => {
      const next = { ...prev };
      next[colId] = [...(next[colId] ?? []), ins.data as Cell].sort((a, b) => a.position - b.position);
      return next;
    });

    if (household) await loadCellsFull(household.id);
  }

  async function editCell(cell: Cell) {
    const code = prompt("Edit cell code:", cell.code ?? "");
    if (code === null) return;
    const name = prompt("Edit cell name:", cell.name ?? "");
    if (name === null) return;

    const up = await supabase.from("room_cells").update({ code: code.trim() || null, name: name.trim() || null }).eq("id", cell.id);
    if (up.error) return setErr(up.error.message);

    setCellsByCol((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        next[k] = (next[k] ?? []).map((c) => (c.id === cell.id ? { ...c, code: code.trim() || null, name: name.trim() || null } : c));
      }
      return next;
    });

    if (household) await loadCellsFull(household.id);
  }

  async function deleteCell(cellId: string) {
    // Safety: block delete if has items
    const check = await supabase.from("items_v2").select("id").eq("cell_id", cellId).gt("qty", 0).limit(1);
    if (!check.error && (check.data ?? []).length > 0) {
      alert("This cell has items. Move items out before deleting.");
      return;
    }

    if (!confirm("Delete this cell?")) return;
    const del = await supabase.from("room_cells").delete().eq("id", cellId);
    if (del.error) return setErr(del.error.message);

    setCellsByCol((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) next[k] = (next[k] ?? []).filter((c) => c.id !== cellId);
      return next;
    });
    if (selectedCellId === cellId) setSelectedCellId(null);

    if (household) await loadCellsFull(household.id);
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

    setErr(null);

    const ins = await supabase
      .from("items_v2")
      .insert({
        cell_id: selectedCellId,
        name: n,
        qty: safeQty,
        unit: unit.trim() || null,
        expires_at: expiresAt ? expiresAt : null,
        aliases: csvToAliases(aliasesCsv),
        image_path: null,
      })
      .select("id")
      .single();

    if (ins.error) return setErr(ins.error.message);

    const itemId = String((ins.data as any)?.id);

    try {
      if (newImageFile) {
        setUploading(true);
        const path = await uploadItemImage(household.id, itemId, newImageFile);
        const up = await supabase.from("items_v2").update({ image_path: path }).eq("id", itemId);
        if (up.error) throw up.error;
        await ensureSignedUrls([path]);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Image upload failed.");
    } finally {
      setUploading(false);
    }

    setName("");
    setQty("1");
    setUnit("");
    setExpiresAt("");
    setAliasesCsv("");
    setNewImageFile(null);

    await refreshItems(selectedCellId);
  }

  function startEdit(it: Item) {
    setEditingId(it.id);
    setEditName(it.name ?? "");
    setEditQty(String(parseQty(it.qty)));
    setEditUnit(it.unit ?? "");
    setEditExpiresAt(it.expires_at ?? "");
    setEditAliasesCsv(aliasesToCsv(it.aliases));
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
    setEditExpiresAt("");
    setEditAliasesCsv("");
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

    setSavingEdit(true);
    setErr(null);

    try {
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

      const targetCell = cellsFull.find((c) => c.cell_id === editCellId);
      cancelEdit();

      // If moved to a different room, jump there and select the cell
      if (targetCell && targetCell.room_id !== roomId) {
        router.push(`/rooms/${targetCell.room_id}?cell=${targetCell.cell_id}`);
        return;
      }

      // Same room: just refresh items for current selected cell
      if (selectedCellId) await refreshItems(selectedCellId);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed.");
    } finally {
      setUploading(false);
      setSavingEdit(false);
    }
  }

  async function deleteItem(itemId: string) {
    const del = await supabase.from("items_v2").delete().eq("id", itemId);
    if (del.error) return setErr(del.error.message);
    setItems((prev) => prev.filter((x) => x.id !== itemId));
    if (editingId === itemId) cancelEdit();
  }

  // Click cell behavior: normal select OR pickMode updates editCellId
  function onCellClick(cellId: string) {
    if (pickMode && editingId) {
      setEditCellId(cellId);
      setPickMode(false);
      return;
    }
    setSelectedCellId(cellId);
  }

  if (!session) return <AuthGate onAuthed={(s) => setSession(s)} />;

  const selectedCellLabel = selectedCellFull ? fmtCellLabel(selectedCellFull) : "Select a cell";

  return (
    <div className="wrap">
      <header className="header">
        <div>
          <div className="title">{room?.name ?? "Room"}</div>
          <div className="sub">
            Household: <span className="mono">{household?.name ?? "…"}</span>
          </div>
        </div>

        <div className="headerOps">
          <select
            className="select"
            value={roomId}
            onChange={(e) => {
              const id = e.target.value;
              router.push(`/rooms/${id}`);
            }}
          >
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
      </header>

      {(err || cellsFullErr) && (
        <div className="errBox">
          <div className="errTitle">Error</div>
          {err && <div className="errLine">{err}</div>}
          {cellsFullErr && <div className="errLine">Cells view: {cellsFullErr}</div>}
        </div>
      )}

      {pickMode && editingId && (
        <div className="pickBanner">
          <div>
            <div className="pickTitle">Pick a cell on the map</div>
            <div className="pickSub">Click any cell in this room to set location. Press ESC to cancel.</div>
          </div>
          <button className="pill ghost" onClick={() => setPickMode(false)}>
            Cancel
          </button>
        </div>
      )}

      <div className="main">
        {/* Left: dynamic columns/cells for this room */}
        <section className="left">
          <div className="leftTop">
            <div className="leftTitle">Layout</div>
            <button className="pill" onClick={addColumn}>
              + Column
            </button>
          </div>

          <div className="cols">
            {cols.map((col) => {
              const cells = cellsByCol[col.id] ?? [];
              return (
                <div key={col.id} className="colCard">
                  <div className="colHead">
                    <div className="colName">{col.name}</div>
                    <div className="colOps">
                      <button className="pill" onClick={() => renameColumn(col.id, col.name)}>
                        Rename
                      </button>
                      <button className="pill ghost" onClick={() => deleteColumn(col.id)}>
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="colOps2">
                    <button className="pill" onClick={() => addCell(col.id)}>
                      + Cell
                    </button>
                  </div>

                  <div className="cells">
                    {cells.length === 0 ? (
                      <div className="emptySmall">No cells yet.</div>
                    ) : (
                      cells.map((cell) => {
                        const code = (cell.code ?? "Cell").trim() || "Cell";
                        const nm = (cell.name ?? "").trim();
                        const isSelected = selectedCellId === cell.id;
                        const isPickSelected = pickMode && editingId && editCellId === cell.id;

                        return (
                          <button
                            key={cell.id}
                            className={`cellBtn ${isSelected ? "selected" : ""} ${pickMode && editingId ? "pickable" : ""} ${isPickSelected ? "pickSelected" : ""}`}
                            onClick={() => onCellClick(cell.id)}
                          >
                            <div className="cellTop">
                              <div className="cellCode">{code}</div>
                              <div className="cellTinyOps">
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
                            {nm ? <div className="cellName">{nm}</div> : <div className="cellName dim">—</div>}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
            {cols.length === 0 && <div className="empty">No columns. Click “+ Column”.</div>}
          </div>
        </section>

        {/* Right: items for selected cell */}
        <aside className="right">
          <div className="card">
            <div className="cardTitle">Selected</div>
            <div className="sel">{selectedCellLabel}</div>
          </div>

          {!selectedCellId ? (
            <div className="empty">Select a cell on the left.</div>
          ) : (
            <>
              <div className="card">
                <div className="cardTitle">Add item</div>
                <div className="form">
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />

                  <div className="row">
                    <input className="input qty" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" inputMode="decimal" />
                    <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit" />
                    <button className="primary" onClick={addItem} disabled={!name.trim() || uploading}>
                      Add
                    </button>
                  </div>

                  <input
                    className="input"
                    value={aliasesCsv}
                    onChange={(e) => setAliasesCsv(e.target.value)}
                    placeholder="Aliases (comma-separated): e.g. 黑胡椒, peppercorn"
                  />

                  <div className="row">
                    <input className="input" type="file" accept="image/*" onChange={(e) => setNewImageFile(e.target.files?.[0] ?? null)} />
                  </div>
                  <div className="hint">{newImageFile ? `Selected: ${newImageFile.name}` : "Optional image"}</div>

                  <div className="expiryBlock">
                    <div className="expiryLabel">Expire date</div>
                    <div className="pillRow">
                      <button className="pill" type="button" onClick={() => setExpiryPreset(setExpiresAt, "1y")}>+1 year</button>
                      <button className="pill" type="button" onClick={() => setExpiryPreset(setExpiresAt, "3m")}>+3 months</button>
                      <button className="pill" type="button" onClick={() => setExpiryPreset(setExpiresAt, "1m")}>+1 month</button>
                      <button className="pill" type="button" onClick={() => setExpiryPreset(setExpiresAt, "1w")}>+1 week</button>
                      <button className="pill ghost" type="button" onClick={() => setExpiresAt("")}>Clear</button>
                    </div>
                    <div className="expiryCustomRow">
                      <input className="input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                      <div className="hint">{expiresAt ? `Selected: ${expiresAt}` : "Optional"}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="itemsHeader">
                <div className="itemsTitle">Items</div>
                <div className="itemsCount">{items.length}</div>
              </div>

              {items.length === 0 ? (
                <div className="empty">No items.</div>
              ) : (
                <ul className="list">
                  {items.map((it) => {
                    const isEditing = editingId === it.id;
                    const st = expiryStatus(it.expires_at);
                    const itemClass = st.kind === "expired" ? "item expired" : st.kind === "soon" ? "item soon" : "item";

                    const img = it.image_path ? signedUrlByPath[it.image_path] ?? null : null;

                    return (
                      <li key={it.id} className={itemClass}>
                        {!isEditing ? (
                          <>
                            {img ? <img className="thumb" src={img} alt={it.name} /> : <div className="thumb placeholder" />}
                            <div className="itemLeft">
                              <div className="itemName">{it.name}</div>
                              <div className="itemMeta">
                                {parseQty(it.qty)} {it.unit ?? ""}
                                {it.expires_at ? ` · ${it.expires_at}` : ""}
                              </div>
                            </div>
                            <div className="itemOps">
                              <button className="pill" onClick={() => startEdit(it)}>Edit</button>
                              <button className="pill ghost" onClick={() => deleteItem(it.id)}>Delete</button>
                            </div>
                          </>
                        ) : (
                          <div className="editWrap">
                            <div className="locCard">
                              <div className="locHead">
                                <div>
                                  <div className="locTitle">Location</div>
                                  <div className="locSub">Search any room, or pick on map (this room)</div>
                                </div>
                                <div className="locBtns">
                                  <button className="pill" type="button" onClick={() => setPickMode((v) => !v)}>
                                    {pickMode ? "Picking…" : "Pick on map"}
                                  </button>
                                  <button className="pill ghost" type="button" onClick={() => setPickMode(false)}>Stop</button>
                                </div>
                              </div>

                              <div className="locGrid">
                                <input className="input" value={locQuery} onChange={(e) => setLocQuery(e.target.value)} placeholder="Search location (room / column / code / name)…" />
                                <select className="select" value={editCellId} onChange={(e) => setEditCellId(e.target.value)}>
                                  <option value="" disabled>Select a location…</option>
                                  {locationOptions.map((o) => (
                                    <option key={o.id} value={o.id}>{o.label}</option>
                                  ))}
                                </select>
                              </div>

                              {pickMode && <div className="hint">Pick mode ON: click a cell on the left (ESC to cancel).</div>}
                            </div>

                            <div className="editGrid">
                              <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" />
                              <input className="input qty" value={editQty} onChange={(e) => setEditQty(e.target.value)} placeholder="Qty" inputMode="decimal" />
                              <input className="input" value={editUnit} onChange={(e) => setEditUnit(e.target.value)} placeholder="Unit" />
                            </div>

                            <input className="input" value={editAliasesCsv} onChange={(e) => setEditAliasesCsv(e.target.value)} placeholder="Aliases (comma-separated)" />

                            <div className="row">
                              <input className="input" type="file" accept="image/*" onChange={(e) => setEditImageFile(e.target.files?.[0] ?? null)} />
                            </div>
                            <div className="hint">{editImageFile ? `Selected: ${editImageFile.name}` : "Optional: replace image"}</div>

                            <div className="expiryBlock">
                              <div className="expiryLabel">Expire date</div>
                              <div className="pillRow">
                                <button className="pill" type="button" onClick={() => setExpiryPreset(setEditExpiresAt, "1y")}>+1 year</button>
                                <button className="pill" type="button" onClick={() => setExpiryPreset(setEditExpiresAt, "3m")}>+3 months</button>
                                <button className="pill" type="button" onClick={() => setExpiryPreset(setEditExpiresAt, "1m")}>+1 month</button>
                                <button className="pill" type="button" onClick={() => setExpiryPreset(setEditExpiresAt, "1w")}>+1 week</button>
                                <button className="pill ghost" type="button" onClick={() => setEditExpiresAt("")}>Clear</button>
                              </div>
                              <div className="expiryCustomRow">
                                <input className="input" type="date" value={editExpiresAt} onChange={(e) => setEditExpiresAt(e.target.value)} />
                                <div className="hint">{editExpiresAt ? `Selected: ${editExpiresAt}` : "Optional"}</div>
                              </div>
                            </div>

                            <div className="editActions">
                              <button className="pill ghost" onClick={cancelEdit} disabled={savingEdit || uploading}>Cancel</button>
                              <button className="primary" onClick={() => saveEdit(it.id)} disabled={savingEdit || uploading || !editName.trim()}>
                                {savingEdit ? "Saving…" : "Save"}
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

          --warnBg: #fff7d1;
          --warnBorder: #e8d48a;
          --expBg: #ffecec;
          --expBorder: #f0b3b3;
        }
        body { margin:0; background:var(--bg); color:var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
        * { box-sizing: border-box; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }
        .wrap { padding: 16px; }
        .header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom: 12px; }
        .title { font-weight: 900; font-size: 20px; }
        .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
        .headerOps { display:flex; gap: 8px; align-items:center; flex-wrap: wrap; justify-content:flex-end; }
        .select { padding: 10px; border-radius: 12px; border: 1px solid var(--border); background: var(--panel2); font-size: 14px; }
        .select:focus { outline:none; border-color: rgba(47,93,124,.5); box-shadow: 0 0 0 4px rgba(47,93,124,.12); }

        .pill { padding: 8px 10px; border-radius: 999px; border: 1px solid rgba(47, 93, 124, 0.25); background: rgba(47, 93, 124, 0.08); color: var(--blue); font-weight: 900; font-size: 12px; cursor:pointer; }
        .pill.ghost { background: transparent; border-color: var(--border); color: rgba(31,35,40,0.75); }
        .primary { padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(47, 93, 124, 0.35); background: var(--blue); color: #fff; font-weight: 900; cursor: pointer; }
        .primary:disabled { opacity: .6; cursor:not-allowed; }

        .errBox { border: 1px solid #f0caca; background: #fff1f1; border-radius: var(--radius); padding: 12px; margin-bottom: 12px; }
        .errTitle { font-weight: 900; margin-bottom: 6px; }
        .errLine { font-size: 12px; color: rgba(31,35,40,.85); }

        .pickBanner { border: 1px solid rgba(47, 93, 124, 0.25); background: rgba(47, 93, 124, 0.08); border-radius: var(--radius); padding: 12px; box-shadow: var(--shadow); display:flex; justify-content:space-between; align-items:center; gap: 12px; margin-bottom: 12px; }
        .pickTitle { font-weight: 900; font-size: 12px; }
        .pickSub { font-size: 12px; color: rgba(31,35,40,.72); margin-top: 2px; }

        .main { display:flex; gap: 16px; align-items:flex-start; }
        .left { flex: 1; min-width: 0; }
        .right { width: 460px; min-width: 0; }

        .leftTop { display:flex; justify-content:space-between; align-items:center; gap: 12px; margin-bottom: 12px; }
        .leftTitle { font-weight: 900; }

        .cols { display:grid; grid-auto-flow: column; grid-auto-columns: minmax(240px, 1fr); gap: 12px; overflow-x:auto; padding-bottom: 8px; }
        .colCard { border:1px solid var(--border2); background: var(--panel); border-radius: var(--radius); box-shadow: var(--shadow); padding: 12px; display:grid; gap: 10px; min-width: 0; }
        .colHead { display:flex; justify-content:space-between; align-items:flex-start; gap: 10px; }
        .colName { font-weight: 900; min-width: 0; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .colOps { display:flex; gap: 8px; flex-wrap: wrap; justify-content:flex-end; }
        .colOps2 { display:flex; justify-content:flex-start; }

        .cells { display:grid; gap: 10px; align-content:start; min-width: 0; }
        .cellBtn { border:1px solid var(--border); background: var(--panel2); border-radius: 12px; padding: 10px; cursor:pointer; text-align:left; min-width:0; overflow:hidden; transition: transform 80ms ease, border-color 120ms ease, background 120ms ease; }
        .cellBtn:hover { transform: translateY(-1px); border-color: rgba(47,93,124,.25); background: #fff; }
        .cellBtn.selected { background: rgba(47,93,124,.08); border-color: rgba(47,93,124,.35); }
        .cellBtn.pickable { outline: 2px dashed rgba(47,93,124,.35); outline-offset: 2px; }
        .cellBtn.pickSelected { outline: 3px solid rgba(47,93,124,.75); background: rgba(47,93,124,.10); }

        .cellTop { display:flex; justify-content:space-between; align-items:center; gap: 8px; }
        .cellCode { font-weight: 900; min-width:0; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cellTinyOps { display:flex; gap: 6px; flex: 0 0 auto; }
        .tiny { border:1px solid var(--border); background: transparent; border-radius: 10px; padding: 4px 8px; font-size: 12px; cursor:pointer; }
        .tiny.danger { border-color: rgba(155,28,28,.35); color: rgba(155,28,28,.95); }
        .cellName { font-size: 12px; color: rgba(31,35,40,.78); margin-top: 6px; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cellName.dim { color: var(--muted); }

        .card { border:1px solid var(--border2); background: var(--panel); border-radius: var(--radius); box-shadow: var(--shadow); padding: 12px; margin-bottom: 12px; }
        .cardTitle { font-size: 12px; font-weight: 900; margin-bottom: 8px; }
        .sel { font-size: 12px; color: rgba(31,35,40,.82); }

        .form { display:grid; gap: 10px; }
        .row { display:flex; gap: 8px; align-items:center; }
        .input { padding: 10px; border-radius: 12px; border: 1px solid var(--border); background: var(--panel2); width: 100%; font-size: 14px; min-width: 0; }
        .input:focus { outline:none; border-color: rgba(47,93,124,.5); box-shadow: 0 0 0 4px rgba(47,93,124,.12); }
        .input.qty { width: 110px; flex: 0 0 auto; }
        .hint { font-size: 12px; color: var(--muted); margin-top: -6px; }

        .expiryBlock { border: 1px solid var(--border2); background: rgba(47,93,124,.03); border-radius: 12px; padding: 10px; display:grid; gap: 8px; }
        .expiryLabel { font-size: 12px; font-weight: 900; color: rgba(31,35,40,.78); }
        .pillRow { display:flex; flex-wrap: wrap; gap: 8px; }
        .expiryCustomRow { display:grid; gap: 6px; }

        .itemsHeader { display:flex; justify-content:space-between; align-items:baseline; gap: 10px; margin-top: 8px; margin-bottom: 8px; }
        .itemsTitle { font-weight: 900; }
        .itemsCount { font-size: 12px; color: var(--muted); }

        .list { list-style:none; padding:0; margin:0; display:grid; gap: 8px; }
        .item { border:1px solid var(--border); background: var(--panel); border-radius: var(--radius); padding: 12px; display:flex; align-items:center; gap: 10px; min-width:0; }
        .item.soon { border-color: var(--warnBorder); background: var(--warnBg); }
        .item.expired { border-color: var(--expBorder); background: var(--expBg); }

        .thumb { width: 44px; height: 44px; border-radius: 12px; object-fit: cover; border: 1px solid rgba(31,35,40,.1); flex: 0 0 auto; }
        .thumb.placeholder { background: rgba(31,35,40,.06); border: 1px dashed rgba(31,35,40,.16); }

        .itemLeft { flex: 1 1 auto; min-width:0; }
        .itemName { font-weight: 900; white-space: nowrap; overflow:hidden; text-overflow: ellipsis; }
        .itemMeta { font-size: 12px; color: var(--muted); margin-top: 2px; }
        .itemOps { display:flex; gap: 8px; flex: 0 0 auto; flex-wrap: wrap; justify-content:flex-end; }

        .editWrap { width: 100%; display:grid; gap: 10px; }
        .locCard { border: 1px solid var(--border2); background: rgba(47,93,124,.03); border-radius: 12px; padding: 10px; display:grid; gap: 10px; }
        .locHead { display:flex; justify-content:space-between; align-items:flex-start; gap: 10px; }
        .locTitle { font-size: 12px; font-weight: 900; }
        .locSub { font-size: 12px; color: rgba(31,35,40,.72); margin-top: 2px; }
        .locBtns { display:flex; gap: 8px; flex-wrap: wrap; justify-content:flex-end; }
        .locGrid { display:grid; grid-template-columns: 1fr 1fr; gap: 8px; }

        .editGrid { display:grid; grid-template-columns: 1fr 110px 1fr; gap: 8px; }
        .editActions { display:flex; justify-content:flex-end; gap: 8px; }

        .empty { color: var(--muted); font-size: 13px; padding: 12px; }
        .emptySmall { color: var(--muted); font-size: 12px; padding: 6px 2px; }

        @media (max-width: 900px) {
          .wrap { padding: 12px; }
          .main { flex-direction: column; gap: 12px; }
          .right { width: 100%; }
          .cols { grid-auto-columns: minmax(220px, 1fr); }
          .row { display:grid; grid-template-columns: 1fr 1fr; gap: 8px; }
          .input.qty { width: 100%; }
          .primary { grid-column: 1 / -1; width: 100%; }
          .locGrid { grid-template-columns: 1fr; }
          .editGrid { grid-template-columns: 1fr 1fr; }
          .editGrid .input:nth-child(1) { grid-column: 1 / -1; }
          .editActions { justify-content: space-between; }
        }
      `}</style>
    </div>
  );
}
