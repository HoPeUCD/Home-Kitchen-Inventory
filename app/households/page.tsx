"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

import { supabase } from "@/src/lib/supabase";
import AuthGate from "@/src/components/AuthGate";
import HouseholdTopBar from "@/src/components/HouseholdTopBar";

const ACTIVE_HOUSEHOLD_KEY = "active_household_id";

type HouseholdMini = {
  id: string;
  name: string;
  join_code?: string | null;
};

// 注意：Supabase 的类型推断有时会把关联表推成数组（即使关系是 many-to-one）
// 所以这里显式兼容两种返回：object | object[]
type Row = {
  household_id?: string | null;
  role?: string | null;
  households?: HouseholdMini | HouseholdMini[] | null;
};

type HouseholdMember = {
  user_id: string;
  role: string;
  email?: string | null;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function normalizeHousehold(h: Row["households"]): HouseholdMini | null {
  if (!h) return null;
  return Array.isArray(h) ? h[0] ?? null : h;
}

function Modal({
  open,
  title,
  onClose,
  children,
  widthClass = "max-w-lg",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClass?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative min-h-full flex items-center justify-center p-4">
        <div className={cx("relative w-full my-auto z-10", widthClass)} onClick={(e) => e.stopPropagation()}>
          <div className="rounded-2xl shadow-xl border border-black/10 bg-[#FBF7EF] flex flex-col max-h-[90vh]">
            {/* Fixed header */}
            <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between gap-3 flex-shrink-0">
            <div className="text-base font-semibold">{title}</div>
            <button
              onClick={onClose}
                className="px-2 py-1 rounded-lg border border-black/10 hover:bg-black/5 text-sm flex-shrink-0"
              aria-label="Close"
              title="Close"
            >
              ✕
            </button>
          </div>
            {/* Scrollable content */}
            <div className="p-5 overflow-y-auto flex-1 min-h-0">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80]">
      <div className="px-4 py-2 rounded-2xl bg-black text-white text-sm shadow-lg">
        {message}
      </div>
    </div>
  );
}

