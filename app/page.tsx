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

  // Step 3: Load cells and map by code
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("cells").select("*").eq("zone", "kitchen");
      if (error) {
        console.error("Failed to load cells:", error.message);
        return;
      }

      const map: Record<string, Cell> = {};
      (data as Cell[] | null)?.forEach((c) => {
        map[c.code] = c;
      });
      setCellsByCode(map);

      // Auto-select first available cell in the layout
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
    <div style={{ padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>Kitchen Inventory</h1>

      <div style={{ display: "flex", gap: 16, marginTop: 16, alignItems: "flex-start" }}>
        {/* Left: Cabinet columns */}
        <div style={{ flex: 1, overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", paddingBottom: 8, minHeight: 420 }}>
            {KITCHEN_LAYOUT.map((col) => (
              <div key={col.title} style={{ minWidth: 150 }}>
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8, opacity: 0.8 }}>
                  {col.title}
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {col.cells.map((code) => {
                    const cell = cellsByCode[code];
                    const disabled = !cell;
                    const isSelected = selectedCode === code;
                    const count = cell ? countByCellId[cell.id] ?? 0 : 0;

                    return (
                      <button
                        key={code}
                        disabled={disabled}
                        onClick={() => cell && setSelectedCode(code)}
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          border: "1px solid #ddd",
                          background: isSelected ? "#f3f3f3" : "white",
                          textAlign: "left",
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.5 : 1,
                        }}
                        title={disabled ? "Cell not found in DB (did you insert it?)" : undefined}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontWeight: 900 }}>{code}</div>
                          {!disabled && (
                            <div
                              style={{
                                fontSize: 12,
                                opacity: 0.75,
                                border: "1px solid #eee",
                                padding: "2px 8px",
                                borderRadius: 999,
                              }}
                            >
                              {count}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>Kitchen</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Selected cell detail */}
        <div style={{ width: 380 }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Selected cell</div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{selectedCell ? selectedCell.code : "None"}</div>
          </div>

          {!selectedCell ? (
            <div style={{ fontSize: 13, opacity: 0.7 }}>Select a cell to view and edit items.</div>
          ) : (
            <>
              {/* Add form */}
              <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>Add item</div>

                <div style={{ display: "grid", gap: 8 }}>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Item name (e.g. rice, soy sauce)"
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                  />

                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      placeholder="Qty"
                      style={{ width: 110, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                    />

                    <input
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="Unit (e.g. bag, bottle)"
                      style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                    />

                    <button
                      onClick={addItem}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #111",
                        cursor: "pointer",
                        fontWeight: 800,
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Items list */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>Items in {selectedCell.code}</div>

                {items.length === 0 ? (
                  <div style={{ fontSize: 13, opacity: 0.7 }}>No items yet.</div>
                ) : (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                    {items.map((it) => (
                      <li key={it.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 900 }}>{it.name}</div>
                            <div style={{ fontSize: 12, opacity: 0.75 }}>
                              {parseQty(it.qty)} {it.unit ?? ""}
                            </div>
                          </div>

                          <button
                            onClick={() => deleteItem(it.id)}
                            style={{
                              border: "1px solid #ddd",
                              borderRadius: 10,
                              padding: "6px 10px",
                              cursor: "pointer",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
