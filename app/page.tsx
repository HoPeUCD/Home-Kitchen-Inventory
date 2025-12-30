"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Layout:
 * Column 2 now includes K21 + Fridge + Freezer under it.
 */
const KITCHEN_LAYOUT = [
  { title: "Column 1", cells: ["K11", "K12", "K13", "K14", "K15", "K16", "K17", "K18"] },
  { title: "Column 2", cells: ["K21", "K2_FRIDGE", "K2_FREEZER"] },
  { title: "Column 3", cells: ["K31", "K32", "K33", "K34", "K35", "K36"] },
  { title: "Column 4", cells: ["K41", "K42", "K43", "K44", "K45"] },
  { title: "Column 5", cells: ["K51", "K52", "K53", "K54", "K55", "K56"] },
  { title: "Column 6", cells: ["K61", "K62", "K63", "K64"] },
  { title: "Column 7", cells: ["K71", "K72"] },
] as const;

/** Pretty labels for special cells */
const CODE_LABELS: Record<string, string> = {
  K2_FRIDGE: "Fridge",
  K2_FREEZER: "Freezer",
};

function displayCode(code: string) {
  const c = code.toUpperCase();
  return CODE_LABELS[c] ?? c;
}

const ALL_CODES = Array.from(new Set(KITCHEN_LAYOUT.flatMap((c) => c.cells.map((x) => x.toUpperCase()))));

type Cell = {
  id: string;
  code: string;
  zone: string | null;
  position: number | null;
};

type Item = {
  id: string;
  cell_id: string;
  name: string;
  qty: number | string | null;
  unit: string | null;
  expires_at?: string | null; // NEW: date string like "2026-01-15" or null
  note?: string | null;
};

type SearchHit = {
  id: string;
  name: string;
  cell_id: string;
  qty: number | string | null;
  unit: string | null;
};

