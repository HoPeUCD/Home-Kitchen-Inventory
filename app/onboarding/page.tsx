"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { useRouter } from "next/navigation";
import AuthGate from "@/src/components/AuthGate";
import HouseholdTopBar from "@/src/components/HouseholdTopBar";

const ACTIVE_HOUSEHOLD_KEY = "active_household_id";

type HouseholdMini = { id: string; name: string };

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
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

export default function OnboardingPage() {
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);

  const [householdName, setHouseholdName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState("");

  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // topbar & switch household
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");
  const [switchModalOpen, setSwitchModalOpen] = useState(false);
  const [households, setHouseholds] = useState<HouseholdMini[]>([]);
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(null);

  // theme
  const oatBg = "bg-[#F7F1E6]";
  const oatCard = "bg-[#FBF7EF]";

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    try {
      const cur = localStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
      setActiveHouseholdId(cur);
    } catch {}
  }, []);

  const user = session?.user ?? null;
  const email = user?.email ?? "";

  const suggestions = useMemo(() => {
    return ["Hope Home", "Hope’s Household", "Family Home", "My Home Inventory"];
  }, []);

  function writeActiveHouseholdToStorage(hid: string | null) {
    try {
      if (!hid) localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
      else localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, hid);
    } catch {}
    setActiveHouseholdId(hid);
  }

  async function loadHouseholdsForSwitch() {
    if (!session?.user?.id) return;
    const userId = session.user.id;

    const hm = await supabase
      .from("household_members")
      .select("households(id,name)")
      .eq("user_id", userId);

    if (hm.error) return;

    // 兼容 households 可能被推为数组
    const list: HouseholdMini[] = [];
    for (const r of hm.data ?? []) {
      const h = (r as any).households;
      if (!h) continue;
      const one = Array.isArray(h) ? h[0] : h;
      if (one?.id && one?.name) list.push({ id: String(one.id), name: String(one.name) });
    }

    // 去重
    const seen = new Set<string>();
    const uniq = list.filter((x) => {
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });

    setHouseholds(uniq);
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadHouseholdsForSwitch();
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

  useEffect(() => {
    loadHouseholdsForSwitch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function createHousehold() {
    setErr(null);
    setStatus(null);

    const nm = householdName.trim();
    if (!nm) return setErr("Household name required.");

    setBusy(true);
    try {
      const { error } = await supabase.rpc("create_household", { p_name: nm });
      if (error) throw error;

      setStatus("Created. Redirecting…");
      router.replace("/rooms");
    } catch (e: any) {
      setErr(e?.message ?? "Create household failed.");
    } finally {
      setBusy(false);
    }
  }

  async function requestJoin() {
    setErr(null);
    setStatus(null);

    const code = joinCode.trim();
    if (!code) return setErr("Join code required.");

    setBusy(true);
    try {
      const { error } = await supabase.rpc("request_join_by_code", {
        p_join_code: code,
        p_message: message.trim() || null,
      });
      if (error) throw error;

      setStatus("Request submitted. Waiting for approval.");
    } catch (e: any) {
      setErr(e?.message ?? "Request join failed.");
    } finally {
      setBusy(false);
    }
  }

  // topbar 显示：Onboarding 阶段可能没有 household，因此这里用固定标题
  const topbarHouseholdName = "Onboarding";

  return (
    <AuthGate onAuthed={() => {}}>
      <div className={cx("min-h-screen", oatBg)}>
        <div className="max-w-[1100px] mx-auto px-4 py-5">
          <HouseholdTopBar
            householdName={topbarHouseholdName}
            userEmail={email || user?.id || ""}
            refreshing={refreshing}
            onRefresh={onRefresh}
            onOpenSwitchHousehold={() => {
              setSwitchModalOpen(true);
            }}
            onSignOut={signOut}
          />

          <div className="mt-4 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-xl font-semibold">Get started</div>
              <div className="text-xs text-black/60 mt-0.5">
                Create a household or request to join with a join code.
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => router.push("/households")}
                className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm"
              >
                Households
              </button>
              <button
                onClick={() => router.push("/rooms")}
                className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm"
              >
                All rooms
              </button>
            </div>
          </div>

          {err && (
            <div className="mt-3 rounded-2xl border border-red-500/25 bg-red-50 px-4 py-3 text-sm text-red-800">
              {err}
            </div>
          )}
          {status && (
            <div className="mt-3 rounded-2xl border border-black/10 bg-white/60 px-4 py-3 text-sm text-black/80">
              {status}
            </div>
          )}

          <div className="mt-4 grid gap-4 grid-cols-1 md:grid-cols-2">
            {/* Create */}
            <div className={cx("rounded-2xl border p-4", "border-black/10", oatCard)}>
              <div className="font-semibold mb-2">Create a household</div>

              <div className="flex gap-2 flex-wrap mb-3">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setHouseholdName(s)}
                    className="px-3 py-1.5 rounded-full border border-black/10 bg-white/70 hover:bg-white text-sm"
                  >
                    {s}
                  </button>
                ))}
              </div>

              <input
                value={householdName}
                onChange={(e) => setHouseholdName(e.target.value)}
                placeholder="Example: Hope & Tasha Home"
                className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white/70 focus:outline-none focus:ring-2 focus:ring-black/10"
              />

              <button
                onClick={createHousehold}
                disabled={busy || !householdName.trim()}
                className={cx(
                  "mt-3 w-full px-3 py-2 rounded-xl border text-sm font-semibold",
                  busy || !householdName.trim()
                    ? "border-black/10 bg-black/5 text-black/40"
                    : "border-black/10 hover:bg-black/5"
                )}
              >
                {busy ? "Working…" : "Create"}
              </button>
            </div>

            {/* Join */}
            <div className={cx("rounded-2xl border p-4", "border-black/10", oatCard)}>
              <div className="font-semibold mb-2">Join with a code</div>

              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Join code (e.g. A1B2C3D4E5)"
                className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white/70 focus:outline-none focus:ring-2 focus:ring-black/10"
              />

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Optional message to the admin"
                className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white/70 focus:outline-none focus:ring-2 focus:ring-black/10 mt-3 min-h-[90px]"
              />

              <button
                onClick={requestJoin}
                disabled={busy || !joinCode.trim()}
                className={cx(
                  "mt-3 w-full px-3 py-2 rounded-xl border text-sm font-semibold",
                  busy || !joinCode.trim()
                    ? "border-black/10 bg-black/5 text-black/40"
                    : "border-black/10 hover:bg-black/5"
                )}
              >
                {busy ? "Working…" : "Request to join"}
              </button>
            </div>
          </div>
        </div>

        {/* Switch household modal */}
        <Modal
          open={switchModalOpen}
          title="Switch household"
          onClose={() => setSwitchModalOpen(false)}
          widthClass="max-w-lg"
        >
          <div className="text-sm text-black/70">
            Select a household (only switches active, does not change default):
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {households.length === 0 ? (
              <div className="text-sm text-black/60">
                You haven't joined any household yet. Please create one or join one first.
              </div>
            ) : (
              (() => {
                // Sort: current first, then others alphabetically
                const sorted = [...households].sort((a, b) => {
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
              })()
            )}
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
}
