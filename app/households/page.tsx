"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

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
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className={cx(
          "absolute left-1/2 top-1/2 w-[92vw] -translate-x-1/2 -translate-y-1/2",
          widthClass
        )}
      >
        <div className="rounded-2xl shadow-xl border border-black/10 bg-[#FBF7EF]">
          <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between gap-3">
            <div className="text-base font-semibold">{title}</div>
            <button
              onClick={onClose}
              className="px-2 py-1 rounded-lg border border-black/10 hover:bg-black/5 text-sm"
              aria-label="Close"
              title="Close"
            >
              ✕
            </button>
          </div>
          <div className="p-5">{children}</div>
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
                <div key={h.id} className={cx("rounded-2xl border p-4", "border-black/10", oatCard)}>
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
                    <div className="font-semibold truncate">{h.name}</div>
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
                      Switch only
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

                    {isOwner && (
                      <button
                        onClick={() => deleteHousehold(h.id, h.name)}
                        disabled={busy}
                        className="px-3 py-2 rounded-xl border border-red-600/30 bg-red-50 text-red-700 hover:bg-red-100 text-sm font-semibold disabled:opacity-60"
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {/* Members list */}
                  <div className="pt-3 border-t border-black/10">
                    <div className="text-sm font-medium text-black/80 mb-2">Members ({members.length}):</div>
                    <div className="space-y-1">
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
                  </div>

                  {busy && <div className="text-sm text-black/60 mt-3">Working…</div>}
                </div>
              );
            })}
          </div>
        </div>

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

