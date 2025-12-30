"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

const KITCHEN_LAYOUT = [
  { title: "Column 1", cells: ["K11", "K12", "K13", "K14", "K15", "K16", "K17", "K18"] },
  { title: "Column 2", cells: ["K21"] },
  { title: "Column 3", cells: ["K31", "K32", "K33", "K34", "K35", "K36"] },
  { title: "Column 4", cells: ["K41", "K42", "K43", "K44", "K45"] },
  { title: "Column 5", cells: ["K51", "K52", "K53", "K54", "K55", "K56"] },
  { title: "Column 6", cells: ["K61", "K62", "K63", "K64"] },
  { title: "Column 7", cells: ["K71", "K72"] },
] as const;

const ALL_CODES = Array.from(
  new Set(KITCHEN_LAYOUT.flatMap((c) => c.cells.map((x) => x.toUpperCase())))
);

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
  note?: string | null;
};

function parseQty(v: Item["qty"]) {
  if (v === null || v === undefined) return 1;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
}

export default function Page() {
  const [cellsByCode, setCellsByCode] = useState<Record<string, Cell>>({});
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const [items, setItems] = useState<Item[]>([]);

  const [countByCellId, setCountByCellId] = useState<Record<string, number>>({});
  const [namesByCellId, setNamesByCellId] = useState<Record<string, string[]>>({});

  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");

  // Loading + error states (prevents flash + helps diagnose “no data”)
  const [cellsLoading, setCellsLoading] = useState(true);
  const [cellsError, setCellsError] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const selectedCell: Cell | null = useMemo(() => {
    if (!selectedCode) return null;
    return cellsByCode[selectedCode.toUpperCase()] ?? null;
  }, [cellsByCode, selectedCode]);

  // Load cells by CODE list (robust; does not depend on zone)
  useEffect(() => {
    (async () => {
      setCellsLoading(true);
      setCellsError(null);

      const { data, error } = await supabase
        .from("cells")
        .select("id,code,zone,position")
        .in("code", ALL_CODES);

      if (error) {
        setCellsError(error.message);
        setCellsLoading(false);
        return;
      }

      const map: Record<string, Cell> = {};
      (data as Cell[] | null)?.forEach((c) => {
        map[c.code.toUpperCase()] = c;
      });
      setCellsByCode(map);

      // Auto-select the first code that exists in DB
      const firstExisting =
        KITCHEN_LAYOUT.flatMap((col) => col.cells.map((x) => x.toUpperCase())).find((code) => map[code]) ?? null;

      setSelectedCode((prev) => (prev ? prev.toUpperCase() : firstExisting));
      setCellsLoading(false);
    })();
  }, []);

  async function refreshItems(cellId: string) {
    setItemsError(null);
    const { data, error } = await supabase
      .from("items")
      .select("id,cell_id,name,qty,unit,note,updated_at")
      .eq("cell_id", cellId)
      .order("updated_at", { ascending: false });

    if (error) {
      setItemsError(error.message);
      return;
    }
    setItems((data as Item[]) ?? []);
  }

  // Fetch per-cell summaries ONLY for cells in your layout
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

  // When selected cell changes, load its items
  useEffect(() => {
    if (!selectedCell) return;
    refreshItems(selectedCell.id);
  }, [selectedCell?.id]);

  // When cells are loaded, load summaries
  useEffect(() => {
    if (cellsLoading) return;
    refreshCellSummaries();
  }, [cellsLoading, Object.keys(cellsByCode).length]);

  async function addItem() {
    if (!selectedCell) return;

    const trimmed = name.trim();
    if (!trimmed) return;

    const qtyNumber = Number(qty || "1");
    const safeQty = Number.isFinite(qtyNumber) ? qtyNumber : 1;

    const { error } = await supabase.from("items").insert({
      cell_id: selectedCell.id,
      name: trimmed,
      qty: safeQty,
      unit: unit.trim(),
    });

    if (error) {
      setItemsError(error.message);
      return;
    }

    setName("");
    setQty("1");
    setUnit("");

    await refreshItems(selectedCell.id);
    await refreshCellSummaries();
  }

  async function deleteItem(itemId: string) {
    const { error } = await supabase.from("items").delete().eq("id", itemId);
    if (error) {
      setItemsError(error.message);
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== itemId));
    await refreshCellSummaries();
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <div className="title">Kitchen Inventory</div>
          <div className="subtitle">
            {cellsLoading ? "Loading…" : selectedCell ? `Selected: ${selectedCell.code}` : "Select a cell"}
          </div>
        </div>
      </header>

      {(cellsError || summaryError || itemsError) && (
        <div className="errorBox">
          <div className="errorTitle">Data loading error</div>
          {cellsError && <div className="errorLine">Cells: {cellsError}</div>}
          {summaryError && <div className="errorLine">Summaries: {summaryError}</div>}
          {itemsError && <div className="errorLine">Items: {itemsError}</div>}
          <div className="errorHint">
            If you recently enabled Supabase RLS and added no policies, reads will fail or return empty.
          </div>
        </div>
      )}

      <div className="main">
        {/* Left */}
        <section className="left">
          <div className="columns">
            {KITCHEN_LAYOUT.map((col) => (
              <div key={col.title} className="col">
                <div className="colTitle">{col.title}</div>

                <div className="colCells">
                  {col.cells.map((rawCode) => {
                    const code = rawCode.toUpperCase();
                    const cell = cellsByCode[code];

                    // prevent “Not in DB” flash: during loading we show Loading state instead
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
                          <div className="cellCode">{code}</div>
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

        {/* Right */}
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
                    <input
                      className="input"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="Unit"
                      inputMode="text"
                    />
                    <button className="primary" onClick={addItem}>
                      Add
                    </button>
                  </div>
                </div>
              </div>

              <div className="itemsHeader">
                <div className="itemsTitle">Items in {selectedCell.code}</div>
                <div className="itemsCount">{items.length} total</div>
              </div>

              {items.length === 0 ? (
                <div className="empty">No items yet.</div>
              ) : (
                <ul className="list">
                  {items.map((it) => (
                    <li key={it.id} className="item">
                      <div className="itemLeft">
                        <div className="itemName">{it.name}</div>
                        <div className="itemMeta">
                          {parseQty(it.qty)} {it.unit ?? ""}
                        </div>
                      </div>
                      <button className="danger" onClick={() => deleteItem(it.id)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>

      <style jsx global>{`
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
          background: #fff;
          color: #111;
        }

        .app {
          padding: 16px;
          padding-bottom: max(16px, env(safe-area-inset-bottom));
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }
        .title {
          font-size: 20px;
          font-weight: 900;
          line-height: 1.2;
        }
        .subtitle {
          margin-top: 4px;
          font-size: 12px;
          opacity: 0.75;
        }

        .errorBox {
          border: 1px solid #f2c9c9;
          background: #fff6f6;
          border-radius: 12px;
          padding: 12px;
          margin-bottom: 12px;
        }
        .errorTitle {
          font-weight: 900;
          margin-bottom: 6px;
        }
        .errorLine {
          font-size: 12px;
          opacity: 0.9;
          margin-top: 2px;
        }
        .errorHint {
          font-size: 12px;
          opacity: 0.75;
          margin-top: 8px;
        }

        .main {
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }

        .left {
          flex: 1;
          overflow-x: auto;
          padding-bottom: 6px;
        }

        .columns {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          min-height: 420px;
        }

        .col {
          min-width: 150px;
        }

        .colTitle {
          font-size: 12px;
          font-weight: 900;
          opacity: 0.8;
          margin-bottom: 8px;
        }

        .colCells {
          display: grid;
          gap: 8px;
        }

        .cellBtn {
          width: 100%;
          padding: 12px;
          border-radius: 12px;
          border: 1px solid #ddd;
          background: #fff;
          text-align: left;
          cursor: pointer;
        }
        .cellBtn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .cellBtn.selected {
          background: #f3f3f3;
          border-color: #cfcfcf;
        }

        .cellTop {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          align-items: center;
        }
        .cellCode {
          font-weight: 900;
        }
        .badge {
          font-size: 12px;
          opacity: 0.8;
          border: 1px solid #eee;
          padding: 2px 8px;
          border-radius: 999px;
          background: #fff;
          flex: 0 0 auto;
        }

        .cellMeta {
          margin-top: 6px;
          font-size: 12px;
          opacity: 0.8;
        }
        .emptyMeta {
          opacity: 0.6;
        }

        .listMeta {
          max-height: 96px;
          overflow: auto;
          padding-right: 4px;
        }

        .cellItemLine {
          line-height: 1.25;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .right {
          width: 380px;
        }

        .card {
          border: 1px solid #eee;
          border-radius: 12px;
          padding: 12px;
        }
        .cardTitle {
          font-size: 12px;
          font-weight: 900;
          margin-bottom: 8px;
        }

        .form {
          display: grid;
          gap: 8px;
        }

        .row {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .input {
          padding: 10px;
          border-radius: 10px;
          border: 1px solid #ddd;
          width: 100%;
          min-width: 0;
          font-size: 14px;
        }
        .input.qty {
          width: 110px;
          flex: 0 0 auto;
        }

        .primary {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #111;
          background: #111;
          color: #fff;
          font-weight: 900;
          cursor: pointer;
          flex: 0 0 auto;
        }

        .itemsHeader {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          margin-top: 12px;
          margin-bottom: 8px;
        }
        .itemsTitle {
          font-size: 12px;
          font-weight: 900;
        }
        .itemsCount {
          font-size: 12px;
          opacity: 0.7;
        }

        .list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 8px;
        }

        .item {
          border: 1px solid #eee;
          border-radius: 12px;
          padding: 12px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
        }
        .itemLeft {
          min-width: 0;
        }
        .itemName {
          font-weight: 900;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .itemMeta {
          font-size: 12px;
          opacity: 0.75;
          margin-top: 2px;
        }

        .danger {
          border: 1px solid #ddd;
          border-radius: 10px;
          padding: 8px 10px;
          cursor: pointer;
          background: #fff;
          flex: 0 0 auto;
        }

        .empty {
          font-size: 13px;
          opacity: 0.7;
        }

        @media (max-width: 768px) {
          .app {
            padding: 12px;
          }
          .main {
            flex-direction: column;
            gap: 12px;
          }
          .columns {
            min-height: unset;
          }
          .col {
            min-width: 132px;
          }
          .cellBtn {
            padding: 10px;
          }
          .right {
            width: 100%;
          }
          .row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
          .input.qty {
            width: 100%;
          }
          .primary {
            grid-column: 1 / -1;
            width: 100%;
          }
          .listMeta {
            max-height: 88px;
          }
        }
      `}</style>
    </div>
  );
}