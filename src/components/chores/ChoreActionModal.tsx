import { useState } from "react";
import { supabase } from "@/src/lib/supabase";
import Modal from "@/src/components/ui/Modal";
import { Database } from "@/src/lib/database.types";
import { format } from "date-fns";
import { cx } from "@/src/lib/utils";

type HouseholdMember = Database["public"]["Tables"]["household_members"]["Row"] & {
  email?: string;
};

interface ChoreActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
  choreId: string;
  choreTitle: string;
  date: Date; // The specific occurrence date
  status: string; // 'pending', 'completed', 'skipped'
  currentAssigneeIds?: string[];
  completionId?: string;
  members: HouseholdMember[];
}

export default function ChoreActionModal({
  isOpen,
  onClose,
  onUpdate,
  choreId,
  choreTitle,
  date,
  status,
  currentAssigneeIds,
  completionId,
  members,
}: ChoreActionModalProps) {
  const [loading, setLoading] = useState(false);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>(currentAssigneeIds || []);

  const handleComplete = async () => {
    setLoading(true);
    const { error } = await supabase.from("chore_completions").insert({
      chore_id: choreId,
      // Use the occurrence date for record keeping
      completed_at: new Date(date.setHours(12, 0, 0, 0)).toISOString(),
    });

    if (error) alert(error.message);
    else {
      onUpdate();
      onClose();
    }
    setLoading(false);
  };

  const handleUncomplete = async () => {
    if (!completionId) {
      alert("Unable to unmark this completion.");
      return;
    }

    setLoading(true);
    const { error } = await supabase
      .from("chore_completions")
      .delete()
      .eq("id", completionId);

    if (error) alert(error.message);
    else {
      onUpdate();
      onClose();
    }
    setLoading(false);
  };

  const handleToggleAssign = async (userId: string) => {
    const next = selectedAssigneeIds.includes(userId)
      ? selectedAssigneeIds.filter((id) => id !== userId)
      : [...selectedAssigneeIds, userId].sort((a, b) => a.localeCompare(b));

    setSelectedAssigneeIds(next);

    setLoading(true);
    const dateStr = format(date, "yyyy-MM-dd");

    const { data: existing } = await supabase
      .from("chore_overrides")
      .select("id")
      .eq("chore_id", choreId)
      .eq("original_date", dateStr)
      .single();

    const payload =
      next.length > 0
        ? { new_assignee_ids: next, new_assignee_id: null }
        : { new_assignee_ids: null, new_assignee_id: null };

    let error;
    if (existing) {
      const res = await supabase.from("chore_overrides").update(payload).eq("id", existing.id);
      error = res.error;
    } else {
      const res = await supabase.from("chore_overrides").insert({
        chore_id: choreId,
        original_date: dateStr,
        ...payload,
      });
      error = res.error;
    }

    if (error) alert(error.message);
    else {
      onUpdate();
      onClose();
    }
    setLoading(false);
  };

  const handleSkip = async () => {
    setLoading(true);
    const dateStr = format(date, 'yyyy-MM-dd');
    
    // Check if override exists
    const { data: existing } = await supabase
      .from('chore_overrides')
      .select('id')
      .eq('chore_id', choreId)
      .eq('original_date', dateStr)
      .single();

    let error;
    if (existing) {
      const res = await supabase
        .from('chore_overrides')
        .update({ is_skipped: true })
        .eq('id', existing.id);
      error = res.error;
    } else {
      const res = await supabase
        .from('chore_overrides')
        .insert({
          chore_id: choreId,
          original_date: dateStr,
          is_skipped: true
        });
      error = res.error;
    }

    if (error) alert(error.message);
    else {
      onUpdate();
      onClose();
    }
    setLoading(false);
  };

  const handleDeleteOverride = async () => {
    // This effectively "Resets" the cell (removes skip/assignment overrides)
    setLoading(true);
    const dateStr = format(date, 'yyyy-MM-dd');
    const { error } = await supabase
        .from('chore_overrides')
        .delete()
        .eq('chore_id', choreId)
        .eq('original_date', dateStr);

    if (error) alert(error.message);
    else {
      onUpdate();
      onClose();
    }
    setLoading(false);
  }

  return (
    <Modal open={isOpen} onClose={onClose} title="Manage Task Occurrence">
      <div className="space-y-6">
        <div>
          <h3 className="font-medium text-lg">{choreTitle}</h3>
          <p className="text-gray-500">{format(date, "PPPP")}</p>
          <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-full text-sm">
            Status: <span className="font-semibold capitalize">{status}</span>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="font-medium text-sm text-gray-900">Actions</h4>
          
          {status !== 'completed' && (
            <button
              onClick={handleComplete}
              disabled={loading}
              className="w-full py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 disabled:opacity-50"
            >
              Mark as Completed
            </button>
          )}

          {status === 'completed' && (
            <button
              onClick={handleUncomplete}
              disabled={loading}
              className="w-full py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Unmark as Completed
            </button>
          )}

          {status !== 'skipped' && (
             <button
               onClick={handleSkip}
               disabled={loading}
               className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 disabled:opacity-50"
             >
               Skip this occurrence
             </button>
          )}
          
          <button
            onClick={handleDeleteOverride}
             disabled={loading}
             className="w-full py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Reset (Clear Overrides)
          </button>
        </div>

        <div className="space-y-3 pt-4 border-t">
          <h4 className="font-medium text-sm text-gray-900">Assign To</h4>
          <div className="grid grid-cols-2 gap-2">
            {members.map(m => (
              <button
                key={m.user_id}
                onClick={() => handleToggleAssign(m.user_id)}
                disabled={loading}
                className={cx(
                  "px-3 py-2 rounded-lg text-sm border text-left truncate transition-colors",
                  selectedAssigneeIds.includes(m.user_id)
                    ? "bg-black text-white border-black"
                    : "bg-white border-gray-200 hover:border-gray-400"
                )}
              >
                {m.email?.split('@')[0] || "Unknown"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
