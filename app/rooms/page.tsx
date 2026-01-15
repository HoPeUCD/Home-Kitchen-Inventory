'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import AuthGate from "@/src/components/AuthGate";
import { supabase } from "@/src/lib/supabase";
import HouseholdTopBar from "@/src/components/HouseholdTopBar";
import { cx } from "@/src/lib/utils";
import Modal from "@/src/components/ui/Modal";
import ConfirmModal from "@/src/components/ui/ConfirmModal";
import Toast from "@/src/components/ui/Toast";
import SmallIconButton from "@/src/components/ui/SmallIconButton";

type UUID = string;

type Household = { id: UUID; name: string };
type Room = { id: UUID; household_id: UUID; name: string; position: number | null };

const ACTIVE_HOUSEHOLD_KEY = 'active_household_id';

const THEME = {
  oatBg: 'bg-[#F7F1E6]',
  oatCard: 'bg-[#FBF7EF]',
  borderSoft: 'border-black/10',
  blueBorderSoft: 'border-[#2563EB]/25',
};

export default function Page() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState('');

  const [activeHouseholdId, setActiveHouseholdId] = useState<UUID | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHousehold, setActiveHousehold] = useState<Household | null>(null);

  const [rooms, setRooms] = useState<Room[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState('');

  const [switchHouseholdOpen, setSwitchHouseholdOpen] = useState(false);

  // room CRUD modals
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [editRoomOpen, setEditRoomOpen] = useState(false);
  const [deleteRoomConfirmOpen, setDeleteRoomConfirmOpen] = useState(false);

  const [roomDraftName, setRoomDraftName] = useState('');
  const [targetRoomId, setTargetRoomId] = useState<UUID | null>(null);

  // toast auto-hide
  React.useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  // init user + active household id (localStorage -> profile fallback)
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const user = userRes?.user;
        setUserEmail(user?.email ?? '');

        // Always read from localStorage first (highest priority)
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_HOUSEHOLD_KEY) : null;
        if (stored) {
          setActiveHouseholdId(stored);
          // Don't return early - we still need to load households list
        } else if (user?.id) {
          // Only fallback to profile if localStorage is empty
          const { data: profile, error: pErr } = await supabase
            .from('profiles')
            .select('default_household_id')
            .eq('user_id', user.id)
            .maybeSingle();

          if (!pErr && profile?.default_household_id) {
            setActiveHouseholdId(profile.default_household_id);
            window.localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, profile.default_household_id);
          }
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // load households list (for switch modal)
  useEffect(() => {
    const loadHouseholds = async () => {
      const { data: mData, error: mErr } = await supabase
        .from('household_members')
        .select('households ( id, name )');

      if (mErr) {
        console.error(mErr);
        setHouseholds([]);
        return;
      }

      const list: Household[] =
        (mData || [])
          .map((x: any) => x?.households)
          .filter(Boolean)
          .map((h: any) => ({ id: h.id, name: h.name })) ?? [];

      const seen = new Set<string>();
      const dedup = list.filter((h) => {
        if (seen.has(h.id)) return false;
        seen.add(h.id);
        return true;
      });

      setHouseholds(dedup);

      // Only set default if activeHouseholdId is still null after all initialization
      // Check localStorage again to make sure we don't override
      const storedCheck = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_HOUSEHOLD_KEY) : null;
      if (!activeHouseholdId && !storedCheck && dedup.length > 0) {
        const first = dedup[0].id;
        setActiveHouseholdId(first);
        window.localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, first);
      }
    };

    loadHouseholds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHouseholdId]);

  useEffect(() => {
    if (!activeHouseholdId) {
      setActiveHousehold(null);
      return;
    }
    setActiveHousehold(households.find((x) => x.id === activeHouseholdId) ?? null);
  }, [activeHouseholdId, households]);

  const loadRooms = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);

    try {
      if (!activeHouseholdId) return;

      const { data, error } = await supabase
        .from('rooms')
        .select('id, household_id, name, position')
        .eq('household_id', activeHouseholdId)
        .order('position', { ascending: true });

      if (error) console.error(error);
      setRooms((data as Room[]) ?? []);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeHouseholdId) return;
    loadRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHouseholdId]);

  const onRefresh = async () => {
    if (!activeHouseholdId) return;
    setRefreshing(true);
    try {
      await loadRooms({ silent: true });
      setToast('Refreshed');
    } finally {
      setRefreshing(false);
    }
  };

  const onSignOut = async () => {
    await supabase.auth.signOut();
    router.refresh();
  };

  const doSwitchHousehold = (hid: UUID) => {
    window.localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, hid);
    setActiveHouseholdId(hid);
    setSwitchHouseholdOpen(false);
    setToast('Switched household');
  };

  // room CRUD
  const openAddRoom = () => {
    setRoomDraftName('');
    setAddRoomOpen(true);
  };

  const createRoom = async () => {
    const name = roomDraftName.trim();
    if (!name) return;
    if (!activeHouseholdId) return;

    const maxPos = Math.max(-1, ...rooms.map((r) => r.position ?? 0));
    const position = (Number.isFinite(maxPos) ? maxPos : 0) + 1;

    const { error } = await supabase.from('rooms').insert({
      household_id: activeHouseholdId,
      name,
      position,
    });

    if (error) {
      console.error(error);
      setToast('Failed to create room');
      return;
    }

    setAddRoomOpen(false);
    setToast('Room created');
    await loadRooms({ silent: true });
  };

  const openEditRoom = (room: Room) => {
    setTargetRoomId(room.id);
    setRoomDraftName(room.name ?? '');
    setEditRoomOpen(true);
  };

  const saveEditRoom = async () => {
    if (!targetRoomId) return;
    const name = roomDraftName.trim();
    if (!name) return;

    const { error } = await supabase.from('rooms').update({ name }).eq('id', targetRoomId);
    if (error) {
      console.error(error);
      setToast('Failed to update room');
      return;
    }

    setEditRoomOpen(false);
    setTargetRoomId(null);
    setToast('Room updated');
    await loadRooms({ silent: true });
  };

  const openDeleteRoom = (roomId: UUID) => {
    setTargetRoomId(roomId);
    setDeleteRoomConfirmOpen(true);
  };

  const confirmDeleteRoom = async () => {
    if (!targetRoomId) return;

    // 注意：rooms 删除会影响 room_columns/room_cells/items 的级联情况取决于你数据库外键设置。
    // 这里先做“提示 + 执行 delete rooms”。
    const { error } = await supabase.from('rooms').delete().eq('id', targetRoomId);
    if (error) {
      console.error(error);
      setToast('Failed to delete room');
      return;
    }

    setDeleteRoomConfirmOpen(false);
    setTargetRoomId(null);
    setToast('Room deleted');
    await loadRooms({ silent: true });
  };

  const filteredRooms = useMemo(() => {
    // 轻量过滤（不引入 fuse），更稳定也更快
    return rooms;
  }, [rooms]);

  return (
    <AuthGate>
      <div className={cx('min-h-screen', THEME.oatBg)}>
        <div className="max-w-[1200px] mx-auto px-4 py-5">
          <HouseholdTopBar
            householdName={activeHousehold?.name ?? 'Household'}
            userEmail={userEmail}
            refreshing={refreshing}
            onRefresh={onRefresh}
            onOpenSwitchHousehold={() => setSwitchHouseholdOpen(true)}
            onSignOut={onSignOut}
          />

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xl font-semibold truncate">All rooms</div>
              <div className="text-xs text-black/60 mt-0.5">Click a room to open.</div>
            </div>

            <button
              type="button"
              className={cx('px-3 py-2 rounded-xl border text-sm hover:bg-black/5', THEME.blueBorderSoft)}
              onClick={openAddRoom}
              title="Add room"
            >
              Add room
            </button>
          </div>

          <div className="mt-4">
            {loading ? (
              <div className="text-sm text-black/60 py-6">Loading rooms…</div>
            ) : filteredRooms.length === 0 ? (
              <div className={cx('rounded-2xl border p-5', THEME.borderSoft, THEME.oatCard)}>
                <div className="text-sm text-black/70">No rooms yet.</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredRooms.map((r) => (
                  <div key={r.id} className={cx('rounded-2xl border p-4', THEME.borderSoft, THEME.oatCard)}>
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className="text-left min-w-0 flex-1"
                        onClick={() => router.push(`/rooms/${r.id}`)}
                        title="Open room"
                      >
                        <div className="text-base font-semibold truncate">{r.name}</div>
                        <div className="text-xs text-black/60 mt-1">Open →</div>
                      </button>

                      <div className="flex items-center gap-2">
                        <SmallIconButton title="Edit room" onClick={() => openEditRoom(r)}>
                          ✏️
                        </SmallIconButton>
                        <SmallIconButton title="Delete room" onClick={() => openDeleteRoom(r.id)} className="hover:bg-red-50">
                          🗑️
                        </SmallIconButton>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Switch household */}
        <Modal open={switchHouseholdOpen} title="Switch household" onClose={() => setSwitchHouseholdOpen(false)} widthClass="max-w-lg">
          <div className="text-sm text-black/70">Select a household:</div>
          <div className="mt-3 flex flex-col gap-2">
            {(() => {
              // Sort: current first, then others alphabetically
              const sorted = [...households].sort((a, b) => {
                if (a.id === activeHouseholdId) return -1;
                if (b.id === activeHouseholdId) return 1;
                return a.name.localeCompare(b.name);
              });
              return sorted.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => doSwitchHousehold(h.id)}
                  className={cx(
                    'px-3 py-2 rounded-xl border text-left hover:bg-black/5',
                    h.id === activeHouseholdId ? 'border-black/30 bg-black/5' : 'border-black/10'
                  )}
                >
                  <div className="text-sm">{h.name}</div>
                  {h.id === activeHouseholdId && <div className="text-xs text-black/60 mt-0.5">Current</div>}
                </button>
              ));
            })()}
          </div>
        </Modal>

        {/* Add room */}
        <Modal open={addRoomOpen} title="Add room" onClose={() => setAddRoomOpen(false)} widthClass="max-w-lg">
          <div className="text-sm text-black/70">Room name</div>
          <input
            value={roomDraftName}
            onChange={(e) => setRoomDraftName(e.target.value)}
            className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
            placeholder="e.g., Kitchen"
          />
          <div className="mt-5 flex items-center justify-end gap-2">
            <button className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm" onClick={() => setAddRoomOpen(false)}>
              Cancel
            </button>
            <button className="px-3 py-2 rounded-xl border border-black bg-black text-white hover:bg-black/90 text-sm" onClick={createRoom}>
              Create
            </button>
          </div>
        </Modal>

        {/* Edit room */}
        <Modal open={editRoomOpen} title="Edit room" onClose={() => setEditRoomOpen(false)} widthClass="max-w-lg">
          <div className="text-sm text-black/70">Room name</div>
          <input
            value={roomDraftName}
            onChange={(e) => setRoomDraftName(e.target.value)}
            className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
          />
          <div className="mt-5 flex items-center justify-end gap-2">
            <button className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm" onClick={() => setEditRoomOpen(false)}>
              Cancel
            </button>
            <button className="px-3 py-2 rounded-xl border border-black bg-black text-white hover:bg-black/90 text-sm" onClick={saveEditRoom}>
              Save
            </button>
          </div>
        </Modal>

        {/* Delete room */}
        <ConfirmModal
          open={deleteRoomConfirmOpen}
          title="Delete room?"
          description="Deleting this room may affect columns/cells/items under it (depending on database foreign key/cascade settings). This action cannot be undone."
          onCancel={() => {
            setDeleteRoomConfirmOpen(false);
            setTargetRoomId(null);
          }}
          onConfirm={confirmDeleteRoom}
        />

        {toast && <Toast message={toast} />}
      </div>
    </AuthGate>
  );
}

