'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Fuse from 'fuse.js';

import AuthGate from "@/src/components/AuthGate";
import { supabase } from "@/src/lib/supabase";
import HouseholdTopBar from "@/src/components/HouseholdTopBar";

type UUID = string;

type Household = { id: UUID; name: string };
type Room = { id: UUID; household_id: UUID; name: string; position: number | null };
type Column = { id: UUID; room_id: UUID; name: string; position: number | null };
type Cell = { id: UUID; column_id: UUID; code: string; position: number | null };
type ItemV2 = {
  id: UUID;
  household_id: UUID;
  cell_id: UUID;
  name: string;
  qty: number | null;
  expires_at: string | null;
  image_path: string | null;
};

const ACTIVE_HOUSEHOLD_KEY = 'active_household_id';
const STORAGE_BUCKET = 'item-images';

const THEME = {
  oatBg: 'bg-[#F7F1E6]',
  oatCard: 'bg-[#FBF7EF]',
  borderSoft: 'border-black/10',
  blueBorderSoft: 'border-[#2563EB]/25',
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

// ----- date helpers (treat YYYY-MM-DD as local date) -----
function parseDateOnlyLocalMidnight(dateOnly: string) {
  const [y, m, d] = dateOnly.split('-').map((x) => Number(x));
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}
function daysUntil(dateOnly: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const target = parseDateOnlyLocalMidnight(dateOnly);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
function expiryChipClass(expires_at: string | null) {
  if (!expires_at) return 'bg-white border border-black/10';
  const d = daysUntil(expires_at.slice(0, 10));
  if (d < 0) return 'bg-red-500/20 border border-red-500/30';
  if (d <= 7) return 'bg-orange-500/20 border border-orange-500/30';
  if (d <= 30) return 'bg-yellow-500/20 border border-yellow-500/30';
  return 'bg-emerald-500/15 border border-emerald-500/25';
}
function formatExpiryLabel(expires_at: string | null) {
  if (!expires_at) return '';
  const dateOnly = expires_at.slice(0, 10);
  const d = daysUntil(dateOnly);
  if (d < 0) return `已过期 ${Math.abs(d)}d`;
  if (d === 0) return '今天到期';
  return `${d}d`;
}
function toDateOnly(expires_at: string | null) {
  if (!expires_at) return '';
  return expires_at.slice(0, 10);
}

// ----- UI primitives -----
function Modal({
  open,
  title,
  onClose,
  children,
  widthClass = 'max-w-xl',
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
      <div className={cx('absolute left-1/2 top-1/2 w-[92vw] -translate-x-1/2 -translate-y-1/2', widthClass)}>
        <div className={cx('rounded-2xl shadow-xl border', THEME.borderSoft, THEME.oatCard)}>
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

function ConfirmModal({
  open,
  title,
  description,
  confirmText = '删除',
  cancelText = '取消',
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel} widthClass="max-w-lg">
      <div className="text-sm text-black/80 whitespace-pre-wrap">{description}</div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm" onClick={onCancel}>
          {cancelText}
        </button>
        <button
          className={cx(
            'px-3 py-2 rounded-xl text-sm border',
            destructive ? 'bg-red-600 text-white border-red-600 hover:bg-red-700' : 'bg-black text-white border-black hover:bg-black/90'
          )}
          onClick={onConfirm}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}

function SmallIconButton({
  title,
  onClick,
  children,
  className,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cx(
        'h-8 w-8 inline-flex items-center justify-center rounded-lg border border-black/10 hover:bg-black/5 text-sm select-none',
        className
      )}
    >
      {children}
    </button>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80]">
      <div className="px-4 py-2 rounded-2xl bg-black text-white text-sm shadow-lg">{message}</div>
    </div>
  );
}

export default function Page() {
  const router = useRouter();
  const params = useParams<{ roomId: string }>();
  const roomId = params?.roomId as string;

  // auth/user
  const [userEmail, setUserEmail] = useState('');

  // household context
  const [activeHouseholdId, setActiveHouseholdId] = useState<UUID | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHousehold, setActiveHousehold] = useState<Household | null>(null);

  // room data
  const [room, setRoom] = useState<Room | null>(null);
  const [roomsInHousehold, setRoomsInHousehold] = useState<Room[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [cellsByColumn, setCellsByColumn] = useState<Record<UUID, Cell[]>>({});
  const [itemsByCell, setItemsByCell] = useState<Record<UUID, ItemV2[]>>({});

  // UI state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState('');

  // Search
  const [search, setSearch] = useState('');
  const [onlyShowMatches, setOnlyShowMatches] = useState(false);

  // highlight for jump-to-cell
  const [highlightCellId, setHighlightCellId] = useState<UUID | null>(null);

  // switch household modal
  const [switchHouseholdOpen, setSwitchHouseholdOpen] = useState(false);

  // Column menu + modals
  const [columnMenuOpenId, setColumnMenuOpenId] = useState<UUID | null>(null);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [editColumnOpen, setEditColumnOpen] = useState(false);
  const [deleteColumnConfirmOpen, setDeleteColumnConfirmOpen] = useState(false);
  const [columnDraftName, setColumnDraftName] = useState('');
  const [targetColumnId, setTargetColumnId] = useState<UUID | null>(null);

  // Cell modals
  const [addCellOpen, setAddCellOpen] = useState(false);
  const [editCellOpen, setEditCellOpen] = useState(false);
  const [deleteCellConfirmOpen, setDeleteCellConfirmOpen] = useState(false);
  const [cellDraftCode, setCellDraftCode] = useState('');
  const [targetCellId, setTargetCellId] = useState<UUID | null>(null);
  const [cellParentColumnId, setCellParentColumnId] = useState<UUID | null>(null);

  // Item modal
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemMode, setItemMode] = useState<'add' | 'edit'>('add');
  const [itemDeleteConfirmOpen, setItemDeleteConfirmOpen] = useState(false);
  const [targetItemId, setTargetItemId] = useState<UUID | null>(null);

  const [itemDraft, setItemDraft] = useState<{
    id: UUID | null;
    name: string;
    qty: string; // IMPORTANT: string => fixes “0 stuck / 02”
    expires_at: string; // yyyy-mm-dd
    imageFile: File | null;
    image_path: string | null;
    room_id: UUID | null;
    cell_id: UUID | null;
  }>({
    id: null,
    name: '',
    qty: '',
    expires_at: '',
    imageFile: null,
    image_path: null,
    room_id: null,
    cell_id: null,
  });

  const itemNameInputRef = useRef<HTMLInputElement | null>(null);

  // cache: for item location selector (room -> cell)
  const [cellsForRoomCache, setCellsForRoomCache] = useState<Record<UUID, Array<{ cell: Cell; column: Column }>>>({});
  const [loadingCellsForRoom, setLoadingCellsForRoom] = useState(false);

  // fonts
  const fontOswald = { fontFamily: 'Oswald, ui-sans-serif, system-ui' } as const;
  const fontNunito = { fontFamily: 'Nunito, ui-sans-serif, system-ui' } as const;

  // toast auto-hide
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  // init: get user email + household id (localStorage -> profile fallback)
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const user = userRes?.user;
        setUserEmail(user?.email ?? '');

        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_HOUSEHOLD_KEY) : null;
        if (stored) {
          setActiveHouseholdId(stored);
          return;
        }

        // fallback: profile default_household_id
        if (user?.id) {
          const { data: profile, error: pErr } = await supabase
            .from('profiles')
            .select('default_household_id')
            .eq('id', user.id)
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

  // load households list
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

      if (!activeHouseholdId && dedup.length > 0) {
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

  // load all room data
  const loadAll = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);

    try {
      if (!activeHouseholdId) return;

      // rooms for location selector
      const { data: roomsData, error: roomsErr } = await supabase
        .from('rooms')
        .select('id, household_id, name, position')
        .eq('household_id', activeHouseholdId)
        .order('position', { ascending: true });

      if (roomsErr) console.error(roomsErr);
      setRoomsInHousehold((roomsData as Room[]) ?? []);

      // current room
      const { data: roomData, error: roomErr } = await supabase
        .from('rooms')
        .select('id, household_id, name, position')
        .eq('id', roomId)
        .maybeSingle();

      if (roomErr) console.error(roomErr);
      setRoom((roomData as Room) ?? null);

      // columns
      const { data: colData, error: cErr } = await supabase
        .from('room_columns')
        .select('id, room_id, name, position')
        .eq('room_id', roomId)
        .order('position', { ascending: true });

      if (cErr) console.error(cErr);
      const cols = (colData as Column[]) ?? [];
      setColumns(cols);

      if (cols.length === 0) {
        setCellsByColumn({});
        setItemsByCell({});
        return;
      }

      // cells
      const colIds = cols.map((c) => c.id);
      const { data: cellData, error: cellErr } = await supabase
        .from('room_cells')
        .select('id, column_id, code, position')
        .in('column_id', colIds)
        .order('position', { ascending: true });

      if (cellErr) console.error(cellErr);
      const cells = (cellData as Cell[]) ?? [];

      const byCol: Record<UUID, Cell[]> = {};
      colIds.forEach((id) => (byCol[id] = []));
      cells.forEach((cell) => {
        if (!byCol[cell.column_id]) byCol[cell.column_id] = [];
        byCol[cell.column_id].push(cell);
      });
      setCellsByColumn(byCol);

      // items
      const cellIds = cells.map((x) => x.id);
      if (cellIds.length === 0) {
        setItemsByCell({});
        return;
      }

      const { data: itemData, error: iErr } = await supabase
        .from('items_v2')
        .select('id, household_id, cell_id, name, qty, expires_at, image_path')
        .eq('household_id', activeHouseholdId)
        .in('cell_id', cellIds)
        .order('name', { ascending: true });

      if (iErr) console.error(iErr);
      const items = (itemData as ItemV2[]) ?? [];

      const byCell: Record<UUID, ItemV2[]> = {};
      cellIds.forEach((id) => (byCell[id] = []));
      items.forEach((it) => {
        if (!byCell[it.cell_id]) byCell[it.cell_id] = [];
        byCell[it.cell_id].push(it);
      });
      setItemsByCell(byCell);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeHouseholdId) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHouseholdId, roomId]);

  const onRefresh = async () => {
    if (!activeHouseholdId) return;
    setRefreshing(true);
    try {
      await loadAll({ silent: true });
      setToast('已刷新');
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
    setToast('已切换 household');
    router.push('/rooms');
  };

  // derived maps
  const columnById = useMemo(() => {
    const m = new Map<UUID, Column>();
    columns.forEach((c) => m.set(c.id, c));
    return m;
  }, [columns]);

  const cellById = useMemo(() => {
    const m = new Map<UUID, Cell>();
    Object.values(cellsByColumn).forEach((arr) => arr.forEach((cell) => m.set(cell.id, cell)));
    return m;
  }, [cellsByColumn]);

  const cellToColumn = useMemo(() => {
    const m = new Map<UUID, Column>();
    Object.entries(cellsByColumn).forEach(([colId, arr]) => {
      const col = columnById.get(colId as UUID);
      if (!col) return;
      arr.forEach((cell) => m.set(cell.id, col));
    });
    return m;
  }, [cellsByColumn, columnById]);

  const allItemsFlat = useMemo(() => {
    const out: ItemV2[] = [];
    Object.values(itemsByCell).forEach((arr) => arr.forEach((it) => out.push(it)));
    return out;
  }, [itemsByCell]);

  const fuse = useMemo(() => {
    return new Fuse(allItemsFlat, {
      keys: ['name'],
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
  }, [allItemsFlat]);

  const matchedItemIds = useMemo(() => {
    const q = search.trim();
    if (!q) return new Set<string>();
    return new Set(fuse.search(q).slice(0, 400).map((r) => r.item.id));
  }, [search, fuse]);

  const expiring0to7 = useMemo(() => {
    return allItemsFlat
      .filter((it) => it.expires_at)
      .map((it) => ({ it, d: daysUntil((it.expires_at as string).slice(0, 10)) }))
      .filter(({ d }) => d >= 0 && d <= 7)
      .sort((a, b) => a.d - b.d)
      .map(({ it }) => it);
  }, [allItemsFlat]);

  const expiring8to30 = useMemo(() => {
    return allItemsFlat
      .filter((it) => it.expires_at)
      .map((it) => ({ it, d: daysUntil((it.expires_at as string).slice(0, 10)) }))
      .filter(({ d }) => d >= 8 && d <= 30)
      .sort((a, b) => a.d - b.d)
      .map(({ it }) => it);
  }, [allItemsFlat]);

  const shouldShowItem = (itemId: UUID) => {
    if (!search.trim()) return true;
    if (!onlyShowMatches) return true;
    return matchedItemIds.has(itemId);
  };

  // jump-to-cell
  const jumpToCell = (cellId: UUID) => {
    const el = document.getElementById(`cell-${cellId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightCellId(cellId);
      window.setTimeout(() => setHighlightCellId((cur) => (cur === cellId ? null : cur)), 1400);
    }
  };

  // column menu click-outside (simple)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!columnMenuOpenId) return;
      const target = e.target as Node | null;
      const menu = document.getElementById(`col-menu-${columnMenuOpenId}`);
      const btn = document.getElementById(`col-menu-btn-${columnMenuOpenId}`);
      if (!menu || !target) return;
      if (menu.contains(target)) return;
      if (btn && btn.contains(target)) return;
      setColumnMenuOpenId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [columnMenuOpenId]);

  // ----- columns CRUD -----
  const openAddColumn = () => {
    setColumnDraftName('');
    setAddColumnOpen(true);
  };

  const createColumn = async () => {
    const name = columnDraftName.trim();
    if (!name) return;

    const maxPos = Math.max(-1, ...columns.map((c) => c.position ?? 0));
    const position = (Number.isFinite(maxPos) ? maxPos : 0) + 1;

    const { error } = await supabase.from('room_columns').insert({ room_id: roomId, name, position });
    if (error) {
      console.error(error);
      setToast('新增 column 失败');
      return;
    }
    setAddColumnOpen(false);
    setToast('已新增 column');
    await loadAll({ silent: true });
  };

  const openEditColumn = (col: Column) => {
    setTargetColumnId(col.id);
    setColumnDraftName(col.name ?? '');
    setEditColumnOpen(true);
  };

  const saveEditColumn = async () => {
    if (!targetColumnId) return;
    const name = columnDraftName.trim();
    if (!name) return;

    const { error } = await supabase.from('room_columns').update({ name }).eq('id', targetColumnId);
    if (error) {
      console.error(error);
      setToast('更新 column 失败');
      return;
    }
    setEditColumnOpen(false);
    setTargetColumnId(null);
    setToast('已更新 column');
    await loadAll({ silent: true });
  };

  const openDeleteColumn = (colId: UUID) => {
    setTargetColumnId(colId);
    setDeleteColumnConfirmOpen(true);
  };

  const confirmDeleteColumn = async () => {
    if (!targetColumnId) return;
    const cells = cellsByColumn[targetColumnId] ?? [];
    const cellIds = cells.map((c) => c.id);
    const itemCount = cellIds.reduce((acc, cid) => acc + (itemsByCell[cid]?.length ?? 0), 0);

    const { error } = await supabase.from('room_columns').delete().eq('id', targetColumnId);
    if (error) {
      console.error(error);
      setToast('删除 column 失败');
      return;
    }
    setDeleteColumnConfirmOpen(false);
    setTargetColumnId(null);
    setToast(`已删除 column（影响 ${cells.length} cells / ${itemCount} items）`);
    await loadAll({ silent: true });
  };

  // ----- cells CRUD -----
  const openAddCell = (columnId: UUID) => {
    setCellParentColumnId(columnId);
    setCellDraftCode('');
    setAddCellOpen(true);
  };

  const createCell = async () => {
    if (!cellParentColumnId) return;
    const code = cellDraftCode.trim();
    if (!code) return;

    const existing = cellsByColumn[cellParentColumnId] ?? [];
    const maxPos = Math.max(-1, ...existing.map((c) => c.position ?? 0));
    const position = (Number.isFinite(maxPos) ? maxPos : 0) + 1;

    const { error } = await supabase.from('room_cells').insert({ column_id: cellParentColumnId, code, position });
    if (error) {
      console.error(error);
      setToast('新增 cell 失败');
      return;
    }
    setAddCellOpen(false);
    setCellParentColumnId(null);
    setToast('已新增 cell');
    await loadAll({ silent: true });
  };

  const openEditCell = (cell: Cell) => {
    setTargetCellId(cell.id);
    setCellDraftCode(cell.code ?? '');
    setEditCellOpen(true);
  };

  const saveEditCell = async () => {
    if (!targetCellId) return;
    const code = cellDraftCode.trim();
    if (!code) return;

    const { error } = await supabase.from('room_cells').update({ code }).eq('id', targetCellId);
    if (error) {
      console.error(error);
      setToast('更新 cell 失败');
      return;
    }
    setEditCellOpen(false);
    setTargetCellId(null);
    setToast('已更新 cell');
    await loadAll({ silent: true });
  };

  const openDeleteCell = (cellId: UUID) => {
    setTargetCellId(cellId);
    setDeleteCellConfirmOpen(true);
  };

  const confirmDeleteCell = async () => {
    if (!targetCellId) return;
    const itemCount = itemsByCell[targetCellId]?.length ?? 0;

    const { error } = await supabase.from('room_cells').delete().eq('id', targetCellId);
    if (error) {
      console.error(error);
      setToast('删除 cell 失败');
      return;
    }
    setDeleteCellConfirmOpen(false);
    setTargetCellId(null);
    setToast(`已删除 cell（影响 ${itemCount} items）`);
    await loadAll({ silent: true });
  };

  // ----- item helpers -----
  const getPublicImageUrl = (path: string | null) => {
    if (!path) return '';
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? '';
  };

  const ensureCellsForRoomLoaded = async (rid: UUID) => {
    if (cellsForRoomCache[rid]) return;

    setLoadingCellsForRoom(true);
    try {
      const { data: cols, error: cErr } = await supabase
        .from('room_columns')
        .select('id, room_id, name, position')
        .eq('room_id', rid)
        .order('position', { ascending: true });

      if (cErr) {
        console.error(cErr);
        return;
      }

      const columnsForRoom = (cols as Column[]) ?? [];
      const colIds = columnsForRoom.map((c) => c.id);
      if (colIds.length === 0) {
        setCellsForRoomCache((prev) => ({ ...prev, [rid]: [] }));
        return;
      }

      const { data: cells, error: cellErr } = await supabase
        .from('room_cells')
        .select('id, column_id, code, position')
        .in('column_id', colIds)
        .order('position', { ascending: true });

      if (cellErr) {
        console.error(cellErr);
        return;
      }

      const cellsList = (cells as Cell[]) ?? [];
      const colMap = new Map<UUID, Column>();
      columnsForRoom.forEach((c) => colMap.set(c.id, c));

      const pairs = cellsList
        .map((cell) => {
          const col = colMap.get(cell.column_id);
          if (!col) return null;
          return { cell, column: col };
        })
        .filter(Boolean) as Array<{ cell: Cell; column: Column }>;

      setCellsForRoomCache((prev) => ({ ...prev, [rid]: pairs }));
    } finally {
      setLoadingCellsForRoom(false);
    }
  };

  const openAddItem = async (cellId?: UUID) => {
    setItemMode('add');

    const defaultRoomId = room?.id ?? null;
    const defaultCellId = cellId ?? null;

    if (defaultRoomId) await ensureCellsForRoomLoaded(defaultRoomId);

    setItemDraft({
      id: null,
      name: '',
      qty: '',
      expires_at: '',
      imageFile: null,
      image_path: null,
      room_id: defaultRoomId,
      cell_id: defaultCellId,
    });

    setItemModalOpen(true);
    window.setTimeout(() => itemNameInputRef.current?.focus(), 50);
  };

  const openEditItem = async (item: ItemV2) => {
    setItemMode('edit');

    const currentRoomId = room?.id ?? null;
    if (currentRoomId) await ensureCellsForRoomLoaded(currentRoomId);

    setItemDraft({
      id: item.id,
      name: item.name ?? '',
      qty: item.qty === null || item.qty === undefined ? '' : String(item.qty),
      expires_at: toDateOnly(item.expires_at),
      imageFile: null,
      image_path: item.image_path ?? null,
      room_id: currentRoomId,
      cell_id: item.cell_id,
    });

    setItemModalOpen(true);
  };

  const openDeleteItem = (itemId: UUID) => {
    setTargetItemId(itemId);
    setItemDeleteConfirmOpen(true);
  };

  const confirmDeleteItem = async () => {
    if (!targetItemId) return;

    const { error } = await supabase.from('items_v2').delete().eq('id', targetItemId);
    if (error) {
      console.error(error);
      setToast('删除 item 失败');
      return;
    }
    setItemDeleteConfirmOpen(false);
    setTargetItemId(null);
    setToast('已删除 item');
    await loadAll({ silent: true });
  };

  const saveItem = async () => {
    const name = itemDraft.name.trim();
    if (!name) {
      setToast('Name 不能为空');
      return;
    }
    if (!activeHouseholdId) {
      setToast('未选择 household');
      return;
    }
    if (!itemDraft.cell_id) {
      setToast('请选择 location（cell）');
      return;
    }

    const qty = itemDraft.qty.trim() === '' ? null : Number(itemDraft.qty);
    if (qty !== null && (!Number.isFinite(qty) || qty < 0)) {
      setToast('Qty 不合法');
      return;
    }

    const expires_at = itemDraft.expires_at.trim() ? `${itemDraft.expires_at.trim()}T00:00:00.000Z` : null;

    let image_path = itemDraft.image_path ?? null;
    if (itemDraft.imageFile) {
      const file = itemDraft.imageFile;
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `${activeHouseholdId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, file, {
        cacheControl: '3600',
        upsert: true,
      });
      if (upErr) {
        console.error(upErr);
        setToast('图片上传失败');
        return;
      }
      image_path = fileName;
    }

    if (itemMode === 'add') {
      const { error } = await supabase.from('items_v2').insert({
        household_id: activeHouseholdId,
        cell_id: itemDraft.cell_id,
        name,
        qty,
        expires_at,
        image_path,
      });

      if (error) {
        console.error(error);
        setToast('新增 item 失败');
        return;
      }
      setItemModalOpen(false);
      setToast('已新增 item');
      await loadAll({ silent: true });
      return;
    }

    if (!itemDraft.id) return;

    const { error } = await supabase
      .from('items_v2')
      .update({
        cell_id: itemDraft.cell_id,
        name,
        qty,
        expires_at,
        image_path,
      })
      .eq('id', itemDraft.id);

    if (error) {
      console.error(error);
      setToast('更新 item 失败');
      return;
    }
    setItemModalOpen(false);
    setToast('已更新 item');
    await loadAll({ silent: true });
  };

  const renderLocationLabel = (cellId: UUID) => {
    const cell = cellById.get(cellId);
    const col = cellToColumn.get(cellId);
    const colName = col?.name ?? '';
    const cellName = cell?.code ?? '';
    if (!colName && !cellName) return null;

    return (
      <button
        type="button"
        onClick={() => jumpToCell(cellId)}
        className="text-xs px-2 py-1 rounded-lg border border-black/10 hover:bg-black/5"
        title="定位到该 cell"
      >
        {colName || 'Column'}{cellName ? ` / ${cellName}` : ''}
      </button>
    );
  };

  const ExpiringSection = ({ title, items }: { title: string; items: ItemV2[] }) => {
    if (items.length === 0) return null;

    return (
      <div className={cx('rounded-2xl border', THEME.borderSoft, THEME.oatCard)}>
        <div className="px-4 py-3 border-b border-black/10 flex items-center justify-between">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-black/60">{items.length} items</div>
        </div>

        <div className="p-3">
          <div className="flex flex-col gap-2">
            {items.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2">
                  <div className={cx('px-3 py-2 rounded-2xl border min-w-0', expiryChipClass(it.expires_at))}>
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm" style={fontNunito}>
                        {it.name}
                      </div>
                      {it.expires_at && (
                        <div className="text-[11px] text-black/70 whitespace-nowrap">
                          {formatExpiryLabel(it.expires_at)}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      {renderLocationLabel(it.cell_id)}
                      {it.qty !== null && it.qty !== undefined && (
                        <span className="text-xs text-black/70">× {it.qty}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <SmallIconButton title="Edit item" onClick={() => openEditItem(it)}>
                    ✏️
                  </SmallIconButton>
                  <SmallIconButton title="Delete item" onClick={() => openDeleteItem(it.id)} className="hover:bg-red-50">
                    🗑️
                  </SmallIconButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // room row: All rooms + Add column
  const RoomHeader = () => (
    <div className="mt-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xl font-semibold truncate">{room?.name ?? 'Room'}</div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm"
          onClick={() => router.push('/rooms')}
          title="All rooms"
        >
          All rooms
        </button>

        <button
          type="button"
          className={cx('px-3 py-2 rounded-xl border text-sm hover:bg-black/5', THEME.blueBorderSoft)}
          onClick={openAddColumn}
          title="Add column"
        >
          Add column
        </button>
      </div>
    </div>
  );

  return (
    <AuthGate>
      <div className={cx('min-h-screen', THEME.oatBg)}>
        <div className="max-w-[1400px] mx-auto px-4 py-5">
          <HouseholdTopBar
            householdName={activeHousehold?.name ?? 'Household'}
            userEmail={userEmail}
            refreshing={refreshing}
            onRefresh={onRefresh}
            onOpenSwitchHousehold={() => setSwitchHouseholdOpen(true)}
            onSignOut={onSignOut}
          />

          <RoomHeader />

          {/* Search + expiring */}
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className={cx('rounded-2xl border p-4', THEME.borderSoft, THEME.oatCard, 'lg:col-span-2')}>
              <div className="flex items-center gap-3">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search items (fuzzy)…"
                  className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
                />
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm"
                  onClick={() => setSearch('')}
                >
                  Clear
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={onlyShowMatches} onChange={(e) => setOnlyShowMatches(e.target.checked)} />
                  只显示匹配结果
                </label>

                {search.trim() && (
                  <div className="text-xs text-black/60">
                    匹配：{matchedItemIds.size} items
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <ExpiringSection title="Expiring (0–7d)" items={expiring0to7} />
              <ExpiringSection title="Expiring (8–30d)" items={expiring8to30} />
            </div>
          </div>

          {/* Columns */}
          <div className="mt-5">
            {loading ? (
              <div className="text-sm text-black/60 py-6">Loading room…</div>
            ) : (
              <div className="flex gap-4 overflow-x-auto pb-3">
                {columns.map((col) => {
                  const cells = cellsByColumn[col.id] ?? [];

                  return (
                    <div key={col.id} className={cx('min-w-[340px] max-w-[340px] rounded-2xl border', THEME.borderSoft, THEME.oatCard)}>
                      {/* Column header (left aligned, black) */}
                      <div className="px-4 py-3 border-b border-black/10 flex items-center justify-between gap-2">
                        <div className="text-base truncate" style={fontOswald}>
                          {col.name}
                        </div>

                        <div className="relative">
                          <button
                            id={`col-menu-btn-${col.id}`}
                            type="button"
                            className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-black/10 hover:bg-black/5 text-sm"
                            title="Column actions"
                            aria-label="Column actions"
                            onClick={() => setColumnMenuOpenId((v) => (v === col.id ? null : col.id))}
                          >
                            ⚙️
                          </button>

                          {columnMenuOpenId === col.id && (
                            <div
                              id={`col-menu-${col.id}`}
                              className="absolute right-0 mt-2 w-44 rounded-2xl border border-black/10 bg-white shadow-lg overflow-hidden z-[70]"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setColumnMenuOpenId(null);
                                  openAddCell(col.id);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-black/5"
                              >
                                ➕ Add cell
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setColumnMenuOpenId(null);
                                  openEditColumn(col);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-black/5"
                              >
                                ✏️ Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setColumnMenuOpenId(null);
                                  openDeleteColumn(col.id);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-700"
                              >
                                🗑️ Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Cells */}
                      <div className="p-3 flex flex-col gap-3">
                        {cells.length === 0 ? (
                          <div className="text-sm text-black/60 px-1">
                            No cells yet.
                            <button type="button" className="ml-2 underline text-black/80" onClick={() => openAddCell(col.id)}>
                              Add one
                            </button>
                          </div>
                        ) : (
                          cells.map((cell) => {
                            const items = itemsByCell[cell.id] ?? [];
                            const filteredItems = items.filter((it) => shouldShowItem(it.id));

                            return (
                              <div
                                key={cell.id}
                                id={`cell-${cell.id}`}
                                className={cx(
                                  'rounded-2xl border p-3',
                                  THEME.borderSoft,
                                  highlightCellId === cell.id && 'ring-2 ring-black/20'
                                )}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  {/* Cell name: Oswald, black, bold, item+2pt */}
                                  <div
                                    className="truncate font-bold"
                                    style={{ ...fontOswald, fontSize: '16px' }}
                                    title={cell.code}
                                  >
                                    {cell.code}
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <SmallIconButton title="Add item" onClick={() => openAddItem(cell.id)}>
                                      ➕
                                    </SmallIconButton>
                                    <SmallIconButton title="Edit cell" onClick={() => openEditCell(cell)}>
                                      ✏️
                                    </SmallIconButton>
                                    <SmallIconButton title="Delete cell" onClick={() => openDeleteCell(cell.id)} className="hover:bg-red-50">
                                      🗑️
                                    </SmallIconButton>
                                  </div>
                                </div>

                                {/* Items */}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {filteredItems.length === 0 ? (
                                    <div className="text-xs text-black/50">No items</div>
                                  ) : (
                                    filteredItems.map((it) => (
                                      <button
                                        key={it.id}
                                        type="button"
                                        onClick={() => openEditItem(it)}
                                        className={cx(
                                          'px-3 py-2 rounded-2xl border text-left hover:shadow-sm transition-shadow',
                                          expiryChipClass(it.expires_at)
                                        )}
                                        title="Click to edit"
                                      >
                                        <div className="flex items-center gap-2">
                                          <div className="text-sm truncate" style={fontNunito}>
                                            {it.name}
                                          </div>
                                          {it.qty !== null && it.qty !== undefined && (
                                            <div className="text-xs text-black/70">× {it.qty}</div>
                                          )}
                                          {it.expires_at && (
                                            <div className="text-[11px] text-black/70 whitespace-nowrap">
                                              {formatExpiryLabel(it.expires_at)}
                                            </div>
                                          )}
                                        </div>
                                      </button>
                                    ))
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Switch household modal */}
        <Modal open={switchHouseholdOpen} title="Switch household" onClose={() => setSwitchHouseholdOpen(false)} widthClass="max-w-lg">
          <div className="text-sm text-black/70">选择一个 household（会返回 All rooms）：</div>
          <div className="mt-3 flex flex-col gap-2">
            {households.map((h) => (
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
            ))}
          </div>
        </Modal>

        {/* Add/Edit Column */}
        <Modal open={addColumnOpen} title="Add column" onClose={() => setAddColumnOpen(false)} widthClass="max-w-lg">
          <div className="text-sm text-black/70">Column name</div>
          <input
            value={columnDraftName}
            onChange={(e) => setColumnDraftName(e.target.value)}
            className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
            placeholder="e.g., Pantry"
          />
          <div className="mt-5 flex items-center justify-end gap-2">
            <button className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm" onClick={() => setAddColumnOpen(false)}>
              Cancel
            </button>
            <button className="px-3 py-2 rounded-xl border border-black bg-black text-white hover:bg-black/90 text-sm" onClick={createColumn}>
              Create
            </button>
          </div>
        </Modal>

        <Modal open={editColumnOpen} title="Edit column" onClose={() => setEditColumnOpen(false)} widthClass="max-w-lg">
          <div className="text-sm text-black/70">Column name</div>
          <input
            value={columnDraftName}
            onChange={(e) => setColumnDraftName(e.target.value)}
            className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
          />
          <div className="mt-5 flex items-center justify-end gap-2">
            <button className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm" onClick={() => setEditColumnOpen(false)}>
              Cancel
            </button>
            <button className="px-3 py-2 rounded-xl border border-black bg-black text-white hover:bg-black/90 text-sm" onClick={saveEditColumn}>
              Save
            </button>
          </div>
        </Modal>

        <ConfirmModal
          open={deleteColumnConfirmOpen}
          title="Delete column?"
          description="删除 column 会同时删除其下所有 cells（以及这些 cells 的 items）。该操作不可撤销。"
          onCancel={() => {
            setDeleteColumnConfirmOpen(false);
            setTargetColumnId(null);
          }}
          onConfirm={confirmDeleteColumn}
        />

        {/* Add/Edit Cell */}
        <Modal open={addCellOpen} title="Add cell" onClose={() => setAddCellOpen(false)} widthClass="max-w-lg">
          <div className="text-sm text-black/70">Cell name</div>
          <input
            value={cellDraftCode}
            onChange={(e) => setCellDraftCode(e.target.value)}
            className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
            placeholder="e.g., A1"
          />
          <div className="mt-5 flex items-center justify-end gap-2">
            <button className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm" onClick={() => setAddCellOpen(false)}>
              Cancel
            </button>
            <button className="px-3 py-2 rounded-xl border border-black bg-black text-white hover:bg-black/90 text-sm" onClick={createCell}>
              Create
            </button>
          </div>
        </Modal>

        <Modal open={editCellOpen} title="Edit cell" onClose={() => setEditCellOpen(false)} widthClass="max-w-lg">
          <div className="text-sm text-black/70">Cell name</div>
          <input
            value={cellDraftCode}
            onChange={(e) => setCellDraftCode(e.target.value)}
            className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
          />
          <div className="mt-5 flex items-center justify-end gap-2">
            <button className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm" onClick={() => setEditCellOpen(false)}>
              Cancel
            </button>
            <button className="px-3 py-2 rounded-xl border border-black bg-black text-white hover:bg-black/90 text-sm" onClick={saveEditCell}>
              Save
            </button>
          </div>
        </Modal>

        <ConfirmModal
          open={deleteCellConfirmOpen}
          title="Delete cell?"
          description="删除 cell 会同时删除该 cell 的 items。该操作不可撤销。"
          onCancel={() => {
            setDeleteCellConfirmOpen(false);
            setTargetCellId(null);
          }}
          onConfirm={confirmDeleteCell}
        />

        {/* Item modal */}
        <Modal open={itemModalOpen} title={itemMode === 'add' ? 'Add item' : 'Edit item'} onClose={() => setItemModalOpen(false)} widthClass="max-w-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* left fields */}
            <div>
              <div className="text-sm text-black/70">Name</div>
              <input
                ref={itemNameInputRef}
                value={itemDraft.name}
                onChange={(e) => setItemDraft((p) => ({ ...p, name: e.target.value }))}
                className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
                placeholder="e.g., Milk"
              />

              <div className="mt-4 text-sm text-black/70">Qty</div>
              <input
                value={itemDraft.qty}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '' || /^[0-9]+$/.test(v)) {
                    setItemDraft((p) => ({ ...p, qty: v }));
                  }
                }}
                inputMode="numeric"
                className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
                placeholder="(optional)"
              />

              <div className="mt-4 text-sm text-black/70">Expires at</div>
              <input
                type="date"
                value={itemDraft.expires_at}
                onChange={(e) => setItemDraft((p) => ({ ...p, expires_at: e.target.value }))}
                className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
              />

              <div className="mt-4 text-sm text-black/70">Image</div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setItemDraft((p) => ({ ...p, imageFile: f }));
                }}
                className="mt-2 w-full text-sm"
              />

              {itemDraft.image_path && (
                <div className="mt-3">
                  <div className="text-xs text-black/60 mb-2">Current image</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getPublicImageUrl(itemDraft.image_path)}
                    alt="item"
                    className="w-full max-w-[260px] rounded-2xl border border-black/10"
                  />
                </div>
              )}
            </div>

            {/* right location */}
            <div>
              <div className="text-sm text-black/70">Location</div>

              <div className="mt-2 text-xs text-black/60">Room</div>
              <select
                value={itemDraft.room_id ?? ''}
                onChange={async (e) => {
                  const rid = (e.target.value || null) as UUID | null;
                  setItemDraft((p) => ({ ...p, room_id: rid, cell_id: null }));
                  if (rid) await ensureCellsForRoomLoaded(rid);
                }}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
              >
                <option value="">Select room…</option>
                {roomsInHousehold.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>

              <div className="mt-3 text-xs text-black/60">Cell</div>
              <select
                value={itemDraft.cell_id ?? ''}
                onChange={(e) => setItemDraft((p) => ({ ...p, cell_id: (e.target.value || null) as UUID | null }))}
                disabled={!itemDraft.room_id || loadingCellsForRoom}
                className={cx(
                  'mt-1 w-full px-3 py-2 rounded-xl border bg-white text-sm outline-none focus:ring-2 focus:ring-black/10',
                  'border-black/10',
                  (!itemDraft.room_id || loadingCellsForRoom) && 'opacity-60'
                )}
              >
                <option value="">{loadingCellsForRoom ? 'Loading cells…' : 'Select cell…'}</option>
                {(itemDraft.room_id ? (cellsForRoomCache[itemDraft.room_id] ?? []) : []).map(({ cell, column }) => (
                  <option key={cell.id} value={cell.id}>
                    {column.name} / {cell.code}
                  </option>
                ))}
              </select>

              <div className="mt-6 rounded-2xl border border-black/10 bg-white p-3">
                <div className="text-xs text-black/60">Tip</div>
                <div className="text-sm text-black/80 mt-1">也可以在 cell 右上角 ➕ 直接添加 item（更快）。</div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-2">
            <div>
              {itemMode === 'edit' && itemDraft.id && (
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl border border-red-600 text-red-700 hover:bg-red-50 text-sm"
                  onClick={() => openDeleteItem(itemDraft.id as UUID)}
                >
                  Delete
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm" onClick={() => setItemModalOpen(false)}>
                Cancel
              </button>
              <button className="px-3 py-2 rounded-xl border border-black bg-black text-white hover:bg-black/90 text-sm" onClick={saveItem}>
                Save
              </button>
            </div>
          </div>
        </Modal>

        <ConfirmModal
          open={itemDeleteConfirmOpen}
          title="Delete item?"
          description="确定删除该 item 吗？该操作不可撤销。"
          onCancel={() => {
            setItemDeleteConfirmOpen(false);
            setTargetItemId(null);
          }}
          onConfirm={confirmDeleteItem}
        />

        {toast && <Toast message={toast} />}
      </div>
    </AuthGate>
  );
}
