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

    // profiles schema 兼容：id / user_id
    const profById = await supabase
      .from("profiles")
      .select("default_household_id")
      .eq("id", userId)
      .maybeSingle();

    if (profById.error) {
      const profByUserId = await supabase
        .from("profiles")
        .select("default_household_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (profByUserId.error) return setErr(profByUserId.error.message);
      setDefaultId(profByUserId.data?.default_household_id ?? null);
    } else {
      setDefaultId(profById.data?.default_household_id ?? null);
    }

    const hm = await supabase
      .from("household_members")
      .select("household_id, role, households(id,name,join_code)")
      .eq("user_id", userId);

    if (hm.error) return setErr(hm.error.message);

    // ✅ 这里不做危险的强转；Row 已经兼容 households 为 object 或 array
    setRows((hm.data ?? []) as unknown as Row[]);
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
      setToast("已刷新");
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
    setErr(null);
    setBusyId(hid);
    try {
      const { error } = await supabase.rpc("set_default_household", { p_household_id: hid });
      if (error) throw error;

      // 设为默认时，清掉临时 active
      writeActiveHouseholdToStorage(null);

      setDefaultId(hid);
      router.push("/rooms");
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
                管理你的 households：切换、设为默认、删除（owner）。
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

              return (
                <div key={h.id} className={cx("rounded-2xl border p-4", "border-black/10", oatCard)}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{h.name}</div>
                      <div className="text-sm text-black/70 mt-1">Role: {r.role ?? "member"}</div>
                      {h.join_code ? (
                        <div className="text-sm text-black/70 mt-1">Join code: {h.join_code}</div>
                      ) : null}

                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {activeHouseholdId === h.id ? (
                          <span className="text-xs px-2 py-1 rounded-lg border border-black/20 bg-black/5">
                            Active
                          </span>
                        ) : null}
                        {isDefault ? (
                          <span className="text-xs px-2 py-1 rounded-lg border border-black/20 bg-black/5">
                            Default
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
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

                      {isOwner ? (
                        <button
                          onClick={() => deleteHousehold(h.id, h.name)}
                          disabled={busy}
                          className="px-3 py-2 rounded-xl border border-red-600/30 bg-red-50 text-red-700 hover:bg-red-100 text-sm font-semibold disabled:opacity-60"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {busy ? <div className="text-sm text-black/60 mt-2">Working…</div> : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Switch household modal */}
        <Modal open={switchModalOpen} title="Switch household" onClose={() => setSwitchModalOpen(false)} widthClass="max-w-lg">
          <div className="text-sm text-black/70">选择一个 household（仅切换 active，不改变 default）：</div>

          <div className="mt-3 flex flex-col gap-2">
            {rows
              .map((r) => normalizeHousehold(r.households))
              .filter(Boolean)
              .map((hh) => {
                const h = hh as HouseholdMini;
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
              })}
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

