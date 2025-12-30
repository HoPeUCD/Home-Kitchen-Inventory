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

  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");

  const selectedCell: Cell | null = useMemo(() => {
    if (!selectedCode) return null;
    return cellsByCode[selectedCode] ?? null;
  }, [cellsByCode, selectedCode]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("cells").select("*").eq("zone", "kitchen");
      if (error) {
        console.error("Failed to load cells:", error.message);
        return;
      }

      const map: Record<string, Cell> = {};
      (data as Cell[] | null)?.forEach((c) => (map[c.code] = c));
      setCellsByCode(map);

      const firstCode = KITCHEN_LAYOUT.flatMap((col) => col.cells).find((code) => map[code]) ?? null;
      setSelectedCode((prev) => prev ?? firstCode);
    })();
  }, []);

  async function refreshItems(cellId: string) {
    const { data, error } = await supabase
      .from("items")
      .select("id,cell_id,name,qty,unit,note,updated_at")
      .eq("cell_id", cellId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Failed to load items:", error.message);
      return;
    }
    setItems((data as Item[]) ?? []);
  }

  async function refreshCounts() {
    const { data, error } = await supabase.from("items").select("cell_id");
    if (error) {
      console.error("Failed to load item counts:", error.message);
      return;
    }
    const counts: Record<string, number> = {};
    (data ?? []).forEach((row: any) => {
      const id = row.cell_id as string;
      counts[id] = (counts[id] ?? 0) + 1;
    });
    setCountByCellId(counts);
  }

  useEffect(() => {
    if (!selectedCell) return;
    refreshItems(selectedCell.id);
  }, [selectedCell?.id]);

  useEffect(() => {
    refreshCounts();
  }, [Object.keys(cellsByCode).length]);

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
      console.error("Failed to add item:", error.message);
      return;
    }

    setName("");
    setQty("1");
    setUnit("");

    await refreshItems(selectedCell.id);
    await refreshCounts();
  }

  async function deleteItem(itemId: string) {
    const { error } = await supabase.from("items").delete().eq("id", itemId);
    if (error) {
      console.error("Failed to delete item:", error.message);
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== itemId));
    await refreshCounts();
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <div className="title">Kitchen Inventory</div>
          <div className="subtitle">
            {selectedCell ? `Selected: ${selectedCell.code}` : "Select a cell"}
          </div>
        </div>
      </header>

      <div className="main">
        {/* Left: Cabinet columns */}
        <section className="left">
          <div className="columns">
            {KITCHEN_LAYOUT.map((col) => (
              <div key={col.title} className="col">
                <div className="colTitle">{col.title}</div>

                <div className="colCells">
                  {col.cells.map((code) => {
                    const cell = cellsByCode[code];
                    const disabled = !cell;
                    const isSelected = selectedCode === code;
                    const count = cell ? countByCellId[cell.id] ?? 0 : 0;

                    return (
                      <button
                        key={code}
                        className={`cellBtn ${isSelected ? "selected" : ""}`}
                        disabled={disabled}
                        onClick={() => cell && setSelectedCode(code)}
                        title={disabled ? "Cell not found in DB (did you insert it?)" : undefined}
                      >
                        <div className="cellTop">
                          <div className="cellCode">{code}</div>
                          {!disabled && <div className="badge">{count}</div>}
                        </div>
                        <div className="cellMeta">Kitchen</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Right: Selected cell detail */}
        <aside className="right">
          {!selectedCell ? (
            <div className="empty">Select a cell to view and edit items.</div>
          ) : (
            <>
              {/* Add form */}
              <div className="card">
                <div className="cardTitle">Add item</div>

                <div className="form">
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Item name (e.g. rice, soy sauce)"
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
                      placeholder="Unit (e.g. bag, bottle)"
                      inputMode="text"
                    />
                    <button className="primary" onClick={addItem}>
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Items */}
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
        :root {
          color-scheme: light;
        }
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
          opacity: 0.45;
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
        }
        .cellMeta {
          margin-top: 4px;
          font-size: 12px;
          opacity: 0.7;
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

        /* Mobile */
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
        }
      `}</style>
    </div>
  );
}