function parseQty(v: Item["qty"]) {
  if (v === null || v === undefined) return 1;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
}

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(base: Date, months: number) {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

function addYears(base: Date, years: number) {
  const d = new Date(base);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

export default function Page() {
  const [cellsByCode, setCellsByCode] = useState<Record<string, Cell>>({});
  const [cellsById, setCellsById] = useState<Record<string, Cell>>({});
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const [items, setItems] = useState<Item[]>([]);

  // per-cell summaries
  const [countByCellId, setCountByCellId] = useState<Record<string, number>>({});
  const [namesByCellId, setNamesByCellId] = useState<Record<string, string[]>>({});

  // add form
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>(""); // NEW: "YYYY-MM-DD" or ""

  // loading + error states
  const [cellsLoading, setCellsLoading] = useState(true);
  const [cellsError, setCellsError] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // search state
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("1");
  const [editUnit, setEditUnit] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState<string>(""); // NEW
  const [savingEdit, setSavingEdit] = useState(false);

  const selectedCell: Cell | null = useMemo(() => {
    if (!selectedCode) return null;
    return cellsByCode[selectedCode.toUpperCase()] ?? null;
  }, [cellsByCode, selectedCode]);

  // Load cells by code list (robust)
  useEffect(() => {
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

      // auto-select first cell existing in DB
      const firstExisting =
        KITCHEN_LAYOUT.flatMap((col) => col.cells.map((x) => x.toUpperCase())).find((code) => byCode[code]) ?? null;

      setSelectedCode((prev) => (prev ? prev.toUpperCase() : firstExisting));
      setCellsLoading(false);
    })();
  }, []);

  async function refreshItems(cellId: string) {
    setItemsError(null);

    const { data, error } = await supabase
      .from("items")
      .select("id,cell_id,name,qty,unit,expires_at,note,updated_at")
      .eq("cell_id", cellId)
      .order("updated_at", { ascending: false });

    if (error) {
      setItemsError(error.message);
      return;
    }
    setItems((data as Item[]) ?? []);
  }

  // counts + ALL names per cell, restricted to this layout
  async function refreshCellSummaries() {
    setSummaryError(null);

    const cellIds = Object.values(cellsByCode).map((c) => c.id);
    if (cellIds.length === 0) {
      setCountByCellId({});
      setNamesByCellId({});
      return;
    }

    const { data, error } = await supabase
      .from("items")
      .select("cell_id,name,updated_at")
      .in("cell_id", cellIds)
      .order("updated_at", { ascending: false });

    if (error) {
      setSummaryError(error.message);
      return;
    }

    const counts: Record<string, number> = {};
    const namesMap: Record<string, string[]> = {};

    (data ?? []).forEach((row: any) => {
      const cellId = row.cell_id as string;
      const itemName = ((row.name as string) ?? "").trim();
      if (!itemName) return;

      counts[cellId] = (counts[cellId] ?? 0) + 1;
      if (!namesMap[cellId]) namesMap[cellId] = [];
      namesMap[cellId].push(itemName);
    });

    setCountByCellId(counts);
    setNamesByCellId(namesMap);
  }

  // when selected cell changes, load items + exit edit mode
  useEffect(() => {
    if (!selectedCell) return;
    setEditingId(null);
    refreshItems(selectedCell.id);
  }, [selectedCell?.id]);

  // when cells loaded, load summaries
  useEffect(() => {
    if (cellsLoading) return;
    refreshCellSummaries();
  }, [cellsLoading, Object.keys(cellsByCode).length]);

  function applyAddExpirePreset(preset: "1y" | "3m" | "1m" | "1w") {
    const now = new Date();
    const d =
      preset === "1y"
        ? addYears(now, 1)
        : preset === "3m"
        ? addMonths(now, 3)
        : preset === "1m"
        ? addMonths(now, 1)
        : addDays(now, 7);
    setExpiresAt(toISODate(d));
  }

  function applyEditExpirePreset(preset: "1y" | "3m" | "1m" | "1w") {
    const now = new Date();
    const d =
      preset === "1y"
        ? addYears(now, 1)
        : preset === "3m"
        ? addMonths(now, 3)
        : preset === "1m"
        ? addMonths(now, 1)
        : addDays(now, 7);
    setEditExpiresAt(toISODate(d));
  }

  async function addItem() {
    if (!selectedCell) return;

    const trimmed = name.trim();
    if (!trimmed) return;

    const qtyNumber = Number(qty || "1");
    const safeQty = Number.isFinite(qtyNumber) ? qtyNumber : 1;

    const expiresValue = expiresAt.trim() ? expiresAt.trim() : null;

    const { error } = await supabase.from("items").insert({
      cell_id: selectedCell.id,
      name: trimmed,
      qty: safeQty,
      unit: unit.trim(),
      expires_at: expiresValue, // NEW
    });

    if (error) {
      setItemsError(error.message);
      return;
    }

    setName("");
    setQty("1");
    setUnit("");
    setExpiresAt(""); // reset

    await refreshItems(selectedCell.id);
    await refreshCellSummaries();
    if (q.trim()) await runSearch(q.trim());
  }

  async function deleteItem(itemId: string) {
    const { error } = await supabase.from("items").delete().eq("id", itemId);
    if (error) {
      setItemsError(error.message);
      return;
    }

    setItems((prev) => prev.filter((x) => x.id !== itemId));
    await refreshCellSummaries();
    if (q.trim()) await runSearch(q.trim());
  }

  // search (fuzzy contains match via ilike)
  async function runSearch(term: string) {
    const t = term.trim();
    if (!t) {
      setHits([]);
      setSearchError(null);
      return;
    }

    setSearching(true);
    setSearchError(null);

    const cellIds = Object.values(cellsByCode).map((c) => c.id);
    if (cellIds.length === 0) {
      setSearching(false);
      setHits([]);
      return;
    }

    const { data, error } = await supabase
      .from("items")
      .select("id,name,cell_id,qty,unit,updated_at")
      .in("cell_id", cellIds)
      .ilike("name", `%${t}%`)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      setSearchError(error.message);
      setHits([]);
      setSearching(false);
      return;
    }

    setHits((data as SearchHit[]) ?? []);
    setSearching(false);
  }

  // debounce search input
  useEffect(() => {
    const term = q;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      runSearch(term);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, Object.keys(cellsByCode).length]);

  function jumpToCell(cellId: string) {
    const cell = cellsById[cellId];
    if (!cell) return;
    setSelectedCode(cell.code.toUpperCase());
  }

  // edit actions
  function startEdit(it: Item) {
    setEditingId(it.id);
    setEditName(it.name ?? "");
    setEditQty(String(parseQty(it.qty)));
    setEditUnit(it.unit ?? "");
    setEditExpiresAt(it.expires_at ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditQty("1");
    setEditUnit("");
    setEditExpiresAt("");
  }

  async function saveEdit(itemId: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;

    const qtyNumber = Number(editQty || "1");
    const safeQty = Number.isFinite(qtyNumber) ? qtyNumber : 1;

    const expiresValue = editExpiresAt.trim() ? editExpiresAt.trim() : null;

    setSavingEdit(true);
    setItemsError(null);

    const { error } = await supabase
      .from("items")
      .update({
        name: trimmed,
        qty: safeQty,
        unit: editUnit.trim(),
        expires_at: expiresValue, // NEW
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);

    setSavingEdit(false);

    if (error) {
      setItemsError(error.message);
      return;
    }

    if (selectedCell) await refreshItems(selectedCell.id);
    await refreshCellSummaries();
    if (q.trim()) await runSearch(q.trim());

    cancelEdit();
  }

  return (
    <div className="app">
      <header className="header">
        <div className="headerTop">
          <div>
            <div className="title">Kitchen Inventory</div>
            <div className="subtitle">
              {cellsLoading ? "Loading…" : selectedCell ? `Selected: ${displayCode(selectedCell.code)}` : "Select a cell"}
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="searchBar">
          <input
            className="searchInput"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search item (fuzzy: contains match)…"
            inputMode="text"
          />
          {searching ? (
            <div className="searchStatus">Searching…</div>
          ) : (
            <div className="searchStatus">{hits.length ? `${hits.length} found` : ""}</div>
          )}
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
                          <div className="resultMeta">
                            {where} · {parseQty(h.qty)} {h.unit ?? ""}
                          </div>
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

      {(cellsError || summaryError || itemsError) && (
        <div className="errorBox">
          <div className="errorTitle">Data error</div>
          {cellsError && <div className="errorLine">Cells: {cellsError}</div>}
          {summaryError && <div className="errorLine">Summaries: {summaryError}</div>}
          {itemsError && <div className="errorLine">Items: {itemsError}</div>}
          <div className="errorHint">If Supabase RLS is enabled without policies, reads/updates may fail or return empty.</div>
        </div>
      )}

      <div className="main">
        {/* Left: layout */}
        <section className="left">
          <div className="columns">
            {KITCHEN_LAYOUT.map((col) => (
              <div key={col.title} className="col">
                <div className="colTitle">{col.title}</div>

                <div className="colCells">
                  {col.cells.map((rawCode) => {
                    const code = rawCode.toUpperCase();
                    const cell = cellsByCode[code];

                    const isLoading = cellsLoading;
                    const missingAfterLoad = !cellsLoading && !cell;
                    const isSelected = selectedCode?.toUpperCase() === code;

                    const count = cell ? countByCellId[cell.id] ?? 0 : 0;
                    const allNames = cell ? namesByCellId[cell.id] ?? [] : [];

                    return (
                      <button
                        key={code}
                        className={`cellBtn ${isSelected ? "selected" : ""}`}
                        disabled={isLoading || missingAfterLoad}
                        onClick={() => cell && setSelectedCode(code)}
                        title={missingAfterLoad ? "Missing cell record in DB for this code" : undefined}
                      >
                        <div className="cellTop">
                          <div className="cellCode">{displayCode(code)}</div>
                          {!isLoading && cell && <div className="badge">{count}</div>}
                        </div>

                        {isLoading ? (
                          <div className="cellMeta emptyMeta">Loading…</div>
                        ) : missingAfterLoad ? (
                          <div className="cellMeta emptyMeta">Missing in DB</div>
                        ) : allNames.length === 0 ? (
                          <div className="cellMeta emptyMeta">Empty</div>
                        ) : (
                          <div className="cellMeta listMeta">
                            {allNames.map((n, idx) => (
                              <div key={`${n}-${idx}`} className="cellItemLine" title={n}>
                                {n}
                              </div>
                            ))}
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

        {/* Right: details */}
        <aside className="right">
          {!selectedCell ? (
            <div className="empty">{cellsLoading ? "Loading…" : "Select a cell to view and edit items."}</div>
          ) : (
            <>
              <div className="card">
                <div className="cardTitle">Add item</div>
                <div className="form">
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Item name"
                    inputMode="text"
                  />

                  <div className="row">
                    <input
                      className="input qty"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      placeholder="Qty"
                      inputMode="decimal"
                    />
                    <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit" />
                    <button className="primary" onClick={addItem}>
                      Add
                    </button>
                  </div>

                  {/* NEW: Expiration controls */}
                  <div className="expireBlock">
                    <div className="expireLabel">Expire date</div>
                    <div className="chipRow">
                      <button className="chip" type="button" onClick={() => applyAddExpirePreset("1y")}>
                        +1 year
                      </button>
                      <button className="chip" type="button" onClick={() => applyAddExpirePreset("3m")}>
                        +3 months
                      </button>
                      <button className="chip" type="button" onClick={() => applyAddExpirePreset("1m")}>
                        +1 month
                      </button>
                      <button className="chip" type="button" onClick={() => applyAddExpirePreset("1w")}>
                        +1 week
                      </button>
                      <button className="chip ghost" type="button" onClick={() => setExpiresAt("")}>
                        Clear
                      </button>
                    </div>
                    <div className="expireInputRow">
                      <input
                        className="input"
                        type="date"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                      />
                      <div className="hint">Custom date</div>
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
                    const exp = it.expires_at ? `Expires: ${it.expires_at}` : "No expiry";

                    return (
                      <li key={it.id} className="item">
                        {!isEditing ? (
                          <>
                            <div className="itemLeft">
                              <div className="itemName">{it.name}</div>
                              <div className="itemMeta">
                                {parseQty(it.qty)} {it.unit ?? ""} · {exp}
                              </div>
                            </div>

                            <div className="itemActions">
                              <button className="neutral" onClick={() => startEdit(it)}>
                                Edit
                              </button>
                              <button className="danger" onClick={() => deleteItem(it.id)}>
                                Delete
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="editWrap">
                            <div className="editGrid">
                              <input
                                className="input"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder="Name"
                              />
                              <input
                                className="input qty"
                                value={editQty}
                                onChange={(e) => setEditQty(e.target.value)}
                                placeholder="Qty"
                                inputMode="decimal"
                              />
                              <input
                                className="input"
                                value={editUnit}
                                onChange={(e) => setEditUnit(e.target.value)}
                                placeholder="Unit"
                              />
                            </div>

                            {/* NEW: Edit expiration controls */}
                            <div className="expireBlock">
                              <div className="expireLabel">Expire date</div>
                              <div className="chipRow">
                                <button className="chip" type="button" onClick={() => applyEditExpirePreset("1y")}>
                                  +1 year
                                </button>
                                <button className="chip" type="button" onClick={() => applyEditExpirePreset("3m")}>
                                  +3 months
                                </button>
                                <button className="chip" type="button" onClick={() => applyEditExpirePreset("1m")}>
                                  +1 month
                                </button>
                                <button className="chip" type="button" onClick={() => applyEditExpirePreset("1w")}>
                                  +1 week
                                </button>
                                <button className="chip ghost" type="button" onClick={() => setEditExpiresAt("")}>
                                  Clear
                                </button>
                              </div>
                              <div className="expireInputRow">
                                <input
                                  className="input"
                                  type="date"
                                  value={editExpiresAt}
                                  onChange={(e) => setEditExpiresAt(e.target.value)}
                                />
                                <div className="hint">Custom date</div>
                              </div>
                            </div>

                            <div className="editActions">
                              <button className="neutral" disabled={savingEdit} onClick={cancelEdit}>
                                Cancel
                              </button>
                              <button
                                className="primary"
                                disabled={savingEdit || !editName.trim()}
                                onClick={() => saveEdit(it.id)}
                              >
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

      {/* Oat + Blue theme */}
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
          --blue2: #3f759a;
          --blueSoft: #e7f0f7;

          --dangerBg: #fff1f1;
          --dangerBorder: #f0caca;

          --shadow: 0 10px 24px rgba(31, 35, 40, 0.06);
          --radius: 14px;
        }

        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
          background: var(--bg);
          color: var(--text);
        }

        .app { padding: 16px; padding-bottom: max(16px, env(safe-area-inset-bottom)); }
        .header { margin-bottom: 12px; }
        .headerTop { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .title { font-size: 20px; font-weight: 900; line-height: 1.2; }
        .subtitle { margin-top: 4px; font-size: 12px; color: var(--muted); }

        .searchBar {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          align-items: center;
          margin-top: 10px;
        }
        .searchInput {
          padding: 10px 12px;
          border-radius: var(--radius);
          border: 1px solid var(--border);
          background: var(--panel2);
          font-size: 14px;
          width: 100%;
          box-shadow: 0 1px 0 rgba(31, 35, 40, 0.03);
        }
        .searchInput:focus {
          outline: none;
          border-color: rgba(47, 93, 124, 0.5);
          box-shadow: 0 0 0 4px rgba(47, 93, 124, 0.12);
        }
        .searchStatus { font-size: 12px; color: var(--muted); white-space: nowrap; }

        .results {
          margin-top: 10px;
          border: 1px solid var(--border2);
          border-radius: var(--radius);
          padding: 8px;
          background: var(--panel);
          box-shadow: var(--shadow);
        }
        .resultsList { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
        .resultBtn {
          width: 100%;
          border: 1px solid var(--border2);
          border-radius: var(--radius);
          padding: 10px;
          background: var(--panel2);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          text-align: left;
          transition: transform 80ms ease, border-color 120ms ease, background 120ms ease;
        }
        .resultBtn:hover {
          transform: translateY(-1px);
          border-color: rgba(47, 93, 124, 0.35);
          background: #ffffff;
        }
        .resultMain { min-width: 0; }
        .resultName { font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .resultMeta { font-size: 12px; color: var(--muted); margin-top: 2px; }
        .resultGo { font-size: 12px; font-weight: 900; color: var(--blue); }
        .emptySmall { font-size: 12px; color: var(--muted); padding: 6px 4px; }

        .errorBox {
          border: 1px solid var(--dangerBorder);
          background: var(--dangerBg);
          border-radius: var(--radius);
          padding: 12px;
          margin-top: 12px;
          margin-bottom: 12px;
        }
        .errorTitle { font-weight: 900; margin-bottom: 6px; }
        .errorLine { font-size: 12px; color: rgba(31, 35, 40, 0.85); margin-top: 2px; }
        .errorHint { font-size: 12px; color: var(--muted); margin-top: 8px; }

        .main { display: flex; gap: 16px; align-items: flex-start; }
        .left { flex: 1; overflow-x: auto; padding-bottom: 6px; }
        .columns { display: flex; gap: 12px; align-items: flex-start; min-height: 420px; }

        .col { min-width: 150px; }
        .colTitle { font-size: 12px; font-weight: 900; color: rgba(31, 35, 40, 0.75); margin-bottom: 8px; }
        .colCells { display: grid; gap: 8px; }

        .cellBtn {
          width: 100%;
          padding: 12px;
          border-radius: var(--radius);
          border: 1px solid var(--border);
          background: var(--panel);
          text-align: left;
          cursor: pointer;
          box-shadow: 0 1px 0 rgba(31, 35, 40, 0.03);
          transition: transform 80ms ease, border-color 120ms ease, background 120ms ease;
        }
        .cellBtn:hover {
          transform: translateY(-1px);
          border-color: rgba(47, 93, 124, 0.25);
          background: #ffffff;
        }
        .cellBtn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
        .cellBtn.selected { background: var(--blueSoft); border-color: rgba(47, 93, 124, 0.35); }

        .cellTop { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
        .cellCode { font-weight: 900; }
        .badge {
          font-size: 12px;
          color: var(--blue);
          border: 1px solid rgba(47, 93, 124, 0.25);
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(47, 93, 124, 0.08);
          flex: 0 0 auto;
        }

        .cellMeta { margin-top: 6px; font-size: 12px; color: rgba(31, 35, 40, 0.78); }
        .emptyMeta { color: var(--muted); }
        .listMeta { max-height: 96px; overflow: auto; padding-right: 4px; }
        .cellItemLine { line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .right { width: 380px; }

        .card {
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 12px;
          background: var(--panel);
          box-shadow: var(--shadow);
        }
        .cardTitle { font-size: 12px; font-weight: 900; margin-bottom: 8px; }

        .form { display: grid; gap: 10px; }
        .row { display: flex; gap: 8px; align-items: center; }

        .input {
          padding: 10px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--panel2);
          width: 100%;
          min-width: 0;
          font-size: 14px;
        }
        .input:focus {
          outline: none;
          border-color: rgba(47, 93, 124, 0.5);
          box-shadow: 0 0 0 4px rgba(47, 93, 124, 0.12);
        }
        .input.qty { width: 110px; flex: 0 0 auto; }

        .primary {
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(47, 93, 124, 0.35);
          background: var(--blue);
          color: #fff;
          font-weight: 900;
          cursor: pointer;
          transition: transform 80ms ease, background 120ms ease;
        }
        .primary:hover { transform: translateY(-1px); background: var(--blue2); }
        .primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        .neutral, .danger {
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 8px 10px;
          cursor: pointer;
          background: var(--panel2);
        }

        .itemsHeader {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          margin-top: 12px;
          margin-bottom: 8px;
        }
        .itemsTitle { font-size: 12px; font-weight: 900; }
        .itemsCount { font-size: 12px; color: var(--muted); }

        .list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }

        .item {
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 12px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          background: var(--panel);
          box-shadow: 0 1px 0 rgba(31, 35, 40, 0.03);
        }
        .itemLeft { min-width: 0; }
        .itemName { font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .itemMeta { font-size: 12px; color: var(--muted); margin-top: 2px; }
        .itemActions { display: flex; gap: 8px; flex: 0 0 auto; }

        .editWrap { width: 100%; display: grid; gap: 10px; }
        .editGrid { display: grid; grid-template-columns: 1fr 110px 1fr; gap: 8px; align-items: center; }
        .editActions { display: flex; justify-content: flex-end; gap: 8px; }

        /* NEW: expiration UI */
        .expireBlock { border: 1px solid var(--border2); background: var(--panel2); border-radius: 12px; padding: 10px; }
        .expireLabel { font-size: 12px; font-weight: 900; margin-bottom: 8px; color: rgba(31, 35, 40, 0.85); }
        .chipRow { display: flex; gap: 8px; flex-wrap: wrap; }
        .chip {
          border: 1px solid rgba(47, 93, 124, 0.25);
          background: rgba(47, 93, 124, 0.08);
          color: var(--blue);
          padding: 6px 10px;
          border-radius: 999px;
          cursor: pointer;
          font-weight: 800;
          font-size: 12px;
        }
        .chip:hover { background: rgba(47, 93, 124, 0.12); }
        .chip.ghost {
          background: transparent;
          border: 1px solid var(--border);
          color: rgba(31, 35, 40, 0.8);
        }
        .expireInputRow { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
        .hint { font-size: 12px; color: var(--muted); white-space: nowrap; }

        .empty { font-size: 13px; color: var(--muted); }

        @media (max-width: 768px) {
          .app { padding: 12px; }
          .main { flex-direction: column; gap: 12px; }
          .columns { min-height: unset; }
          .col { min-width: 132px; }
          .cellBtn { padding: 10px; }
          .right { width: 100%; }

          .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
          .input.qty { width: 100%; }
          .primary { grid-column: 1 / -1; width: 100%; }

          .searchBar { grid-template-columns: 1fr; gap: 6px; }
          .searchStatus { text-align: right; }

          .listMeta { max-height: 88px; }

          .item { align-items: flex-start; }
          .itemActions { width: 100%; justify-content: flex-end; }

          .editGrid { grid-template-columns: 1fr 1fr; }
          .editGrid .input:nth-child(1) { grid-column: 1 / -1; }
          .editActions { justify-content: space-between; }

          .expireInputRow { flex-direction: column; align-items: stretch; }
          .hint { white-space: normal; }
        }
      `}</style>
    </div>
  );
}