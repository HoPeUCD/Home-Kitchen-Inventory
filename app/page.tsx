"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

/**
 * UPDATED LAYOUT:
 * - Column 5: K51..K57 (added K57 under K56)
 * - Column 6: K61..K65 (added K65 under K64)
 * - New standalone: K81 (Column 8)
 */
const KITCHEN_LAYOUT = [
  { title: "Column 1", cells: ["K11", "K12", "K13", "K14", "K15", "K16", "K17", "K18"] },
  { title: "Column 2", cells: ["K21", "K2_FRIDGE", "K2_FREEZER"] },
  { title: "Column 3", cells: ["K31", "K32", "K33", "K34", "K35", "K36"] },
  { title: "Column 4", cells: ["K41", "K42", "K43", "K44", "K45"] },
  { title: "Column 5", cells: ["K51", "K52", "K53", "K54", "K55", "K56", "K57"] },
  { title: "Column 6", cells: ["K61", "K62", "K63", "K64", "K65"] },
  { title: "Column 7", cells: ["K71", "K72"] },
  { title: "Column 8", cells: ["K81"] },
] as const;

const CODE_LABELS: Record<string, string> = {
  K2_FRIDGE: "Fridge",
  K2_FREEZER: "Freezer",
};
function displayCode(code: string) {
  const c = code.toUpperCase();
  return CODE_LABELS[c] ?? c;
}
const ALL_CODES = Array.from(new Set(KITCHEN_LAYOUT.flatMap((c) => c.cells.map((x) => x.toUpperCase()))));

type Cell = { id: string; code: string; zone: string | null; position: number | null };
type Item = {
  id: string;
  user_id: string | null;
  cell_id: string;
  name: string;
  qty: number | string | null;
  unit: string | null;
  expires_at: string | null; // YYYY-MM-DD
  aliases: string[] | null;
  image_url: string | null;  // legacy public url
  image_path: string | null; // private storage path
  updated_at: string | null;
};
type SearchHit = { id: string; name: string; cell_id: string; qty: number | string | null; unit: string | null };
type ExpiringHit = { id: string; name: string; cell_id: string; expires_at: string; qty: number | string | null; unit: string | null };
type CellLine = { name: string; expires_at: string | null };

function parseQty(v: Item["qty"]) {
  if (v === null || v === undefined) return 1;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
}
function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}
function toDateOnlyISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseDateOnlyISO(s: string) {
  const [y, m, d] = s.split("-").map((x) => Number(x));
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}
function daysBetween(a: Date, b: Date) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.floor((b.getTime() - a.getTime()) / MS);
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
function csvToAliases(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
function aliasesToCsv(a: string[] | null | undefined) {
  return (a ?? []).join(", ");
}

function AuthGate(props: { onAuthed: (session: Session) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setErr(null); setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (data.session) props.onAuthed(data.session);
  }

  async function signUp() {
    setErr(null); setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email, password: pw });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (data.session) props.onAuthed(data.session);
    else setErr("Sign-up successful. Please check your email to confirm, then sign in.");
  }

  return (
    <div className="authWrap">
      <div className="authCard">
        <div className="authTitle">Kitchen Inventory</div>
        <div className="authSub">Sign in required (secure mode)</div>

        <div className="authTabs">
          <button className={`authTab ${mode === "signin" ? "on" : ""}`} onClick={() => setMode("signin")}>Sign in</button>
          <button className={`authTab ${mode === "signup" ? "on" : ""}`} onClick={() => setMode("signup")}>Sign up</button>
        </div>

        <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" inputMode="email" />
        <input className="input" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" type="password" />

        {err && <div className="authErr">{err}</div>}

        <button className="primary" disabled={busy || !email || !pw} onClick={mode === "signin" ? signIn : signUp}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <div className="authHint">
          If you enabled “email confirmation” in Supabase Auth, sign-up requires confirming the email first.
        </div>
      </div>

      <style jsx global>{`
        body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
        .authWrap { min-height: 100vh; display:flex; align-items:center; justify-content:center; padding: 16px; background: #fbf7f0; }
        .authCard { width: min(420px, 100%); background:#fffaf2; border:1px solid #efe6d9; border-radius: 14px; padding: 16px; box-shadow: 0 10px 24px rgba(31,35,40,0.06); display:grid; gap: 10px; }
        .authTitle { font-weight: 900; font-size: 18px; }
        .authSub { font-size: 12px; color:#6b6f76; margin-top:-6px; }
        .authTabs { display:flex; gap: 8px; }
        .authTab { flex:1; padding: 8px 10px; border-radius: 999px; border:1px solid #e7ddcf; background:#fffdf7; cursor:pointer; font-weight: 800; font-size: 12px; }
        .authTab.on { border-color: rgba(47,93,124,0.35); background: rgba(47,93,124,0.08); color:#2f5d7c; }
        .input { padding: 10px; border-radius: 12px; border: 1px solid #e7ddcf; background:#fffdf7; width:100%; font-size:14px; }
        .input:focus { outline:none; border-color: rgba(47,93,124,0.5); box-shadow:0 0 0 4px rgba(47,93,124,0.12); }
        .primary { padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(47,93,124,0.35); background:#2f5d7c; color:#fff; font-weight: 900; cursor:pointer; }
        .primary:disabled { opacity:0.6; cursor:not-allowed; }
        .authErr { font-size:12px; color: rgba(155,28,28,0.95); background:#fff1f1; border:1px solid #f0caca; padding: 10px; border-radius: 12px; }
        .authHint { font-size:12px; color:#6b6f76; }
      `}</style>
    </div>
  );
}

