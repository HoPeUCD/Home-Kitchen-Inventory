"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { useParams, useRouter } from "next/navigation";
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

export default function InviteAcceptPage() {
  const router = useRouter();
  const params = useParams();
  const token = (params as any)?.token as string;

  const [session, setSession] = useState<Session | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Preparing…");
  const [accepted, setAccepted] = useState(false);

  // topbar + switch household
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

  async function loadHouseholdsForSwitch() {
    if (!session?.user?.id) return;

    const userId = session.user.id;
    const hm = await supabase
      .from("household_members")
      .select("households(id,name)")
      .eq("user_id", userId);

    if (hm.error) return;

    const list: HouseholdMini[] = [];
    for (const r of hm.data ?? []) {
      const h = (r as any).households;
      if (!h) continue;
      const one = Array.isArray(h) ? h[0] : h;
      if (one?.id && one?.name) list.push({ id: String(one.id), name: String(one.name) });
    }

    // de-dup
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
      setToast("已刷新");
    } finally {
      setRefreshing(false);
    }
  }

  function writeActiveHouseholdToStorage(hid: string | null) {
    try {
      if (!hid) localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
      else localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, hid);
    } catch {}
    setActiveHouseholdId(hid);
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

  const userEmail = session?.user?.email ?? "";

  // 顶栏的 householdName：邀请接受页面通常还未确定 active household，用固定标题最安全
  const topbarHouseholdName = useMemo(() => {
    return "Invite";
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!token) {
      setErr("Missing invite token.");
      setStatus("Failed");
      return;
    }
    if (accepted) return;

    (async () => {
      setErr(null);
      setStatus("Accepting invite…");

      const { error } = await supabase.rpc("accept_household_invite", { p_token: token });

      if (error) {
        setErr(error.message);
        setStatus("Failed");
        return;
      }

      setAccepted(true);
      setStatus("Accepted. Redirecting…");

      // 接受后刷新一下 household 列表（用于 switch modal / topbar）
      await loadHouseholdsForSwitch();

      router.replace("/rooms");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, token, accepted]);

  return (
    <AuthGate onAuthed={() => {}}>
      <div className={cx("min-h-screen", oatBg)}>
        <div className="max-w-[900px] mx-auto px-4 py-5">
          <HouseholdTopBar
            householdName={topbarHouseholdName}
            userEmail={userEmail || session?.user?.id || ""}
            refreshing={refreshing}
            onRefresh={onRefresh}
            onOpenSwitchHousehold={() => setSwitchModalOpen(true)}
            onSignOut={signOut}
          />

          <div className="mt-4">
            <div className={cx("rounded-2xl border p-4", "border-black/10", oatCard)}>
              <div className="font-semibold">{status}</div>
              {err ? <div className="text-sm text-red-700 mt-2">{err}</div> : null}

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => router.push("/rooms")}
                  className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm"
                >
                  All rooms
                </button>
                <button
                  onClick={() => router.push("/households")}
                  className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm"
                >
                  Households
                </button>
              </div>
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
          <div className="text-sm text-black/70">选择一个 household（仅切换 active，不改变 default）：</div>

          <div className="mt-3 flex flex-col gap-2">
            {households.length === 0 ? (
              <div className="text-sm text-black/60">
                你还没有加入任何 household（或尚未刷新到列表）。
              </div>
            ) : (
              households.map((h) => {
                const isActive = activeHouseholdId === h.id;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      writeActiveHouseholdToStorage(h.id);
                      setSwitchModalOpen(false);
                      setToast("已切换 household");
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
              })
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
