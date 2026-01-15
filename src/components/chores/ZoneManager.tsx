import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/src/lib/supabase";
import { Database } from "@/src/lib/database.types";
import Modal from "../ui/Modal";

type Zone = Database["public"]["Tables"]["chore_zones"]["Row"];

interface ZoneManagerProps {
  householdId: string;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export default function ZoneManager({
  householdId,
  isOpen,
  onClose,
  onUpdate,
}: ZoneManagerProps) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadZones = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("chore_zones")
      .select("*")
      .eq("household_id", householdId)
      .order("created_at");

    if (error) {
      console.error(error);
      setError("Failed to load zones");
    } else {
      setZones(data || []);
    }
    setLoading(false);
  }, [householdId]);

  useEffect(() => {
    if (isOpen) {
      loadZones();
    }
  }, [isOpen, loadZones]);

  async function handleAdd() {
    if (!newZoneName.trim()) return;
    setLoading(true);
    const { error } = await supabase.from("chore_zones").insert({
      household_id: householdId,
      name: newZoneName.trim(),
    });

    if (error) {
      console.error(error);
      setError("Failed to add zone");
    } else {
      setNewZoneName("");
      loadZones();
      onUpdate();
    }
    setLoading(false);
  }

  async function handleUpdate(id: string) {
    if (!editName.trim()) return;
    setLoading(true);
    const { error } = await supabase
      .from("chore_zones")
      .update({ name: editName.trim() })
      .eq("id", id);

    if (error) {
      console.error(error);
      setError("Failed to update zone");
    } else {
      setEditingId(null);
      loadZones();
      onUpdate();
    }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure? This will remove the zone from associated chores.")) return;
    setLoading(true);
    const { error } = await supabase
      .from("chore_zones")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(error);
      setError("Failed to delete zone");
    } else {
      loadZones();
      onUpdate();
    }
    setLoading(false);
  }

  return (
    <Modal open={isOpen} onClose={onClose} title="Manage Zones">
      <div className="space-y-4">
        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="New Zone Name"
            className="flex-1 px-3 py-2 border rounded-xl text-sm"
            value={newZoneName}
            onChange={(e) => setNewZoneName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button
            onClick={handleAdd}
            disabled={loading || !newZoneName.trim()}
            className="px-4 py-2 bg-black text-white rounded-xl text-sm font-medium disabled:opacity-50"
          >
            Add
          </button>
        </div>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {zones.map((zone) => (
            <div
              key={zone.id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-xl group"
            >
              {editingId === zone.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 px-2 py-1 border rounded-lg text-sm"
                    autoFocus
                  />
                  <button
                    onClick={() => handleUpdate(zone.id)}
                    className="text-green-600 text-sm font-medium"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-gray-500 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <span className="font-medium text-sm">{zone.name}</span>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        setEditingId(zone.id);
                        setEditName(zone.name);
                      }}
                      className="text-blue-600 text-xs hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(zone.id)}
                      className="text-red-600 text-xs hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {zones.length === 0 && (
            <div className="text-center text-gray-500 text-sm py-4">
              No zones created yet.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