export default function Page() {
  const [session, setSession] = useState<Session | null>(null);
  const user: User | null = session?.user ?? null;

  const [cellsByCode, setCellsByCode] = useState<Record<string, Cell>>({});
  const [cellsById, setCellsById] = useState<Record<string, Cell>>({});
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const [cellsLoading, setCellsLoading] = useState(false);
  const [cellsError, setCellsError] = useState<string | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [itemsError, setItemsError] = useState<string | null>(null);

  const [countByCellId, setCountByCellId] = useState<Record<string, number>>({});
  const [cellLinesByCellId, setCellLinesByCellId] = useState<Record<string, CellLine[]>>({});
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [exp7, setExp7] = useState<ExpiringHit[]>([]);
  const [exp30, setExp30] = useState<ExpiringHit[]>([]);
  const [expError, setExpError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("1");
  const [editUnit, setEditUnit] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState<string>("");
  const [editAliasesCsv, setEditAliasesCsv] = useState("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [signedUrlByPath, setSignedUrlByPath] = useState<Record<string, string>>({});

  const selectedCell: Cell | null = useMemo(() => {
    if (!selectedCode) return null;
    return cellsByCode[selectedCode.toUpperCase()] ?? null;
  }, [cellsByCode, selectedCode]);

  function setExpiryPreset(setter: (v: string) => void, preset: "1w" | "1m" | "3m" | "1y") {
    const now = startOfToday();
    const d = new Date(now);
    if (preset === "1w") d.setDate(d.getDate() + 7);
    if (preset === "1m") d.setMonth(d.getMonth() + 1);
    if (preset === "3m") d.setMonth(d.getMonth() + 3);
    if (preset === "1y") d.setFullYear(d.getFullYear() + 1);
    setter(toDateOnlyISO(d));
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setCellsByCode({}); setCellsById({}); setSelectedCode(null);
    setItems([]); setHits([]); setExp7([]); setExp30([]);
    setSignedUrlByPath({});
  }

  async function uploadItemImage(userId: string, itemId: string, file: File) {
    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Image too large. Please keep under ${MAX_MB}MB.`);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = safeName.includes(".") ? safeName.split(".").pop() : "jpg";
    const path = `${userId}/${itemId}/${Date.now()}.${ext}`;

    const bucket = "item-images";
    const up = await supabase.storage.from(bucket).upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
      cacheControl: "3600",
    });
    if (up.error) throw up.error;

    return path;
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
      for (const [p, url] of results) {
        if (url) next[p] = url;
      }
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) setSession(data.session);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    (async () => {
      setCellsLoading(true);
      setCellsError(null);

      const { data, error } = await supabase.from("cells").select("id,code,zone,position").in("code", ALL_CODES);

      if (error) {
        setCellsError(error.message);
        setCellsLoading(false);
        return;
      }

      const byCode: Record<string, Cell> = {};
      const byId: Record<string, Cell> = {};
      (data as Cell[] | null)?.forEach((c) => {
        const code = c.code.toUpperCase();
        byCode[code] = c;
        byId[c.id] = c;
      });

      setCellsByCode(byCode);
      setCellsById(byId);

      const firstExisting =
        KITCHEN_LAYOUT.flatMap((col) => col.cells.map((x) => x.toUpperCase())).find((code) => byCode[code]) ?? null;

      setSelectedCode((prev) => (prev ? prev.toUpperCase() : firstExisting));
      setCellsLoading(false);
    })();
  }, [user?.id]);

  async function refreshItems(cellId: string) {
    if (!user) return;
    setItemsError(null);

    const { data, error } = await supabase
      .from("items")
      .select("id,user_id,cell_id,name,qty,unit,expires_at,aliases,image_url,image_path,updated_at")
      .eq("cell_id", cellId)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) { setItemsError(error.message); return; }

    const rows = (data as Item[]) ?? [];
    setItems(rows);

    const paths = rows.map((r) => r.image_path).filter(Boolean) as string[];
    await ensureSignedUrls(paths);
  }

  async function refreshCellSummaries() {
    if (!user) return;
    setSummaryError(null);

    const cellIds = Object.values(cellsByCode).map((c) => c.id);
    if (cellIds.length === 0) { setCountByCellId({}); setCellLinesByCellId({}); return; }

    const { data, error } = await supabase
      .from("items")
      .select("cell_id,name,expires_at,updated_at")
      .in("cell_id", cellIds)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(2000);

    if (error) { setSummaryError(error.message); return; }

    const counts: Record<string, number> = {};
    const linesMap: Record<string, CellLine[]> = {};

    (data ?? []).forEach((row: any) => {
      const cellId = String(row.cell_id);
      const itemName = String(row.name ?? "").trim();
      const exp = row.expires_at ? String(row.expires_at) : null;
      if (!itemName) return;

      counts[cellId] = (counts[cellId] ?? 0) + 1;
      if (!linesMap[cellId]) linesMap[cellId] = [];
      linesMap[cellId].push({ name: itemName, expires_at: exp });
    });

    setCountByCellId(counts);
    setCellLinesByCellId(linesMap);
  }

  async function refreshExpiringGlobal() {
    if (!user) return;
    setExpError(null);

    const cellIds = Object.values(cellsByCode).map((c) => c.id);
    if (cellIds.length === 0) { setExp7([]); setExp30([]); return; }

    const { data, error } = await supabase
      .from("items")
      .select("id,name,cell_id,expires_at,qty,unit,updated_at")
      .in("cell_id", cellIds)
      .eq("user_id", user.id)
      .not("expires_at", "is", null)
      .gt("qty", 0)
      .limit(500);

    if (error) { setExpError(error.message); setExp7([]); setExp30([]); return; }

    const today = startOfToday();
    const normalized: ExpiringHit[] = (data ?? [])
      .map((r: any) => ({
        id: String(r.id),
        name: String(r.name ?? "").trim(),
        cell_id: String(r.cell_id),
        expires_at: String(r.expires_at),
        qty: r.qty ?? null,
        unit: r.unit ?? null,
      }))
      .filter((r) => r.name && r.expires_at);

    const within7: ExpiringHit[] = [];
    const within30: ExpiringHit[] = [];
    for (const r of normalized) {
      const exp = parseDateOnlyISO(r.expires_at);
      const d = daysBetween(today, exp);
      if (d < 0) continue;
      if (d <= 7) within7.push(r);
      if (d <= 30) within30.push(r);
    }
    within7.sort((a,b)=> a.expires_at.localeCompare(b.expires_at) || a.name.localeCompare(b.name));
    within30.sort((a,b)=> a.expires_at.localeCompare(b.expires_at) || a.name.localeCompare(b.name));

    setExp7(within7);
    setExp30(within30);
  }

  useEffect(() => {
    if (!user || !selectedCell) return;
    setEditingId(null);
    setEditImageFile(null);
    refreshItems(selectedCell.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, selectedCell?.id]);

  useEffect(() => {
    if (!user) return;
    if (Object.keys(cellsByCode).length === 0) return;
    refreshCellSummaries();
    refreshExpiringGlobal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, Object.keys(cellsByCode).length]);

  async function addItem() {
    if (!user || !selectedCell) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const qtyNumber = Number(qty || "1");
    const safeQty = Number.isFinite(qtyNumber) ? qtyNumber : 1;

    setItemsError(null);

    const ins = await supabase
      .from("items")
      .insert({
        user_id: user.id,
        cell_id: selectedCell.id,
        name: trimmed,
        qty: safeQty,
        unit: unit.trim(),
        expires_at: expiresAt ? expiresAt : null,
        aliases: [],
        image_path: null,
      })
      .select("id")
      .single();

    if (ins.error) { setItemsError(ins.error.message); return; }

    const itemId = String((ins.data as any)?.id);

    try {
      if (newImageFile) {
        setUploading(true);
        const path = await uploadItemImage(user.id, itemId, newImageFile);

        const up = await supabase
          .from("items")
          .update({ image_path: path, updated_at: new Date().toISOString() })
          .eq("id", itemId)
          .eq("user_id", user.id);

        if (up.error) throw up.error;
        await ensureSignedUrls([path]);
      }
    } catch (e: any) {
      setItemsError(e?.message ?? "Image upload failed.");
    } finally {
      setUploading(false);
    }

    setName(""); setQty("1"); setUnit(""); setExpiresAt(""); setNewImageFile(null);

    await refreshItems(selectedCell.id);
    await refreshCellSummaries();
    await refreshExpiringGlobal();
    if (q.trim()) await runSearch(q.trim());
  }

  async function deleteItem(itemId: string) {
    if (!user) return;
    const { error } = await supabase.from("items").delete().eq("id", itemId).eq("user_id", user.id);
    if (error) { setItemsError(error.message); return; }
    setItems((prev) => prev.filter((x) => x.id !== itemId));
    await refreshCellSummaries();
    await refreshExpiringGlobal();
    if (q.trim()) await runSearch(q.trim());
  }

  async function runSearch(term: string) {
    if (!user) return;
    const t = term.trim();
    if (!t) { setHits([]); setSearchError(null); return; }

    setSearching(true);
    setSearchError(null);

    const cellIds = Object.values(cellsByCode).map((c) => c.id);
    if (cellIds.length === 0) { setSearching(false); setHits([]); return; }

    // Prefer RPC if you have it; fallback to ilike
    const rpc = await supabase.rpc("search_items_fuzzy", { term: t, cell_ids: cellIds, lim: 100 });

    if (!rpc.error) {
      const mapped =
        (rpc.data as any[] | null)?.map((r) => ({
          id: String(r.id),
          name: String(r.name ?? ""),
          cell_id: String(r.cell_id),
          qty: r.qty ?? null,
          unit: r.unit ?? null,
        })) ?? [];
      setHits(mapped);
      setSearching(false);
      return;
    }

    const fb = await supabase
      .from("items")
      .select("id,name,cell_id,qty,unit,updated_at")
      .eq("user_id", user.id)
      .in("cell_id", cellIds)
      .ilike("name", `%${t}%`)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (fb.error) { setSearchError(fb.error.message); setHits([]); setSearching(false); return; }

    setHits(((fb.data as any[]) ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      cell_id: String(r.cell_id),
      qty: r.qty ?? null,
      unit: r.unit ?? null,
    })));
    setSearching(false);
  }

  useEffect(() => {
    if (!user) return;
    const term = q;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { runSearch(term); }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, user?.id, Object.keys(cellsByCode).length]);

  function jumpToCell(cellId: string) {
    const cell = cellsById[cellId];
    if (!cell) return;
    setSelectedCode(cell.code.toUpperCase());
  }

  function startEdit(it: Item) {
    setEditingId(it.id);
    setEditName(it.name ?? "");
    setEditQty(String(parseQty(it.qty)));
    setEditUnit(it.unit ?? "");
    setEditExpiresAt(it.expires_at ?? "");
    setEditAliasesCsv(aliasesToCsv(it.aliases));
    setEditImageFile(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditName(""); setEditQty("1"); setEditUnit(""); setEditExpiresAt(""); setEditAliasesCsv("");
    setEditImageFile(null);
  }

  async function saveEdit(itemId: string) {
    if (!user) return;
    const trimmed = editName.trim();
    if (!trimmed) return;

    const qtyNumber = Number(editQty || "1");
    const safeQty = Number.isFinite(qtyNumber) ? qtyNumber : 1;

    setSavingEdit(true);
    setItemsError(null);

    try {
      const base = await supabase
        .from("items")
        .update({
          name: trimmed,
          qty: safeQty,
          unit: editUnit.trim(),
          expires_at: editExpiresAt ? editExpiresAt : null,
          aliases: csvToAliases(editAliasesCsv),
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemId)
        .eq("user_id", user.id);

      if (base.error) throw base.error;

      if (editImageFile) {
        setUploading(true);
        const path = await uploadItemImage(user.id, itemId, editImageFile);

        const up = await supabase
          .from("items")
          .update({ image_path: path, updated_at: new Date().toISOString() })
          .eq("id", itemId)
          .eq("user_id", user.id);

        if (up.error) throw up.error;
        await ensureSignedUrls([path]);
      }

      if (selectedCell) await refreshItems(selectedCell.id);
      await refreshCellSummaries();
      await refreshExpiringGlobal();
      if (q.trim()) await runSearch(q.trim());

      cancelEdit();
    } catch (e: any) {
      setItemsError(e?.message ?? "Save failed.");
    } finally {
      setUploading(false);
      setSavingEdit(false);
    }
  }

  if (!session) {
    return <AuthGate onAuthed={(s) => setSession(s)} />;
  }

  const dataError = cellsError || summaryError || itemsError;

  return (
    <div className="app">
      <header className="header">
        <div className="headerTop">
          <div>
            <div className="title">Kitchen Inventory</div>
            <div className="subtitle">
              Signed in as <span className="mono">{user?.email ?? user?.id}</span>
              {uploading ? " · Uploading…" : ""}
            </div>
          </div>
          <button className="pill ghost" onClick={signOut}>Sign out</button>
        </div>

        <div className="expCard">
          <div className="expHeader">
            <div className="expTitle">Expiring soon</div>
            <div className="expMeta">Text list · tap to jump</div>
          </div>

          {expError ? (
            <div className="expError">Expiring view error: {expError}</div>
          ) : (
            <div className="expGrid">
              <div className="expCol">
                <div className="expColTitle">Within 7 days</div>
                <ul className="expTextList">
                  {exp7.length === 0 ? (
                    <li className="expEmptyLi">None</li>
                  ) : (
                    exp7.map((it) => {
                      const cell = cellsById[it.cell_id];
                      const where = cell ? displayCode(cell.code) : "Unknown";
                      return (
                        <li key={it.id}>
                          <button className="expLink" onClick={() => jumpToCell(it.cell_id)}>
                            {it.name} — {where} — {it.expires_at}
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>

              <div className="expCol">
                <div className="expColTitle">Within 30 days</div>
                <ul className="expTextList">
                  {exp30.length === 0 ? (
                    <li className="expEmptyLi">None</li>
                  ) : (
                    exp30.map((it) => {
                      const cell = cellsById[it.cell_id];
                      const where = cell ? displayCode(cell.code) : "Unknown";
                      return (
                        <li key={it.id}>
                          <button className="expLink" onClick={() => jumpToCell(it.cell_id)}>
                            {it.name} — {where} — {it.expires_at}
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="searchBar">
          <input className="searchInput" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item (fuzzy)…" />
          <div className="searchStatus">{searching ? "Searching…" : hits.length ? `${hits.length} found` : ""}</div>
        </div>

        {searchError && (
          <div className="errorBox">
            <div className="errorTitle">Search error</div>
            <div className="errorLine">{searchError}</div>
          </div>
        )}

        {q.trim() && !searching && (
          <div className="results">
            {hits.length === 0 ? (
              <div className="emptySmall">No match.</div>
            ) : (
              <ul className="resultsList">
                {hits.map((h) => {
                  const cell = cellsById[h.cell_id];
                  const where = cell ? displayCode(cell.code) : "Unknown";
                  return (
                    <li key={h.id} className="resultRow">
                      <button className="resultBtn" onClick={() => jumpToCell(h.cell_id)}>
                        <div className="resultMain">
                          <div className="resultName">{h.name}</div>
                          <div className="resultMeta">{where} · {parseQty(h.qty)} {h.unit ?? ""}</div>
                        </div>
                        <div className="resultGo">Go</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </header>

      {dataError && (
        <div className="errorBox">
          <div className="errorTitle">Data error</div>
          {cellsError && <div className="errorLine">Cells: {cellsError}</div>}
          {summaryError && <div className="errorLine">Summaries: {summaryError}</div>}
          {itemsError && <div className="errorLine">Items: {itemsError}</div>}
        </div>
      )}

      <div className="main">
        <section className="left">
          <div className="kCols">
            {KITCHEN_LAYOUT.map((col) => (
              <div key={col.title} className="kCol">
                <div className="kColTitle">{col.title}</div>
                <div className="kColCells">
                  {col.cells.map((rawCode) => {
                    const code = rawCode.toUpperCase();
                    const cell = cellsByCode[code];
                    const missingAfterLoad = !cellsLoading && !cell;
                    const isSelected = selectedCode?.toUpperCase() === code;

                    const count = cell ? countByCellId[cell.id] ?? 0 : 0;
                    const lines = cell ? cellLinesByCellId[cell.id] ?? [] : [];

                    return (
                      <button
                        key={code}
                        className={`cellBtn ${isSelected ? "selected" : ""}`}
                        disabled={cellsLoading || missingAfterLoad}
                        onClick={() => cell && setSelectedCode(code)}
                      >
                        <div className="cellTop">
                          <div className="cellCode">{displayCode(code)}</div>
                          {!cellsLoading && cell && <div className="badge">{count}</div>}
                        </div>

                        {cellsLoading ? (
                          <div className="cellMeta emptyMeta">Loading…</div>
                        ) : missingAfterLoad ? (
                          <div className="cellMeta emptyMeta">Missing in DB</div>
                        ) : lines.length === 0 ? (
                          <div className="cellMeta emptyMeta">Empty</div>
                        ) : (
                          <div className="cellMeta chipWrap">
                            {lines.map((ln, idx) => {
                              const st = expiryStatus(ln.expires_at);
                              const chipClass =
                                st.kind === "expired" ? "chip chipExpired" : st.kind === "soon" ? "chip chipSoon" : "chip";
                              return (
                                <div key={`${ln.name}-${idx}`} className={chipClass} title={ln.expires_at ? `${ln.name} · ${ln.expires_at}` : ln.name}>
                                  {ln.name}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="right">
          {!selectedCell ? (
            <div className="empty">{cellsLoading ? "Loading…" : "Select a cell to view and edit items."}</div>
          ) : (
            <>
              <div className="card">
                <div className="cardTitle">Add item</div>

                <div className="form">
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />

                  <div className="row">
                    <input className="input qty" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" inputMode="decimal" />
                    <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit" />
                    <button className="primary" onClick={addItem} disabled={!name.trim() || uploading}>Add</button>
                  </div>

                  <div className="row">
                    <input className="input" type="file" accept="image/*" onChange={(e) => setNewImageFile(e.target.files?.[0] ?? null)} />
                  </div>
                  <div className="hint">{newImageFile ? `Selected image: ${newImageFile.name}` : "Optional: upload an item photo"}</div>

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
                      <div className="expiryHint">{expiresAt ? `Selected: ${expiresAt}` : "Optional"}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="itemsHeader">
                <div className="itemsTitle">Items in {displayCode(selectedCell.code)}</div>
                <div className="itemsCount">{items.length} total</div>
              </div>

              {items.length === 0 ? (
                <div className="empty">No items yet.</div>
              ) : (
                <ul className="list">
                  {items.map((it) => {
                    const isEditing = editingId === it.id;
                    const st = expiryStatus(it.expires_at);
                    const itemClass = st.kind === "expired" ? "item expired" : st.kind === "soon" ? "item soon" : "item";
                    const expiryText =
                      it.expires_at && st.days !== null
                        ? st.kind === "expired"
                          ? `Expired: ${it.expires_at}`
                          : st.kind === "soon"
                          ? `Expires: ${it.expires_at} (${st.days}d)`
                          : `Expires: ${it.expires_at}`
                        : "";

                    const img =
                      it.image_url && it.image_url.startsWith("http")
                        ? it.image_url
                        : it.image_path
                        ? signedUrlByPath[it.image_path] ?? null
                        : null;

                    return (
                      <li key={it.id} className={itemClass}>
                        {!isEditing ? (
                          <>
                            {img ? <img className="thumb" src={img} alt={it.name} /> : <div className="thumb placeholder" />}

                            <div className="itemLeft">
                              <div className="itemName">{it.name}</div>
                              <div className="itemMeta">
                                {parseQty(it.qty)} {it.unit ?? ""}
                                {expiryText ? ` · ${expiryText}` : ""}
                              </div>
                            </div>

                            <div className="itemActions">
                              <button className="neutral" onClick={() => startEdit(it)}>Edit</button>
                              <button className="danger" onClick={() => deleteItem(it.id)}>Delete</button>
                            </div>
                          </>
                        ) : (
                          <div className="editWrap">
                            <div className="editGrid">
                              <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" />
                              <input className="input qty" value={editQty} onChange={(e) => setEditQty(e.target.value)} placeholder="Qty" inputMode="decimal" />
                              <input className="input" value={editUnit} onChange={(e) => setEditUnit(e.target.value)} placeholder="Unit" />
                            </div>

                            <input
                              className="input"
                              value={editAliasesCsv}
                              onChange={(e) => setEditAliasesCsv(e.target.value)}
                              placeholder="Aliases (comma-separated): e.g. 黑胡椒, 胡椒, peppercorn"
                            />

                            <div className="row">
                              <input className="input" type="file" accept="image/*" onChange={(e) => setEditImageFile(e.target.files?.[0] ?? null)} />
                            </div>
                            <div className="hint">{editImageFile ? `Selected image: ${editImageFile.name}` : "Optional: replace item photo"}</div>

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
                                <div className="expiryHint">{editExpiresAt ? `Selected: ${editExpiresAt}` : "Optional"}</div>
                              </div>
                            </div>

                            <div className="editActions">
                              <button className="neutral" disabled={savingEdit || uploading} onClick={cancelEdit}>Cancel</button>
                              <button className="primary" disabled={savingEdit || uploading || !editName.trim()} onClick={() => saveEdit(it.id)}>
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
          --blueSoft: #e7f0f7;

          --warnBg: #fff7d1;
          --warnBorder: #e8d48a;

          --expBg: #ffecec;
          --expBorder: #f0b3b3;

          --dangerBg: #fff1f1;
          --dangerBorder: #f0caca;

          --shadow: 0 10px 24px rgba(31, 35, 40, 0.06);
          --radius: 14px;
        }
        * { box-sizing: border-box; }
        body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }

        .app { padding: 16px; padding-bottom: max(16px, env(safe-area-inset-bottom)); }
        .header { margin-bottom: 12px; }
        .headerTop { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 10px; }
        .title { font-size: 20px; font-weight: 900; line-height: 1.2; }
        .subtitle { margin-top: 4px; font-size: 12px; color: var(--muted); }

        .expCard { border: 1px solid var(--border2); background: var(--panel); border-radius: var(--radius); box-shadow: var(--shadow); padding: 10px; margin-top: 10px; margin-bottom: 10px; }
        .expHeader { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom: 8px; }
        .expTitle { font-weight: 900; font-size: 12px; }
        .expMeta { font-size: 12px; color: var(--muted); text-align:right; }
        .expError { font-size: 12px; color: rgba(155,28,28,0.9); }
        .expGrid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; min-width:0; }
        .expColTitle { font-size: 12px; font-weight: 900; color: rgba(31,35,40,0.75); margin-bottom: 6px; }
        .expTextList { list-style: disc; padding-left: 18px; margin: 0; max-height: 160px; overflow: auto; display:grid; gap: 4px; }
        .expEmptyLi { color: var(--muted); font-size: 12px; }
        .expLink { appearance:none; border:none; background:transparent; padding:0; margin:0; font:inherit; color:inherit; cursor:pointer; text-align:left; line-height:1.35; }
        .expLink:hover { text-decoration: underline; text-decoration-color: rgba(47,93,124,0.55); }

        .searchBar { display:grid; grid-template-columns: 1fr auto; gap:10px; align-items:center; margin-top: 10px; }
        .searchInput { padding: 10px 12px; border-radius: var(--radius); border:1px solid var(--border); background: var(--panel2); font-size: 14px; width:100%; box-shadow: 0 1px 0 rgba(31,35,40,0.03); }
        .searchInput:focus { outline:none; border-color: rgba(47,93,124,0.5); box-shadow: 0 0 0 4px rgba(47,93,124,0.12); }
        .searchStatus { font-size:12px; color: var(--muted); white-space:nowrap; }

        .results { margin-top:10px; border:1px solid var(--border2); border-radius: var(--radius); padding: 8px; background: var(--panel); box-shadow: var(--shadow); }
        .resultsList { list-style:none; padding:0; margin:0; display:grid; gap:6px; }
        .resultBtn { width:100%; border:1px solid var(--border2); border-radius: var(--radius); padding:10px; background: var(--panel2); cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:12px; text-align:left; transition: transform 80ms ease, border-color 120ms ease, background 120ms ease; }
        .resultBtn:hover { transform: translateY(-1px); border-color: rgba(47,93,124,0.35); background:#ffffff; }
        .resultMain { min-width:0; }
        .resultName { font-weight: 900; white-space: nowrap; overflow:hidden; text-overflow: ellipsis; }
        .resultMeta { font-size:12px; color: var(--muted); margin-top:2px; }
        .resultGo { font-size:12px; font-weight: 900; color: var(--blue); }
        .emptySmall { font-size:12px; color: var(--muted); padding:6px 4px; }

        .errorBox { border:1px solid var(--dangerBorder); background: var(--dangerBg); border-radius: var(--radius); padding: 12px; margin-top: 12px; margin-bottom: 12px; }
        .errorTitle { font-weight: 900; margin-bottom: 6px; }
        .errorLine { font-size:12px; color: rgba(31,35,40,0.85); margin-top: 2px; }

        .main { display:flex; gap:16px; align-items:flex-start; }
        .left { flex:1; overflow-x:auto; padding-bottom: 8px; min-width:0; }
        .kCols { display:grid; grid-auto-flow: column; grid-auto-columns: minmax(160px, 1fr); gap:12px; align-items:start; justify-content:start; padding-bottom: 4px; min-width:0; }
        .kCol { display:grid; grid-template-rows: auto 1fr; gap:8px; min-width:0; }
        .kColTitle { font-size:12px; font-weight:900; color: rgba(31,35,40,0.75); }
        .kColCells { display:grid; gap:10px; align-content:start; min-width:0; }

        .cellBtn {
          width:100%;
          display:flex; flex-direction:column; align-items:stretch; gap:8px;
          padding:12px; border-radius: var(--radius);
          border:1px solid var(--border); background: var(--panel);
          text-align:left; cursor:pointer;
          min-height: 92px;
          min-width:0; overflow:hidden; position:relative;
          transition: transform 80ms ease, border-color 120ms ease, background 120ms ease;
        }
        .cellBtn:hover { transform: translateY(-1px); border-color: rgba(47,93,124,0.25); background:#ffffff; z-index:2; }
        .cellBtn:disabled { opacity:0.55; cursor:not-allowed; }
        .cellBtn.selected { background: var(--blueSoft); border-color: rgba(47,93,124,0.35); }
        .cellTop { display:flex; justify-content:space-between; align-items:center; gap:8px; min-width:0; }
        .cellCode { font-weight: 900; min-width:0; }
        .badge { font-size:12px; color: var(--blue); border:1px solid rgba(47,93,124,0.25); padding: 2px 8px; border-radius: 999px; background: rgba(47,93,124,0.08); flex:0 0 auto; }
        .cellMeta { font-size:12px; color: rgba(31,35,40,0.78); min-width:0; }
        .emptyMeta { color: var(--muted); }
        .chipWrap { display:flex; flex-wrap:wrap; gap:6px; max-height:120px; overflow:auto; padding-right:4px; min-width:0; }
        .chip {
          flex: 1 1 auto; min-width:0; max-width:100%;
          background: rgba(31,35,40,0.06);
          border:1px solid rgba(31,35,40,0.08);
          border-radius: 999px;
          padding:4px 8px;
          line-height:1.2;
          white-space: normal;
          overflow-wrap:anywhere;
          word-break: break-word;
          display:-webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow:hidden;
        }
        .chipSoon { background: var(--warnBg); border-color: var(--warnBorder); }
        .chipExpired { background: var(--expBg); border-color: var(--expBorder); }

        .right { width: 420px; min-width:0; }
        .card { border:1px solid var(--border); border-radius: var(--radius); padding:12px; background: var(--panel); box-shadow: var(--shadow); }
        .cardTitle { font-size:12px; font-weight:900; margin-bottom:8px; }
        .form { display:grid; gap:10px; min-width:0; }
        .row { display:flex; gap:8px; align-items:center; min-width:0; }
        .input { padding:10px; border-radius:12px; border:1px solid var(--border); background: var(--panel2); width:100%; min-width:0; font-size:14px; }
        .input:focus { outline:none; border-color: rgba(47,93,124,0.5); box-shadow: 0 0 0 4px rgba(47,93,124,0.12); }
        .input.qty { width:110px; flex: 0 0 auto; }

        .primary { padding:10px 12px; border-radius:12px; border:1px solid rgba(47,93,124,0.35); background: var(--blue); color:#fff; font-weight:900; cursor:pointer; }
        .primary:disabled { opacity:0.6; cursor:not-allowed; }

        .pill { padding:8px 10px; border-radius:999px; border:1px solid rgba(47,93,124,0.25); background: rgba(47,93,124,0.08); color: var(--blue); font-weight:900; font-size:12px; cursor:pointer; }
        .pill.ghost { background: transparent; border-color: var(--border); color: rgba(31,35,40,0.75); }

        .hint { font-size:12px; color: var(--muted); margin-top:-6px; }
        .itemsHeader { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-top:12px; margin-bottom:8px; }
        .itemsTitle { font-size:12px; font-weight:900; }
        .itemsCount { font-size:12px; color: var(--muted); }

        .list { list-style:none; padding:0; margin:0; display:grid; gap:8px; min-width:0; }
        .thumb { width:44px; height:44px; border-radius:12px; object-fit:cover; border:1px solid rgba(31,35,40,0.1); flex:0 0 auto; }
        .thumb.placeholder { background: rgba(31,35,40,0.06); border:1px dashed rgba(31,35,40,0.16); }

        .item { border:1px solid var(--border); border-radius: var(--radius); padding:12px; display:flex; justify-content:space-between; gap:10px; align-items:center; background: var(--panel); min-width:0; }
        .item.soon { border-color: var(--warnBorder); background: var(--warnBg); }
        .item.expired { border-color: var(--expBorder); background: var(--expBg); }
        .itemLeft { min-width:0; flex:1 1 auto; }
        .itemName { font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .itemMeta { font-size:12px; color: var(--muted); margin-top:2px; }
        .itemActions { display:flex; gap:8px; flex:0 0 auto; }
        .neutral,.danger { border:1px solid var(--border); border-radius:12px; padding:8px 10px; cursor:pointer; background: var(--panel2); }
        .editWrap { width:100%; display:grid; gap:10px; min-width:0; }
        .editGrid { display:grid; grid-template-columns: 1fr 110px 1fr; gap:8px; align-items:center; min-width:0; }
        .editActions { display:flex; justify-content:flex-end; gap:8px; }
        .expiryBlock { border:1px solid var(--border2); background: rgba(47,93,124,0.03); border-radius:12px; padding:10px; display:grid; gap:8px; }
        .expiryLabel { font-size:12px; font-weight:900; color: rgba(31,35,40,0.78); }
        .pillRow { display:flex; flex-wrap:wrap; gap:8px; }
        .expiryCustomRow { display:grid; gap:6px; }
        .expiryHint { font-size:12px; color: var(--muted); }
        .empty { font-size:13px; color: var(--muted); }

        @media (max-width: 768px) {
          .app { padding:12px; }
          .main { flex-direction:column; gap:12px; }
          .expGrid { grid-template-columns: 1fr; }
          .right { width:100%; }
          .kCols { grid-auto-columns: minmax(140px, 1fr); }
          .row { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
          .input.qty { width:100%; }
          .primary { grid-column: 1 / -1; width:100%; }
          .searchBar { grid-template-columns: 1fr; gap:6px; }
          .searchStatus { text-align:right; }
          .editGrid { grid-template-columns: 1fr 1fr; }
          .editGrid .input:nth-child(1) { grid-column: 1 / -1; }
          .editActions { justify-content:space-between; }
        }
      `}</style>
    </div>
  );
}
