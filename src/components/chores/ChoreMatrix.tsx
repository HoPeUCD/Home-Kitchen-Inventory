import React, { useMemo, useState } from "react";
import { Database } from "@/src/lib/database.types";
import { cx } from "@/src/lib/utils";
import { startOfWeek, endOfWeek, addWeeks, format, isWithinInterval } from "date-fns";
import { calculateChoreOccurrences } from "@/src/lib/chores";
import { supabase } from "@/src/lib/supabase";
import ChoreActionModal from "./ChoreActionModal";

type Chore = Database["public"]["Tables"]["chores"]["Row"];
type ChoreOverride = Database["public"]["Tables"]["chore_overrides"]["Row"];
type ChoreCompletion = Database["public"]["Tables"]["chore_completions"]["Row"];
type HouseholdMember = Database["public"]["Tables"]["household_members"]["Row"] & {
  email?: string;
};

interface ChoreMatrixProps {
  zoneName: string;
  chores: Chore[];
  completions: ChoreCompletion[];
  overrides: ChoreOverride[];
  members: HouseholdMember[];
  year?: number;
  onUpdate?: () => void;
  onEditChore?: (choreId: string) => void;
}

export default function ChoreMatrix({
  zoneName,
  chores,
  completions,
  overrides,
  members,
  year = new Date().getFullYear(),
  onUpdate,
  onEditChore,
}: ChoreMatrixProps) {
  const [selectedCell, setSelectedCell] = useState<{
    choreId: string;
    choreTitle: string;
    date: Date;
    status: string;
    userIds: string[];
    completionId?: string;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [localOrderIds, setLocalOrderIds] = useState<string[] | null>(null);

  const orderedChores = useMemo(() => {
    const base = [...chores];
    if (localOrderIds && localOrderIds.length === base.length) {
      base.sort((a, b) => localOrderIds.indexOf(a.id) - localOrderIds.indexOf(b.id));
      return base;
    }
    base.sort((a, b) => {
      const ao = a.matrix_order ?? 9999;
      const bo = b.matrix_order ?? 9999;
      if (ao !== bo) return ao - bo;
      return a.title.localeCompare(b.title);
    });
    return base;
  }, [chores, localOrderIds]);

  const weeks = useMemo(() => {
    const w: { index: number; start: Date; end: Date }[] = [];
    const current = startOfWeek(new Date(year, 0, 1), { weekStartsOn: 1 });

    for (let i = 0; i < 53; i++) {
      const start = addWeeks(current, i);
      if (start.getFullYear() > year && i > 50) break;
      const end = endOfWeek(start, { weekStartsOn: 1 });
      w.push({ index: i + 1, start, end });
    }
    return w;
  }, [year]);

const scheduleMap = useMemo(() => {
    const map = new Map<string, Map<number, { status: string; userIds: string[]; date?: Date; completionId?: string }>>();

    if (weeks.length === 0) return map;

    const rangeStart = weeks[0].start;
    const rangeEnd = weeks[weeks.length - 1].end;

    orderedChores.forEach((chore) => {
      const choreOverrides = overrides.filter((o) => o.chore_id === chore.id);
      const choreCompletions = completions.filter((c) => c.chore_id === chore.id);

      const occurrences = calculateChoreOccurrences(
        chore,
        choreOverrides,
        choreCompletions,
        rangeStart,
        rangeEnd
      );

      const choreMap = new Map<number, { status: string; userIds: string[]; date?: Date; completionId?: string }>();

      occurrences.forEach((occ) => {
        const occDate = new Date(occ.date);
        const week = weeks.find((wItem) =>
          isWithinInterval(occDate, { start: wItem.start, end: wItem.end })
        );

        if (week) {
          const existing = choreMap.get(week.index);
          let status: string = occ.status;
          const baseUserIds = occ.assigneeIds;
          const userIds = [...baseUserIds].sort((a, b) => a.localeCompare(b));
          const completionId = occ.completion?.id;

          if (existing) {
            if (existing.status === "completed") return;
            if (status !== "completed") {
              status = existing.status;
            }
          }

          // We store the occurrence date to help with modal actions
          choreMap.set(week.index, { status, userIds, date: occDate, completionId });
        }
      });

      map.set(chore.id, choreMap);
    });

    return map;
  }, [orderedChores, overrides, completions, weeks]);

  const memberColors = useMemo(() => {
    const colors = [
      { completed: "bg-green-200", pending: "bg-green-50", text: "text-green-700", hexPending: "#ecfdf3", hexCompleted: "#bbf7d0" },
      { completed: "bg-yellow-200", pending: "bg-yellow-50", text: "text-yellow-700", hexPending: "#fefce8", hexCompleted: "#fef08a" },
      { completed: "bg-blue-200", pending: "bg-blue-50", text: "text-blue-700", hexPending: "#eff6ff", hexCompleted: "#bfdbfe" },
      { completed: "bg-purple-200", pending: "bg-purple-50", text: "text-purple-700", hexPending: "#faf5ff", hexCompleted: "#e9d5ff" },
      { completed: "bg-pink-200", pending: "bg-pink-50", text: "text-pink-700", hexPending: "#fdf2f8", hexCompleted: "#fbcfe8" },
      { completed: "bg-orange-200", pending: "bg-orange-50", text: "text-orange-700", hexPending: "#fff7ed", hexCompleted: "#fed7aa" },
      { completed: "bg-cyan-200", pending: "bg-cyan-50", text: "text-cyan-700", hexPending: "#ecfeff", hexCompleted: "#a5f3fc" },
      { completed: "bg-indigo-200", pending: "bg-indigo-50", text: "text-indigo-700", hexPending: "#eef2ff", hexCompleted: "#c7d2fe" },
    ];
    const map: Record<string, { completed: string; pending: string; text: string; hexPending: string; hexCompleted: string }> = {};
    // Sort members to ensure consistent color assignment
    const sortedMembers = [...members].sort((a, b) => a.user_id.localeCompare(b.user_id));
    
    sortedMembers.forEach((m, i) => {
      map[m.user_id] = colors[i % colors.length];
    });
    return map;
  }, [members]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 px-1">
        {members.map((member) => {
          const color = memberColors[member.user_id];
          return (
            <div key={member.user_id} className="flex items-center gap-2 text-xs">
              <div className={cx("w-3 h-3 rounded-full", color?.completed || "bg-gray-200")} />
              <span className="text-gray-600 font-medium">
                {member.email?.split("@")[0] || "Unknown"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="overflow-x-auto border rounded-xl border-black/10 bg-white">
      <table
        className="min-w-full table-fixed text-xs text-left"
        aria-label={`${zoneName} chores matrix`}
      >
        <colgroup>
          <col className="w-[90px]" />
          {orderedChores.map((chore) => (
            <col key={chore.id} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-black/10 bg-gray-50">
            <th className="px-1.5 py-0.5 font-semibold border-r border-black/10 sticky left-0 top-0 bg-gray-50 z-30 w-[90px]">
              Week
            </th>
            {orderedChores.map((chore) => (
              <th
                key={chore.id}
                className="px-2 py-1.5 font-semibold border-r border-black/10 sticky top-0 bg-gray-50 z-20"
                draggable
                onDragStart={() => setDraggingId(chore.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async () => {
                  if (!draggingId || draggingId === chore.id) return;
                  const ids = orderedChores.map((c) => c.id);
                  const from = ids.indexOf(draggingId);
                  const to = ids.indexOf(chore.id);
                  if (from === -1 || to === -1) {
                    setDraggingId(null);
                    return;
                  }
                  const nextIds = [...ids];
                  nextIds.splice(from, 1);
                  nextIds.splice(to, 0, draggingId);
                  setLocalOrderIds(nextIds);
                  setDraggingId(null);
                  for (let i = 0; i < nextIds.length; i++) {
                    const id = nextIds[i];
                    await supabase.from("chores").update({ matrix_order: i }).eq("id", id);
                  }
                  if (onUpdate) onUpdate();
                }}
                onDragEnd={() => setDraggingId(null)}
              >
                <div
                  className="mx-auto max-w-[130px] whitespace-normal break-words leading-tight text-[11px] text-center"
                  title={chore.title}
                >
                  <button
                    type="button"
                    className="hover:underline w-full"
                    onClick={() => onEditChore && onEditChore(chore.id)}
                  >
                    {chore.title}
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.index} className="border-b border-black/5 hover:bg-gray-50">
              <td className="px-1.5 py-0.5 font-medium border-r border-black/10 sticky left-0 bg-white z-10 text-gray-500 text-[11px]">
                W{week.index}{" "}
                <span className="text-[10px] font-normal text-gray-400 ml-1">
                  {format(week.start, "MM/dd")}
                </span>
              </td>
              {orderedChores.map((chore) => {
                const cellData = scheduleMap.get(chore.id)?.get(week.index);

                let cellClass = "bg-white";
                let style: React.CSSProperties = {};
                let content: string | null = null;
                let isClickable = false;

                if (cellData) {
                  isClickable = true;
                  const userIds = cellData.userIds || [];

                  if (cellData.status === "completed") {
                    if (userIds.length === 0) {
                      cellClass = "bg-gray-200 text-gray-700";
                    } else if (userIds.length === 1) {
                      const color = memberColors[userIds[0]];
                      cellClass = `${color?.completed || "bg-gray-200"} ${color?.text || "text-gray-700"} font-bold`;
                    } else {
                      const parts = userIds.map((id, i) => {
                        const c = memberColors[id];
                        const hex = c?.hexCompleted || "#d1d5db";
                        const p = 100 / userIds.length;
                        return `${hex} ${i * p}%, ${hex} ${(i + 1) * p}%`;
                      });
                      style = { background: `linear-gradient(to right, ${parts.join(", ")})` };
                      cellClass = "text-gray-700 font-bold";
                    }
                    content = "✓";
                  } else if (cellData.status === "skipped") {
                    cellClass = "bg-gray-100 text-gray-400";
                    content = "-";
                  } else if (cellData.status === "pending") {
                    if (week.end < new Date()) {
                      cellClass = "bg-red-100 text-red-600 font-bold";
                      content = "!";
                    } else {
                      if (userIds.length > 0) {
                        if (userIds.length === 1) {
                          const color = memberColors[userIds[0]];
                          cellClass = `${color?.pending || "bg-gray-50"} ${color?.text || "text-gray-400"} font-bold`;
                        } else {
                           // Multi-user gradient
                           const parts = userIds.map((id, i) => {
                             const c = memberColors[id];
                             const hex = c?.hexPending || "#f3f4f6";
                             const p = 100 / userIds.length;
                             return `${hex} ${i * p}%, ${hex} ${(i + 1) * p}%`;
                           });
                           style = { background: `linear-gradient(to right, ${parts.join(", ")})` };
                           cellClass = "text-gray-500 font-bold";
                        }
                      } else {
                        cellClass = "bg-white text-gray-300";
                      }
                      content = "○";
                    }
                  }
                } else {
                  cellClass = "bg-gray-50/50";
                }

                return (
                  <td
                    key={`${week.index}-${chore.id}`}
                    className={cx(
                      "px-1.5 py-0.5 border-r border-black/5 text-center transition-colors",
                      cellClass,
                      isClickable && "cursor-pointer hover:opacity-80"
                    )}
                    style={style}
                    onClick={() => {
                       if (isClickable && cellData && cellData.date) {
                         setSelectedCell({
                           choreId: chore.id,
                           choreTitle: chore.title,
                           date: cellData.date,
                           status: cellData.status,
                           userIds: cellData.userIds || [],
                           completionId: cellData.completionId,
                         });
                       }
                    }}
                  >
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {selectedCell && (
        <ChoreActionModal
          isOpen={!!selectedCell}
          onClose={() => setSelectedCell(null)}
          onUpdate={() => {
            if (onUpdate) onUpdate();
          }}
          choreId={selectedCell.choreId}
          choreTitle={selectedCell.choreTitle}
          date={selectedCell.date}
          status={selectedCell.status}
          currentAssigneeIds={selectedCell.userIds}
          completionId={selectedCell.completionId}
          members={members}
        />
      )}
    </div>
    </div>
  );
}