export default function HouseholdsPage() {
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(null);
  
  // Store members for each household: household_id -> HouseholdMember[]
  const [householdMembers, setHouseholdMembers] = useState<Record<string, HouseholdMember[]>>({});

  const [switchModalOpen, setSwitchModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");
  
  // Edit household name states
  const [editNameModalOpen, setEditNameModalOpen] = useState(false);
  const [targetHouseholdId, setTargetHouseholdId] = useState<string | null>(null);
  const [householdDraftName, setHouseholdDraftName] = useState("");
  
  // Chat states
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [chatHouseholdId, setChatHouseholdId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [lastEnterTime, setLastEnterTime] = useState<number>(0);

  // theme
  const oatBg = "bg-[#F7F1E6]";
  const oatCard = "bg-[#FBF7EF]";

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    try {
      const cur = localStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
      setActiveHouseholdId(cur);
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  function writeActiveHouseholdToStorage(hid: string | null) {
    try {
      if (!hid) localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
      else localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, hid);
    } catch {}
    setActiveHouseholdId(hid);
  }

  async function load() {
    if (!session?.user?.id) return;
    setErr(null);

    const userId = session.user.id;

    // profiles 表使用 user_id 作为主键
    const profRes = await supabase
      .from("profiles")
      .select("default_household_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (profRes.error) return setErr(profRes.error.message);
    setDefaultId(profRes.data?.default_household_id ?? null);

    const hm = await supabase
      .from("household_members")
      .select("household_id, role, households(id,name,join_code)")
      .eq("user_id", userId);

    if (hm.error) return setErr(hm.error.message);

    // ✅ 这里不做危险的强转；Row 已经兼容 households 为 object 或 array
    const rowsData = (hm.data ?? []) as unknown as Row[];
    setRows(rowsData);

    // Load all members for each household
    const householdIds = rowsData
      .map((r) => normalizeHousehold(r.households)?.id)
      .filter(Boolean) as string[];

    if (householdIds.length > 0) {
      const membersMap: Record<string, HouseholdMember[]> = {};
      
      // Load all members for all households
      // Note: RLS policy should allow users to see all members of households they belong to
      const { data: allMembers, error: membersErr } = await supabase
        .from("household_members")
        .select("household_id, user_id, role")
        .in("household_id", householdIds);

      if (membersErr) {
        console.error("Error loading household members:", membersErr);
        setErr(`Failed to load members: ${membersErr.message}`);
      } else if (allMembers) {
        // Collect all unique user IDs
        const uniqueUserIds = [...new Set(allMembers.map((m: any) => m.user_id))];
        
        // Get emails for all users using RPC function
        const emailMap: Record<string, string | null> = {};
        
        // For current user, use session email immediately
        if (session?.user?.email) {
          emailMap[userId] = session.user.email;
        }
        
        // Get emails for other users via RPC
        if (uniqueUserIds.length > 0) {
          const { data: emailData, error: emailErr } = await supabase.rpc('get_member_emails', {
            p_user_ids: uniqueUserIds
          });
          
          if (emailErr) {
            console.error("Error fetching member emails:", emailErr);
            // Continue without emails if RPC fails
          } else if (emailData) {
            emailData.forEach((row: { user_id: string; email: string | null }) => {
              emailMap[row.user_id] = row.email;
            });
          }
        }
        
        // Group members by household_id
        allMembers.forEach((member: any) => {
          if (!membersMap[member.household_id]) {
            membersMap[member.household_id] = [];
          }
          
          membersMap[member.household_id].push({
            user_id: member.user_id,
            role: member.role ?? "member",
            email: emailMap[member.user_id] ?? null,
          });
        });

        setHouseholdMembers(membersMap);
      }
    }
  }

  async function exportToExcel(householdId: string, householdName: string) {
    try {
      setBusyId(householdId);
      setErr(null);

      // Load all rooms for this household
      const { data: roomsData, error: roomsErr } = await supabase
        .from('rooms')
        .select('id, name, position')
        .eq('household_id', householdId)
        .order('position', { ascending: true });

      if (roomsErr) throw roomsErr;
      if (!roomsData || roomsData.length === 0) {
        setToast('No rooms found in this household');
        return;
      }

      const roomIds = roomsData.map(r => r.id);

      // Load all columns
      const { data: columnsData, error: columnsErr } = await supabase
        .from('room_columns')
        .select('id, room_id, name, position')
        .in('room_id', roomIds)
        .order('position', { ascending: true });

      if (columnsErr) throw columnsErr;

      const columnIds = columnsData?.map(c => c.id) ?? [];
      const columnById = new Map(columnsData?.map(c => [c.id, c]) ?? []);

      // Load all cells
      const { data: cellsData, error: cellsErr } = await supabase
        .from('room_cells')
        .select('id, column_id, code, position')
        .in('column_id', columnIds)
        .order('position', { ascending: true });

      if (cellsErr) throw cellsErr;

      const cellIds = cellsData?.map(c => c.id) ?? [];
      const cellById = new Map(cellsData?.map(c => [c.id, c]) ?? []);

      // Load all items
      const { data: itemsData, error: itemsErr } = await supabase
        .from('items_v2')
        .select('id, cell_id, name, qty, expires_at, remark')
        .eq('household_id', householdId)
        .in('cell_id', cellIds);

      if (itemsErr) throw itemsErr;

      // Build room -> column -> cell mapping
      const roomToColumns = new Map<string, typeof columnsData>();
      const columnToCells = new Map<string, typeof cellsData>();

      columnsData?.forEach(col => {
        if (!roomToColumns.has(col.room_id)) {
          roomToColumns.set(col.room_id, []);
        }
        roomToColumns.get(col.room_id)!.push(col);
      });

      cellsData?.forEach(cell => {
        const col = columnById.get(cell.column_id);
        if (col) {
          if (!columnToCells.has(cell.column_id)) {
            columnToCells.set(cell.column_id, []);
          }
          columnToCells.get(cell.column_id)!.push(cell);
        }
      });

      // Group items by cell
      const itemsByCell = new Map<string, typeof itemsData>();
      itemsData?.forEach(item => {
        if (!itemsByCell.has(item.cell_id)) {
          itemsByCell.set(item.cell_id, []);
        }
        itemsByCell.get(item.cell_id)!.push(item);
      });

      // Build Excel data rows
      const excelData: Array<{
        Room: string;
        Column: string;
        Cell: string;
        'Item Name': string;
        'Quantity': number | null;
        'Expire Date': string | null;
        'Remark': string;
        'Location': string;
      }> = [];

      // Sort rooms by position
      const sortedRooms = [...roomsData].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

      sortedRooms.forEach(room => {
        const columns = roomToColumns.get(room.id) ?? [];
        const sortedColumns = columns.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

        sortedColumns.forEach(column => {
          const cells = columnToCells.get(column.id) ?? [];
          const sortedCells = cells.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

          sortedCells.forEach(cell => {
            const items = itemsByCell.get(cell.id) ?? [];

            // Only include cells that have items
            if (items.length > 0) {
              items.forEach(item => {
                const location = `${room.name} / ${column.name} / ${cell.code}`;
                excelData.push({
                  Room: room.name,
                  Column: column.name,
                  Cell: cell.code,
                  'Item Name': item.name,
                  'Quantity': item.qty,
                  'Expire Date': item.expires_at ? new Date(item.expires_at + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '',
                  'Remark': item.remark ?? '',
                  'Location': location,
                });
              });
            }
          });
        });
      });

      // Create workbook and worksheet
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Inventory');

      // Generate file name with date
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `${householdName}_${dateStr}.xlsx`;

      // Write and download
      XLSX.writeFile(wb, fileName);

      setToast('Export completed successfully');
    } catch (e: any) {
      console.error('Export error:', e);
      setErr(e?.message ?? 'Failed to export');
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  const householdNameForTopBar = useMemo(() => {
    const all = rows
      .map((r) => normalizeHousehold(r.households))
      .filter(Boolean) as HouseholdMini[];

    const byId = new Map(all.map((h) => [h.id, h.name] as const));
    if (activeHouseholdId && byId.has(activeHouseholdId)) return byId.get(activeHouseholdId)!;
    if (defaultId && byId.has(defaultId)) return byId.get(defaultId)!;
    return "Households";
  }, [rows, activeHouseholdId, defaultId]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
      setToast("Refreshed");
    } finally {
      setRefreshing(false);
    }
  }

  async function signOut() {
    try {
      localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
    } catch {}
    await supabase.auth.signOut();
    setSession(null);
    router.replace("/");
  }

  async function setDefault(hid: string) {
    if (!session?.user?.id) {
      setErr("Not authenticated");
      return;
    }

    setErr(null);
    setBusyId(hid);
    try {
      // Directly update profiles table instead of using RPC
      const { error } = await supabase
        .from("profiles")
        .update({ default_household_id: hid })
        .eq("user_id", session.user.id);

      if (error) throw error;

      // 设为默认时，清掉临时 active
      writeActiveHouseholdToStorage(null);

      // Update local state
      setDefaultId(hid);
      
      // Show success feedback
      setToast("Set as default household");
      
      // Optionally redirect to rooms page
      // router.push("/rooms");
    } catch (e: any) {
      setErr(e?.message ?? "Set default failed.");
    } finally {
      setBusyId(null);
    }
  }

  function switchOnly(hid: string) {
    writeActiveHouseholdToStorage(hid);
    router.push("/rooms");
  }

  async function deleteHousehold(hid: string, name: string) {
    const ok = window.confirm(
      `Delete household "${name}"?\n\nThis will permanently delete data under this household (if cascades are enabled).`
    );
    if (!ok) return;

    const typed = window.prompt(`Type the household name exactly to confirm deletion:\n\n${name}`);
    if (typed !== name) {
      alert("Confirmation did not match. Deletion cancelled.");
      return;
    }

    setErr(null);
    setBusyId(hid);
    try {
      const { error } = await supabase.rpc("delete_household", { p_household_id: hid });
      if (error) throw error;

      try {
        const cur = localStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
        if (cur === hid) localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
      } catch {}

      await load();

      if (defaultId === hid) {
        router.replace("/households");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Delete household failed.");
    } finally {
      setBusyId(null);
    }
  }

  function openEditHouseholdName(hid: string, currentName: string) {
    setTargetHouseholdId(hid);
    setHouseholdDraftName(currentName);
    setEditNameModalOpen(true);
  }

  async function saveEditHouseholdName() {
    if (!targetHouseholdId) return;
    const name = householdDraftName.trim();
    if (!name) {
      setErr("Household name cannot be empty");
      return;
    }

    setErr(null);
    setBusyId(targetHouseholdId);
    try {
      const { error } = await supabase
        .from("households")
        .update({ name })
        .eq("id", targetHouseholdId);

      if (error) throw error;

      setEditNameModalOpen(false);
      setTargetHouseholdId(null);
      setHouseholdDraftName("");
      setToast("Household name updated");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update household name");
    } finally {
      setBusyId(null);
    }
  }

  function openChat(householdId: string) {
    setChatHouseholdId(householdId);
    setChatMessages([]);
    setChatInput("");
    setLastEnterTime(0);
    setChatModalOpen(true);
  }

  async function sendChatMessage() {
    if (!chatHouseholdId || !chatInput.trim() || chatLoading) return;

    const question = chatInput.trim();
    setChatInput("");
    
    // Add user message to chat
    const userMessage = { role: 'user' as const, content: question };
    setChatMessages(prev => [...prev, userMessage]);
    setChatLoading(true);
    setErr(null);

    try {
      // Get session token for authentication
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Not authenticated");
      }

      // Prepare conversation history (excluding system message)
      const conversationHistory = chatMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Call API
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          householdId: chatHouseholdId,
          question: question,
          conversationHistory: conversationHistory,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to get response from AI');
      }

      const data = await response.json();
      const assistantMessage = { role: 'assistant' as const, content: data.response };
      setChatMessages(prev => [...prev, assistantMessage]);
      
      // If there was a database operation, refresh the household data
      if (data.operation && data.operation.success) {
        setToast(data.operation.message || 'Operation completed');
        // Refresh household data by reloading
        await load();
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to send message");
      // Remove the user message if error occurred
      setChatMessages(prev => prev.slice(0, -1));
    } finally {
      setChatLoading(false);
    }
  }

  async function sendExpiryReminder(householdId: string) {
    if (busyId === householdId) return;
    
    setBusyId(householdId);
    setErr(null);

    try {
      // Get session token for authentication
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Not authenticated");
      }

      // Call API
      const response = await fetch('/api/send-expiry-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          householdId: householdId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to send expiry reminder');
      }

      const data = await response.json();
      setToast(`Expiry reminder sent to ${data.recipients} member(s). ${data.itemsCount} expiring items found.`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to send expiry reminder");
    } finally {
      setBusyId(null);
    }
  }

  const userEmail = session?.user?.email ?? "";

  return (
    <AuthGate onAuthed={() => {}}>
      <div className={cx("min-h-screen", oatBg)}>
        <div className="max-w-[1100px] mx-auto px-4 py-5">
          <HouseholdTopBar
            householdName={householdNameForTopBar}
            userEmail={userEmail}
            refreshing={refreshing}
            onRefresh={onRefresh}
            onOpenSwitchHousehold={() => setSwitchModalOpen(true)}
            onSignOut={signOut}
          />

          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-xl font-semibold truncate">Households</div>
              <div className="text-xs text-black/60 mt-0.5">
                Manage your households: switch, set as default, delete (owner only).
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => router.push("/rooms")}
                className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm"
              >
                All rooms
              </button>
              <button
                onClick={() => router.push("/onboarding")}
                className="px-3 py-2 rounded-xl border border-[#2563EB]/25 hover:bg-black/5 text-sm"
              >
                Create / Join
              </button>
            </div>
          </div>

          {err && (
            <div className="mt-3 rounded-2xl border border-red-500/25 bg-red-50 px-4 py-3 text-sm text-red-800">
              {err}
            </div>
          )}

          <div className="mt-4 grid gap-3">
            {rows.map((r) => {
              const h = normalizeHousehold(r.households);
              if (!h?.id) return null;

              const isDefault = defaultId === h.id;
              const isOwner = (r.role ?? "") === "owner";
              const busy = busyId === h.id;
              const members = householdMembers[h.id] ?? [];

              return (
                <div key={h.id} className={cx("rounded-2xl border p-4 flex flex-col", "border-black/10", oatCard)}>
                  {/* Active and Default badges at the top */}
                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    {activeHouseholdId === h.id && (
                          <span className="text-xs px-2 py-1 rounded-lg border border-black/20 bg-black/5">
                            Active
                          </span>
                    )}
                    {isDefault && (
                          <span className="text-xs px-2 py-1 rounded-lg border border-black/20 bg-black/5">
                            Default
                          </span>
                    )}
                      </div>

                  {/* Household basic info */}
                  <div className="mb-3">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold truncate flex-1">{h.name}</div>
                      {isOwner && (
                        <button
                          onClick={() => openEditHouseholdName(h.id, h.name)}
                          disabled={busy}
                          className="px-2 py-1 rounded-lg border border-black/10 hover:bg-black/5 text-sm disabled:opacity-60 flex-shrink-0"
                          title="Edit household name"
                        >
                          ✏️
                        </button>
                      )}
                    </div>
                    {h.join_code && (
                      <div className="text-sm text-black/70 mt-1">Join code: {h.join_code}</div>
                    )}
                    </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-wrap mb-3">
                      <button
                        onClick={() => switchOnly(h.id)}
                        disabled={busy}
                        className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm disabled:opacity-60"
                      >
                      Switch
                      </button>

                      <button
                        onClick={() => setDefault(h.id)}
                        disabled={busy}
                        className={cx(
                          "px-3 py-2 rounded-xl border text-sm disabled:opacity-60",
                          isDefault ? "border-black/30 bg-black/5" : "border-black/10 hover:bg-black/5"
                        )}
                      >
                        {isDefault ? "Default" : "Set as default"}
                      </button>
                  </div>

                  {/* Members list - flex-grow to push export button to bottom */}
                  <div className="pt-3 border-t border-black/10 flex-grow flex flex-col">
                    <div className="text-sm font-medium text-black/80 mb-2">Members ({members.length}):</div>
                    <div className="space-y-1 flex-grow">
                      {members.length > 0 ? (
                        members.map((member) => (
                          <div key={member.user_id} className="flex items-center justify-between gap-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-black/70">
                                {member.email || member.user_id.slice(0, 8) + "..."}
                              </span>
                              {member.user_id === session?.user?.id && (
                                <span className="text-xs px-1.5 py-0.5 rounded border border-black/20 bg-black/5">You</span>
                              )}
                            </div>
                            <span className={cx(
                              "text-xs px-2 py-0.5 rounded",
                              member.role === "owner" 
                                ? "bg-blue-100 text-blue-800 border border-blue-200" 
                                : "bg-gray-100 text-gray-700 border border-gray-200"
                            )}>
                              {member.role ?? "member"}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-black/60">No members found</div>
                      )}
                    </div>
                    {/* Export, Chat, Email Reminder, and Delete buttons at the bottom */}
                    <div className="mt-3 space-y-2">
                      <button
                        onClick={() => exportToExcel(h.id, h.name)}
                        disabled={busyId === h.id}
                        className="w-full px-3 py-2 rounded-xl border border-blue-600/30 bg-blue-50 text-blue-700 hover:bg-blue-100 text-sm disabled:opacity-60"
                      >
                        {busyId === h.id ? "Exporting..." : "Export to Excel"}
                      </button>
                      <button
                        onClick={() => openChat(h.id)}
                        disabled={busyId === h.id}
                        className="w-full px-3 py-2 rounded-xl border border-green-600/30 bg-green-50 text-green-700 hover:bg-green-100 text-sm disabled:opacity-60"
                      >
                        💬 Ask AI about Inventory
                      </button>
                      <button
                        onClick={() => sendExpiryReminder(h.id)}
                        disabled={busyId === h.id}
                        className="w-full px-3 py-2 rounded-xl border border-purple-600/30 bg-purple-50 text-purple-700 hover:bg-purple-100 text-sm disabled:opacity-60"
                      >
                        📧 Send Expiry Reminder
                      </button>
                      {isOwner && (
                        <button
                          onClick={() => deleteHousehold(h.id, h.name)}
                          disabled={busy}
                          className="w-full px-3 py-2 rounded-xl border border-red-600/30 bg-red-50 text-red-700 hover:bg-red-100 text-sm font-semibold disabled:opacity-60"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {busy && <div className="text-sm text-black/60 mt-3">Working…</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Chat modal */}
        <Modal 
          open={chatModalOpen} 
          title="Ask AI about Inventory" 
          onClose={() => {
            setChatModalOpen(false);
            setChatHouseholdId(null);
            setChatMessages([]);
            setChatInput("");
          }} 
          widthClass="max-w-2xl"
        >
          <div className="flex flex-col h-[60vh]">
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
              {chatMessages.length === 0 ? (
                <div className="text-sm text-black/60 text-center py-8">
                  Ask me anything about your inventory! For example:
                  <ul className="mt-2 text-left list-disc list-inside space-y-1">
                    <li>"What items are expiring soon?"</li>
                    <li>"How many items do I have in total?"</li>
                    <li>"Where can I find [item name]?"</li>
                    <li>"What items are in [room name]?"</li>
                  </ul>
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={cx(
                      "rounded-xl p-3",
                      msg.role === 'user'
                        ? "bg-blue-50 border border-blue-200 ml-8"
                        : "bg-gray-50 border border-gray-200 mr-8"
                    )}
                  >
                    <div className="text-xs font-medium text-black/60 mb-1">
                      {msg.role === 'user' ? 'You' : 'AI Assistant'}
                    </div>
                    <div className="text-sm text-black/80 whitespace-pre-wrap">{msg.content}</div>
                  </div>
                ))
              )}
              {chatLoading && (
                <div className="rounded-xl p-3 bg-gray-50 border border-gray-200 mr-8">
                  <div className="text-xs font-medium text-black/60 mb-1">AI Assistant</div>
                  <div className="text-sm text-black/60">Thinking...</div>
                </div>
              )}
            </div>

            {/* Input area */}
            <div className="flex-shrink-0 border-t border-black/10 pt-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      const now = Date.now();
                      // If pressed Enter within 500ms of last Enter, send message
                      if (now - lastEnterTime < 500 && lastEnterTime > 0) {
                        sendChatMessage();
                        setLastEnterTime(0); // Reset
                      } else {
                        // First Enter press, just update timestamp
                        setLastEnterTime(now);
                      }
                    }
                  }}
                  placeholder="Ask a question about your inventory... (Press Enter twice to send)"
                  disabled={chatLoading}
                  className="flex-1 px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-60"
                />
                <button
                  onClick={sendChatMessage}
                  disabled={!chatInput.trim() || chatLoading}
                  className="px-4 py-2 rounded-xl border border-blue-600/30 bg-blue-50 text-blue-700 hover:bg-blue-100 text-sm disabled:opacity-60"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </Modal>

        {/* Edit household name modal */}
        <Modal open={editNameModalOpen} title="Edit Household Name" onClose={() => {
          setEditNameModalOpen(false);
          setTargetHouseholdId(null);
          setHouseholdDraftName("");
        }} widthClass="max-w-lg">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-black/80 mb-1">
                Household Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={householdDraftName}
                onChange={(e) => setHouseholdDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveEditHouseholdName();
                  }
                }}
                className="w-full px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                placeholder="Enter household name"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setEditNameModalOpen(false);
                  setTargetHouseholdId(null);
                  setHouseholdDraftName("");
                }}
                className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveEditHouseholdName}
                disabled={busyId === targetHouseholdId || !householdDraftName.trim()}
                className="px-3 py-2 rounded-xl border border-blue-600/30 bg-blue-50 text-blue-700 hover:bg-blue-100 text-sm disabled:opacity-60"
              >
                {busyId === targetHouseholdId ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </Modal>

        {/* Switch household modal */}
        <Modal open={switchModalOpen} title="Switch household" onClose={() => setSwitchModalOpen(false)} widthClass="max-w-lg">
          <div className="text-sm text-black/70">Select a household (only switches active, does not change default):</div>

          <div className="mt-3 flex flex-col gap-2">
            {(() => {
              const householdList = rows
              .map((r) => normalizeHousehold(r.households))
              .filter(Boolean)
                .map((hh) => hh as HouseholdMini);
              
              // Sort: current first, then others alphabetically
              const sorted = householdList.sort((a, b) => {
                if (a.id === activeHouseholdId) return -1;
                if (b.id === activeHouseholdId) return 1;
                return a.name.localeCompare(b.name);
              });
              
              return sorted.map((h) => {
                const isActive = activeHouseholdId === h.id;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      writeActiveHouseholdToStorage(h.id);
                      setSwitchModalOpen(false);
                      setToast("Switched household");
                      router.push("/rooms");
                    }}
                    className={cx(
                      "px-3 py-2 rounded-xl border text-left hover:bg-black/5",
                      isActive ? "border-black/30 bg-black/5" : "border-black/10"
                    )}
                  >
                    <div className="text-sm">{h.name}</div>
                    {isActive ? <div className="text-xs text-black/60 mt-0.5">Current active</div> : null}
                  </button>
                );
              });
            })()}
          </div>

          <div className="mt-4 flex items-center justify-end">
            <button
              className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm"
              onClick={() => setSwitchModalOpen(false)}
            >
              Close
            </button>
          </div>
        </Modal>

        {toast && <Toast message={toast} />}
      </div>
    </AuthGate>
  );
  //test
}

