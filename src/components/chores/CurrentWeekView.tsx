import { useMemo, useState } from "react";
import { Database } from "@/src/lib/database.types";
import { startOfWeek, endOfWeek, differenceInCalendarWeeks } from "date-fns";
import { calculateChoreOccurrences, ChoreOccurrence } from "@/src/lib/chores";
import { cx } from "@/src/lib/utils";
import { supabase } from "@/src/lib/supabase";
import ChoreActionModal from "./ChoreActionModal";

type Chore = Database["public"]["Tables"]["chores"]["Row"];
type ChoreOverride = Database["public"]["Tables"]["chore_overrides"]["Row"];
type ChoreCompletion = Database["public"]["Tables"]["chore_completions"]["Row"];
type HouseholdMember = Database["public"]["Tables"]["household_members"]["Row"] & {
  email?: string;
};

type WeekItem = ChoreOccurrence & {
  choreTitle: string;
  zoneName?: string;
  description?: string | null;
};

interface CurrentWeekViewProps {
  chores: Chore[];
  completions: ChoreCompletion[];
  overrides: ChoreOverride[];
  members: HouseholdMember[];
  zones: Database["public"]["Tables"]["chore_zones"]["Row"][];
  onUpdate?: () => void;
}

export default function CurrentWeekView({
  chores,
  completions,
  overrides,
  members,
  zones,
  onUpdate,
}: CurrentWeekViewProps) {
  const [selected, setSelected] = useState<{
    choreId: string;
    choreTitle: string;
    date: Date;
    status: string;
    assigneeIds: string[];
    completionId?: string;
  } | null>(null);
  const { pending, completed } = useMemo(() => {
    const today = new Date();
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
    const yearStart = new Date(today.getFullYear(), 0, 1);
    const pendingList: WeekItem[] = [];
    const completedList: WeekItem[] = [];

    chores.forEach((chore) => {
      const choreOverrides = overrides.filter((o) => o.chore_id === chore.id);
      const choreCompletions = completions.filter((c) => c.chore_id === chore.id);

      const occurrences = calculateChoreOccurrences(
        chore,
        choreOverrides,
        choreCompletions,
        yearStart,
        weekEnd
      );

      occurrences.forEach((occ) => {
        const zone = zones.find((z) => z.id === chore.zone_id);
        const isInThisWeek = occ.date >= weekStart && occ.date <= weekEnd;
        const item = {
          ...occ,
          choreTitle: chore.title,
          zoneName: zone?.name || chore.zone || "Uncategorized",
          description: chore.description,
        };

        if (occ.status === "completed") {
          if (isInThisWeek) {
            completedList.push(item);
          }
        } else if (occ.status !== "skipped") {
          pendingList.push(item);
        }
      });
    });

    pendingList.sort((a, b) => {
      const zn = (a.zoneName || "").localeCompare(b.zoneName || "");
      if (zn !== 0) return zn;
      return a.date.getTime() - b.date.getTime();
    });

    completedList.sort((a, b) => {
      const zn = (a.zoneName || "").localeCompare(b.zoneName || "");
      if (zn !== 0) return zn;
      return a.date.getTime() - b.date.getTime();
    });

    return { pending: pendingList, completed: completedList };
  }, [chores, completions, overrides, zones]);

  const zoneStatus = useMemo(() => {
    const map = new Map<string, { zoneName: string; hasPending: boolean; hasCompleted: boolean }>();

    completed.forEach((item) => {
      const name = item.zoneName || "Uncategorized";
      const existing = map.get(name) || { zoneName: name, hasPending: false, hasCompleted: false };
      existing.hasCompleted = true;
      map.set(name, existing);
    });

    pending.forEach((item) => {
      const name = item.zoneName || "Uncategorized";
      const existing = map.get(name) || { zoneName: name, hasPending: false, hasCompleted: false };
      existing.hasPending = true;
      map.set(name, existing);
    });

    return Array.from(map.values()).sort((a, b) => a.zoneName.localeCompare(b.zoneName));
  }, [pending, completed]);

  const handleQuickComplete = async (item: WeekItem) => {
    const dateCopy = new Date(item.date);
    dateCopy.setHours(12, 0, 0, 0);
    const { error } = await supabase.from("chore_completions").insert({
      chore_id: item.choreId,
      completed_at: dateCopy.toISOString(),
    });
    if (error) {
      alert(error.message);
      return;
    }
    if (onUpdate) onUpdate();
  };

  const handleQuickUncomplete = async (item: WeekItem) => {
    const completionId = item.completion?.id;
    if (!completionId) return;
    const { error } = await supabase.from("chore_completions").delete().eq("id", completionId);
    if (error) {
      alert(error.message);
      return;
    }
    if (onUpdate) onUpdate();
  };

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
    const sortedMembers = [...members].sort((a, b) => a.user_id.localeCompare(b.user_id));
    sortedMembers.forEach((m, i) => {
      map[m.user_id] = colors[i % colors.length];
    });
    return map;
  }, [members]);

  const now = new Date();

  return (
    <div className="space-y-8">
      {/* To Do Section */}
      <section>
        <h2 className="text-xl font-bold mb-4 text-gray-800">To Do This Week</h2>
        {zoneStatus.length === 0 ? (
          <div className="bg-white p-6 rounded-xl text-center text-gray-500 border border-gray-100">
            No chores scheduled for this week.
          </div>
        ) : (
          <div className="space-y-4">
            {zoneStatus.map((zone) => {
              const items = pending.filter(
                (item) => (item.zoneName || "Uncategorized") === zone.zoneName
              );
              return (
                <div key={zone.zoneName} className="bg-white rounded-xl border border-gray-100">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-800">
                        {zone.zoneName}
                      </h3>
                      {!zone.hasPending && zone.hasCompleted && (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-600 text-xs">
                          ✓
                        </span>
                      )}
                    </div>
                    {items.length === 0 && zone.hasCompleted && (
                      <span className="text-xs text-gray-400">
                        All chores done this week.
                      </span>
                    )}
                  </div>
                  {items.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 p-2">
                      {items.map((item) => (
                        <div
                          key={`${item.choreId}-${item.date.toISOString()}`}
                          className={cx(
                            "p-2 rounded-lg border border-gray-100 flex items-center gap-2",
                            item.date < now ? "bg-red-50" : "bg-white"
                          )}
                        >
                          {(() => {
                            const isOverdue = item.date < now;
                            const weeksOverdue = isOverdue
                              ? differenceInCalendarWeeks(now, item.date)
                              : 0;
                            return (
                              <>
                                {(() => {
                                  const assigneeIds = (item.assigneeIds || [])
                                    .slice()
                                    .sort((a, b) => a.localeCompare(b));
                                  let indicatorClass =
                                    "w-8 h-8 rounded-full flex items-center justify-center border";
                                  let innerClass =
                                    "block w-3 h-3 rounded-full border-2 border-gray-300";
                                  let gradientStyle:
                                    | { background: string }
                                    | undefined;

                                  if (isOverdue) {
                                    indicatorClass =
                                      "w-8 h-8 rounded-full bg-red-100 flex items-center justify-center border border-red-200 text-red-600";
                                    innerClass =
                                      "block w-3 h-3 rounded-full bg-red-500";
                                  } else if (assigneeIds.length > 0) {
                                    if (assigneeIds.length === 1) {
                                      const color = memberColors[assigneeIds[0]];
                                      indicatorClass = cx(
                                        "w-8 h-8 rounded-full flex items-center justify-center border",
                                        color?.pending || "bg-gray-50",
                                        color?.text || "text-gray-700"
                                      );
                                      innerClass =
                                        "block w-3 h-3 rounded-full border-2 border-white";
                                    } else {
                                      const parts = assigneeIds.map(
                                        (id, index) => {
                                          const c = memberColors[id];
                                          const hex =
                                            c?.hexPending || "#f3f4f6";
                                          const p =
                                            100 / assigneeIds.length;
                                          return `${hex} ${
                                            index * p
                                          }%, ${hex} ${(index + 1) * p}%`;
                                        }
                                      );
                                      gradientStyle = {
                                        background: `linear-gradient(to right, ${parts.join(
                                          ", "
                                        )})`,
                                      };
                                      indicatorClass =
                                        "w-8 h-8 rounded-full flex items-center justify-center border border-gray-200 text-gray-600";
                                      innerClass =
                                        "block w-3 h-3 rounded-full border-2 border-white";
                                    }
                                  } else {
                                    indicatorClass =
                                      "w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center border border-gray-200";
                                    innerClass =
                                      "block w-3 h-3 rounded-full border-2 border-gray-300";
                                  }

                                  return (
                                    <button
                                      type="button"
                                      className={cx(
                                        indicatorClass,
                                        "cursor-pointer flex-shrink-0"
                                      )}
                                      style={gradientStyle}
                                      onClick={() =>
                                        handleQuickComplete(item)
                                      }
                                    >
                                      <span className={innerClass}></span>
                                    </button>
                                  );
                                })()}
                                <div className="flex-1">
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <h3 className="font-semibold text-gray-900 text-sm">
                                      {item.choreTitle}
                                    </h3>
                                    <button
                                      type="button"
                                      className="text-xs text-gray-400 hover:text-black hover:underline"
                                      onClick={() =>
                                        setSelected({
                                          choreId: item.choreId,
                                          choreTitle: item.choreTitle,
                                          date: item.date,
                                          status: item.status,
                                          assigneeIds: (
                                            item.assigneeIds || []
                                          )
                                            .slice()
                                            .sort((a, b) =>
                                              a.localeCompare(b)
                                            ),
                                          completionId: item.completion?.id,
                                        })
                                      }
                                    >
                                      More
                                    </button>
                                  </div>
                                  {item.description && (
                                    <div className="text-xs text-gray-500 mb-0.5">
                                      {item.description}
                                    </div>
                                  )}
                                  {isOverdue && weeksOverdue >= 1 && (
                                    <div className="text-xs text-red-500">
                                      Overdue {weeksOverdue} weeks
                                    </div>
                                  )}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Completed Section */}
      {completed.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4 text-gray-800">Completed</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 opacity-75">
            {completed.map((item) => (
              <div
                key={`${item.choreId}-${item.date.toISOString()}`}
                className="bg-gray-50 p-2 rounded-xl border border-gray-100 flex items-center gap-2"
              >
                {(() => {
                  const assigneeIds = (item.assigneeIds || []).slice().sort((a, b) =>
                    a.localeCompare(b)
                  );
                  let indicatorClass =
                    "w-8 h-8 rounded-full flex items-center justify-center border cursor-pointer";
                  let gradientStyle: { background: string } | undefined;

                  if (assigneeIds.length === 0) {
                    indicatorClass =
                      "w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 cursor-pointer";
                  } else if (assigneeIds.length === 1) {
                    const color = memberColors[assigneeIds[0]];
                    indicatorClass = cx(
                      "w-8 h-8 rounded-full flex items-center justify-center border cursor-pointer",
                      color?.completed || "bg-gray-200",
                      color?.text || "text-gray-700"
                    );
                  } else {
                    const parts = assigneeIds.map((id, index) => {
                      const c = memberColors[id];
                      const hex = c?.hexCompleted || "#d1d5db";
                      const p = 100 / assigneeIds.length;
                      return `${hex} ${index * p}%, ${hex} ${(index + 1) * p}%`;
                    });
                    gradientStyle = {
                      background: `linear-gradient(to right, ${parts.join(", ")})`,
                    };
                    indicatorClass =
                      "w-10 h-10 rounded-full flex items-center justify-center border border-gray-200 text-gray-700 cursor-pointer";
                  }

                  return (
                    <button
                      type="button"
                      className={indicatorClass}
                      style={gradientStyle}
                      onClick={() => handleQuickUncomplete(item)}
                    >
                      ✓
                    </button>
                  );
                })()}
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-medium px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full">
                      {item.zoneName}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-gray-400 hover:text-black hover:underline"
                      onClick={() =>
                        setSelected({
                          choreId: item.choreId,
                          choreTitle: item.choreTitle,
                          date: item.date,
                          status: item.status,
                          assigneeIds: item.assigneeIds || [],
                          completionId: item.completion?.id,
                        })
                      }
                    >
                      More
                    </button>
                  </div>
                  {item.description && (
                    <div className="text-xs text-gray-400 mb-0.5">
                      {item.description}
                    </div>
                  )}
                  <h3 className="font-semibold text-gray-500 line-through">
                    {item.choreTitle}
                  </h3>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {selected && (
        <ChoreActionModal
          isOpen={!!selected}
          onClose={() => setSelected(null)}
          onUpdate={() => {
            if (onUpdate) onUpdate();
          }}
          choreId={selected.choreId}
          choreTitle={selected.choreTitle}
          date={selected.date}
          status={selected.status}
          currentAssigneeIds={selected.assigneeIds}
          completionId={selected.completionId}
          members={members}
        />
      )}
    </div>
  );
}
