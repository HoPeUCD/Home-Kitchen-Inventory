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
  remark: string | null;
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
  if (d < 0) return 'bg-red-500/20 border border-red-500/30'; // Expired: red
  if (d <= 30) return 'bg-yellow-500/20 border border-yellow-500/30'; // Within 30 days: yellow
  return 'bg-white border border-black/10'; // Others: no background
}
function formatExpiryLabel(expires_at: string | null) {
  if (!expires_at) return '';
  const dateOnly = expires_at.slice(0, 10);
  const d = daysUntil(dateOnly);
  // Only show expiry info for items within 30 days
  if (d < 0) return `Expired ${Math.abs(d)}d ago`;
  if (d === 0) return 'Expires today';
  if (d <= 30) return `${d}d`;
  return ''; // Don't show for items expiring after 30 days
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
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative min-h-full flex items-center justify-center p-4">
        <div className={cx('relative w-full my-auto z-10', widthClass)} onClick={(e) => e.stopPropagation()}>
          <div className={cx('rounded-2xl shadow-xl border flex flex-col max-h-[90vh]', THEME.borderSoft, THEME.oatCard)}>
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

function ConfirmModal({
  open,
  title,
  description,
  confirmText = 'Delete',
  cancelText = 'Cancel',
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
  
  // All items from all households for search
  const [allHouseholdItems, setAllHouseholdItems] = useState<ItemV2[]>([]);
  // All rooms from all households (for search results)
  const [allHouseholdRooms, setAllHouseholdRooms] = useState<Room[]>([]);
  // All columns from all households (for search results)
  const [allHouseholdColumns, setAllHouseholdColumns] = useState<Column[]>([]);
  // All cells from all households (for search results)
  const [allHouseholdCells, setAllHouseholdCells] = useState<Cell[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [toast, setToast] = useState('');

  // Search
  const [search, setSearch] = useState('');
  const [onlyShowMatches, setOnlyShowMatches] = useState(false);

  // highlight for jump-to-cell
  const [highlightCellId, setHighlightCellId] = useState<UUID | null>(null);

  // switch household modal
  const [switchHouseholdOpen, setSwitchHouseholdOpen] = useState(false);

  // Batch selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<UUID>>(new Set());
  const [moveToLocationModalOpen, setMoveToLocationModalOpen] = useState(false);
  const [batchMoveTargetCellId, setBatchMoveTargetCellId] = useState<UUID | null>(null);

  // Column menu + modals
  const [columnMenuOpenId, setColumnMenuOpenId] = useState<UUID | null>(null);
  
  // Cell menu + modals
  const [cellMenuOpenId, setCellMenuOpenId] = useState<UUID | null>(null);
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
  const [currentImageUrl, setCurrentImageUrl] = useState<string>('');

  const [itemDraft, setItemDraft] = useState<{
    id: UUID | null;
    name: string;
    qty: string; // IMPORTANT: string => fixes "0 stuck / 02"
    expires_at: string; // yyyy-mm-dd
    imageFile: File | null;
    image_path: string | null;
    room_id: UUID | null;
    cell_id: UUID | null;
    remark: string;
  }>({
    id: null,
    name: '',
    qty: '',
    expires_at: '',
    imageFile: null,
    image_path: null,
    room_id: null,
    cell_id: null,
    remark: '',
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

      // Load all items, rooms, columns, and cells from all households for search
      if (dedup.length > 0) {
        const householdIds = dedup.map((h) => h.id);
        
        // Load all items
        const { data: allItemsData, error: itemsErr } = await supabase
          .from('items_v2')
          .select('id, household_id, cell_id, name, qty, expires_at, image_path, remark')
          .in('household_id', householdIds);

        if (!itemsErr && allItemsData) {
          setAllHouseholdItems(allItemsData as ItemV2[]);
        }

        // Load all rooms
        const { data: allRoomsData, error: roomsErr } = await supabase
          .from('rooms')
          .select('id, household_id, name, position')
          .in('household_id', householdIds);

        if (!roomsErr && allRoomsData) {
          setAllHouseholdRooms(allRoomsData as Room[]);
        }

        // Load all columns (via rooms)
        if (allRoomsData && allRoomsData.length > 0) {
          const roomIds = allRoomsData.map((r: any) => r.id);
          const { data: allColumnsData, error: colsErr } = await supabase
            .from('room_columns')
            .select('id, room_id, name, position')
            .in('room_id', roomIds);

          if (!colsErr && allColumnsData) {
            setAllHouseholdColumns(allColumnsData as Column[]);
          }

          // Load all cells (need to get column IDs first)
          if (allColumnsData && allColumnsData.length > 0) {
            const colIds = allColumnsData.map((c: any) => c.id);
            const { data: allCellsData, error: cellsErr } = await supabase
              .from('room_cells')
              .select('id, column_id, code, position')
              .in('column_id', colIds);

            if (!cellsErr && allCellsData) {
              setAllHouseholdCells(allCellsData as Cell[]);
            }
          }
        }
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
      // First, load the current room to check its household_id
      const { data: roomData, error: roomErr } = await supabase
        .from('rooms')
        .select('id, household_id, name, position')
        .eq('id', roomId)
        .maybeSingle();

      if (roomErr) {
        console.error(roomErr);
        if (!silent) setLoading(false);
        return;
      }

      const currentRoom = (roomData as Room) ?? null;
      setRoom(currentRoom);

      // Determine the correct household_id: use room's household_id if available, otherwise use activeHouseholdId
      let effectiveHouseholdId = activeHouseholdId;
      if (currentRoom?.household_id) {
        effectiveHouseholdId = currentRoom.household_id;
        // If it differs, update state and localStorage
        if (currentRoom.household_id !== activeHouseholdId) {
          setActiveHouseholdId(currentRoom.household_id);
          window.localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, currentRoom.household_id);
        }
      }

      if (!effectiveHouseholdId) {
        if (!silent) setLoading(false);
        return;
      }

      // rooms for location selector (use effectiveHouseholdId)
      const { data: roomsData, error: roomsErr } = await supabase
        .from('rooms')
        .select('id, household_id, name, position')
        .eq('household_id', effectiveHouseholdId)
        .order('position', { ascending: true });

      if (roomsErr) console.error(roomsErr);
      setRoomsInHousehold((roomsData as Room[]) ?? []);

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
        .select('id, household_id, cell_id, name, qty, expires_at, image_path, remark')
        .eq('household_id', effectiveHouseholdId)
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
      await refreshSearchItems();
      setToast('Refreshed');
    } finally {
      setRefreshing(false);
    }
  };

  const onSignOut = async () => {
    try {
      localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
    } catch {}
    await supabase.auth.signOut();
    router.refresh();
  };

  const doSwitchHousehold = (hid: UUID) => {
    window.localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, hid);
    setSwitchHouseholdOpen(false);
    // Force full page reload to ensure /rooms page reads the updated localStorage
    window.location.href = '/rooms';
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

  // Maps for search results (using all household data)
  const allColumnById = useMemo(() => {
    const m = new Map<UUID, Column>();
    allHouseholdColumns.forEach((c) => m.set(c.id, c));
    return m;
  }, [allHouseholdColumns]);

  const allCellById = useMemo(() => {
    const m = new Map<UUID, Cell>();
    allHouseholdCells.forEach((c) => m.set(c.id, c));
    return m;
  }, [allHouseholdCells]);

  const allColumnToRoom = useMemo(() => {
    const m = new Map<UUID, Room>();
    allHouseholdColumns.forEach((col) => {
      const room = allHouseholdRooms.find((r) => r.id === col.room_id);
      if (room) m.set(col.id, room);
    });
    return m;
  }, [allHouseholdColumns, allHouseholdRooms]);

  const allCellToColumn = useMemo(() => {
    const m = new Map<UUID, Column>();
    allHouseholdCells.forEach((cell) => {
      const col = allColumnById.get(cell.column_id);
      if (col) m.set(cell.id, col);
    });
    return m;
  }, [allHouseholdCells, allColumnById]);

  // Items in current room (for display in cells)
  const allItemsFlat = useMemo(() => {
    const out: ItemV2[] = [];
    Object.values(itemsByCell).forEach((arr) => arr.forEach((it) => out.push(it)));
    return out;
  }, [itemsByCell]);

  // Use all household items for search (across all households the user is in)
  const fuse = useMemo(() => {
    return new Fuse(allHouseholdItems, {
      keys: ['name', 'remark'],
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 2,
      includeMatches: true, // Include match information for highlighting
    });
  }, [allHouseholdItems]);
  
  // Search results from all households (with match info)
  const searchResultsWithMatch = useMemo(() => {
    const q = search.trim();
    if (!q || q.length < 2) return [];
    return fuse.search(q).slice(0, 100);
  }, [search, fuse]);

  const searchResults = useMemo(() => {
    return searchResultsWithMatch.map((r) => r.item);
  }, [searchResultsWithMatch]);

  // Matched item IDs from search (for filtering cells)
  const matchedItemIds = useMemo(() => {
    return new Set(searchResults.map((item) => item.id));
  }, [searchResults]);

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
    // If no search query, show all items
    if (!search.trim()) return true;
    // If "only show matches" is not checked, show all items
    if (!onlyShowMatches) return true;
    // Otherwise, only show matched items
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

  // cell menu click-outside (simple)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!cellMenuOpenId) return;
      const target = e.target as Node | null;
      const menu = document.getElementById(`cell-menu-${cellMenuOpenId}`);
      const btn = document.getElementById(`cell-menu-btn-${cellMenuOpenId}`);
      if (!menu || !target) return;
      if (menu.contains(target)) return;
      if (btn && btn.contains(target)) return;
      setCellMenuOpenId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [cellMenuOpenId]);

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
      setToast('Failed to create column');
      return;
    }
    setAddColumnOpen(false);
    setToast('Column created');
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
      setToast('Failed to update column');
      return;
    }
    setEditColumnOpen(false);
    setTargetColumnId(null);
    setToast('Column updated');
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
      setToast('Failed to delete column');
      return;
    }
    setDeleteColumnConfirmOpen(false);
    setTargetColumnId(null);
    setToast(`Column deleted (affected ${cells.length} cells / ${itemCount} items)`);
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
      setToast('Failed to create cell');
      return;
    }
    setAddCellOpen(false);
    setCellParentColumnId(null);
    setToast('Cell created');
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
      setToast('Failed to update cell');
      return;
    }
    setEditCellOpen(false);
    setTargetCellId(null);
    setToast('Cell updated');
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
      setToast('Failed to delete cell');
      return;
    }
    setDeleteCellConfirmOpen(false);
    setTargetCellId(null);
    setToast(`Cell deleted (affected ${itemCount} items)`);
    await loadAll({ silent: true });
  };

  // ----- item helpers -----
  const getPublicImageUrl = (path: string | null) => {
    if (!path) return '';
    // For public buckets, getPublicUrl works directly
    // If bucket is private, this will need to be changed to createSignedUrl
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? '';
  };

  // Refresh search items list (all items, rooms, columns, cells from all households)
  const refreshSearchItems = async () => {
    if (households.length === 0) return;
    const householdIds = households.map((h) => h.id);
    
    // Load all items
    const { data: allItemsData } = await supabase
      .from('items_v2')
      .select('id, household_id, cell_id, name, qty, expires_at, image_path, remark')
      .in('household_id', householdIds);
    if (allItemsData) setAllHouseholdItems(allItemsData as ItemV2[]);

    // Load all rooms
    const { data: allRoomsData } = await supabase
      .from('rooms')
      .select('id, household_id, name, position')
      .in('household_id', householdIds);
    if (allRoomsData) setAllHouseholdRooms(allRoomsData as Room[]);

    // Load all columns
    if (allRoomsData && allRoomsData.length > 0) {
      const roomIds = allRoomsData.map((r: any) => r.id);
      const { data: allColumnsData } = await supabase
        .from('room_columns')
        .select('id, room_id, name, position')
        .in('room_id', roomIds);
      if (allColumnsData) setAllHouseholdColumns(allColumnsData as Column[]);

      // Load all cells
      if (allColumnsData && allColumnsData.length > 0) {
        const colIds = allColumnsData.map((c: any) => c.id);
        const { data: allCellsData } = await supabase
          .from('room_cells')
          .select('id, column_id, code, position')
          .in('column_id', colIds);
        if (allCellsData) setAllHouseholdCells(allCellsData as Cell[]);
      }
    }
  };

  // Get signed URL for images (works for both public and private buckets)
  const getImageUrl = async (path: string | null): Promise<string> => {
    if (!path) return '';
    try {
      // Try signed URL first (works for private buckets)
      const { data: signedData, error: signedError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(path, 3600); // 1 hour expiry
      
      if (!signedError && signedData?.signedUrl) {
        return signedData.signedUrl;
      }
      
      // Fallback to public URL
      const { data: publicData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      return publicData?.publicUrl ?? '';
    } catch (error) {
      console.error('Error getting image URL:', error);
      // Fallback to public URL
      const { data: publicData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      return publicData?.publicUrl ?? '';
    }
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
      qty: '1', // Default to 1 (required)
      expires_at: '',
      imageFile: null,
      image_path: null,
      room_id: defaultRoomId,
      cell_id: defaultCellId,
      remark: '',
    });

    setCurrentImageUrl(''); // Reset image URL for new item

    setItemModalOpen(true);
    window.setTimeout(() => itemNameInputRef.current?.focus(), 50);
  };

  const openEditItem = async (item: ItemV2) => {
    setItemMode('edit');

    const currentRoomId = room?.id ?? null;
    if (currentRoomId) await ensureCellsForRoomLoaded(currentRoomId);

    const imagePath = item.image_path ?? null;
    setItemDraft({
      id: item.id,
      name: item.name ?? '',
      qty: item.qty === null || item.qty === undefined ? '1' : String(item.qty), // Default to 1 if empty
      expires_at: toDateOnly(item.expires_at),
      imageFile: null,
      image_path: imagePath,
      room_id: currentRoomId,
      cell_id: item.cell_id,
      remark: item.remark ?? '',
    });

    // Load image URL asynchronously
    if (imagePath) {
      const url = await getImageUrl(imagePath);
      setCurrentImageUrl(url);
    } else {
      setCurrentImageUrl('');
    }

    setItemModalOpen(true);
  };

  const deleteItem = async (itemId: UUID) => {
    const { error } = await supabase.from('items_v2').delete().eq('id', itemId);
    if (error) {
      console.error(error);
      setToast('Failed to delete item');
      return;
    }
    setToast('Item deleted');
    await loadAll({ silent: true });
    await refreshSearchItems();
  };

  const batchDeleteItems = async () => {
    if (selectedItemIds.size === 0) return;
    
    const itemIdsArray = Array.from(selectedItemIds);
    const { error } = await supabase
      .from('items_v2')
      .delete()
      .in('id', itemIdsArray);
    
    if (error) {
      console.error(error);
      setToast(`Failed to delete ${itemIdsArray.length} item(s)`);
      return;
    }
    
    setToast(`${itemIdsArray.length} item(s) deleted`);
    setSelectedItemIds(new Set());
    setSelectionMode(false);
    await loadAll({ silent: true });
    await refreshSearchItems();
  };

  const batchMoveItems = async () => {
    if (selectedItemIds.size === 0 || !batchMoveTargetCellId) return;
    
    const itemIdsArray = Array.from(selectedItemIds);
    const { error } = await supabase
      .from('items_v2')
      .update({ cell_id: batchMoveTargetCellId })
      .in('id', itemIdsArray);
    
    if (error) {
      console.error(error);
      setToast(`Failed to move ${itemIdsArray.length} item(s)`);
      return;
    }
    
    setToast(`${itemIdsArray.length} item(s) moved`);
    setSelectedItemIds(new Set());
    setSelectionMode(false);
    setMoveToLocationModalOpen(false);
    setBatchMoveTargetCellId(null);
    await loadAll({ silent: true });
    await refreshSearchItems();
  };

  const saveItem = async () => {
    if (savingItem) return; // Prevent multiple clicks
    
    const name = itemDraft.name.trim();
    if (!name) {
      setToast('Name cannot be empty');
      return;
    }
    if (!activeHouseholdId) {
      setToast('No household selected');
      return;
    }
    if (!itemDraft.cell_id) {
      setToast('Please select a location (cell)');
      return;
    }

    // qty is required, default to 1
    const qtyStr = itemDraft.qty.trim();
    if (!qtyStr) {
      setToast('Quantity cannot be empty');
      return;
    }
    const qty = Number(qtyStr);
    if (!Number.isFinite(qty) || qty < 1) {
      setToast('Quantity must be a number greater than or equal to 1');
      return;
    }

    setSavingItem(true);
    
    try {

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
        setToast('Failed to upload image');
        setSavingItem(false);
        return;
      }
      image_path = fileName;
    }

    const remark = itemDraft.remark.trim() || null;

    if (itemMode === 'add') {
      const { error } = await supabase.from('items_v2').insert({
        household_id: activeHouseholdId,
        cell_id: itemDraft.cell_id,
        name,
        qty: qty, // Required, always a number >= 1
        expires_at,
        image_path,
        remark,
      });

      if (error) {
        console.error(error);
        setToast('Failed to create item');
        setSavingItem(false);
        return;
      }
      setItemModalOpen(false);
      setToast('Item created');
      await loadAll({ silent: true });
      await refreshSearchItems();
      setSavingItem(false);
      return;
    }

    if (!itemDraft.id) {
      setSavingItem(false);
      return;
    }

    const { error } = await supabase
      .from('items_v2')
      .update({
        cell_id: itemDraft.cell_id,
        name,
        qty,
        expires_at,
        image_path,
        remark,
      })
      .eq('id', itemDraft.id);

    if (error) {
      console.error(error);
      setToast('Failed to update item');
      setSavingItem(false);
      return;
    }
    setItemModalOpen(false);
    setToast('Item updated');
    await loadAll({ silent: true });
    await refreshSearchItems();
    setSavingItem(false);
    } catch (e) {
      console.error('Error saving item:', e);
      setToast('Failed to save item');
      setSavingItem(false);
    }
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
        title="Jump to cell"
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
            {items.map((it) => {
              const expiryLabel = formatExpiryLabel(it.expires_at);
              const cell = cellById.get(it.cell_id);
              const col = cellToColumn.get(it.cell_id);
              const locationText = col?.name && cell?.code ? `${col.name} / ${cell.code}` : cell?.code || col?.name || '';
              
              return (
                <div
                  key={it.id}
                  className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg hover:bg-black/5 cursor-pointer"
                  onClick={() => {
                    // Jump to cell and highlight
                    jumpToCell(it.cell_id);
                    // Focus on the item in the cell after a short delay
                    setTimeout(() => {
                      const itemEl = document.querySelector(`[data-item-id="${it.id}"]`);
                      if (itemEl) {
                        itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        // Add a highlight effect
                        itemEl.classList.add('ring-2', 'ring-blue-500/50');
                        setTimeout(() => {
                          itemEl.classList.remove('ring-2', 'ring-blue-500/50');
                        }, 2000);
                      }
                    }, 600);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm truncate" style={fontNunito}>
                        {it.name}
                      </span>
                      {it.qty !== null && it.qty !== undefined && (
                        <span className="text-xs text-black/70">× {it.qty}</span>
                      )}
                      {expiryLabel && (
                        <span className="text-xs text-black/70 whitespace-nowrap">{expiryLabel}</span>
                      )}
                      {locationText && (
                        <span className="text-xs text-black/60 whitespace-nowrap">· {locationText}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <SmallIconButton title="Edit item" onClick={() => openEditItem(it)}>
                      ✏️
                    </SmallIconButton>
                    <SmallIconButton title="Delete item" onClick={() => deleteItem(it.id)} className="hover:bg-red-50">
                      🗑️
                    </SmallIconButton>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // room row: Room name with All rooms button + Add column
  const RoomHeader = () => (
    <div className="mt-4 flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2">
        <div className="text-xl font-semibold truncate">{room?.name ?? 'Room'}</div>
        <button
          type="button"
          className={cx(
            'px-2 py-1 rounded-lg border text-sm hover:bg-black/5 flex items-center gap-1',
            'border-black/10'
          )}
          onClick={() => {
            // Use the current room's household_id to ensure we stay in the same household
            const householdIdToUse = room?.household_id || activeHouseholdId;
            if (householdIdToUse) {
              window.localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, householdIdToUse);
              // Update state immediately to ensure consistency
              setActiveHouseholdId(householdIdToUse);
            }
            router.push('/rooms');
          }}
          title="All rooms"
        >
          <span>All rooms</span>
          <span className="text-xs text-black/60">▾</span>
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

          {/* Batch actions bar */}
          {selectionMode && selectedItemIds.size > 0 && (
            <div className="mt-3 px-4 py-3 rounded-xl border border-blue-200 bg-blue-50 flex items-center justify-between gap-3">
              <div className="text-sm text-blue-900 font-medium">
                {selectedItemIds.size} item{selectedItemIds.size > 1 ? 's' : ''} selected
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMoveToLocationModalOpen(true)}
                  className="px-3 py-1.5 rounded-lg border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 text-sm"
                >
                  Move to location
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm(`Are you sure you want to delete ${selectedItemIds.size} item(s)?`)) {
                      await batchDeleteItems();
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg border border-red-600 bg-red-600 text-white hover:bg-red-700 text-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          )}

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
                <label className="flex items-center gap-2 text-sm" title="When enabled, only matched items are shown in cells below">
                  <input type="checkbox" checked={onlyShowMatches} onChange={(e) => setOnlyShowMatches(e.target.checked)} />
                  Hide unmatched items in cells
                </label>

                {search.trim() && (
                  <div className="text-xs text-black/60">
                    Found: {searchResults.length} items
                  </div>
                )}
              </div>

              {/* Search results list */}
              {search.trim() && searchResults.length > 0 && (
                <div className="mt-3 pt-3 border-t border-black/10">
                  <div className="flex flex-col gap-2">
                    {searchResultsWithMatch.map((searchResult) => {
                      const item = searchResult.item;
                      // Check if match is in remark field
                      // Fuse.js match structure: { key: string | string[], indices: number[][] }
                      const matchedInRemark = searchResult.matches?.some(match => {
                        if (!match.key) return false;
                        // Handle both string and array keys
                        const keyStr = typeof match.key === 'string' ? match.key : (Array.isArray(match.key) ? match.key.join('.') : '');
                        const isRemarkMatch = keyStr === 'remark' || keyStr.includes('remark');
                        return isRemarkMatch;
                      });
                      
                      // Get remark match indices for highlighting
                      const remarkMatch = searchResult.matches?.find(match => {
                        if (!match.key) return false;
                        const keyStr = typeof match.key === 'string' ? match.key : (Array.isArray(match.key) ? match.key.join('.') : '');
                        return keyStr === 'remark' || keyStr.includes('remark');
                      });
                      
                      // Helper to highlight matched text in remark
                      // Fuse.js indices are [start, end] pairs
                      const highlightRemark = (text: string) => {
                        if (!remarkMatch?.indices || !text) return text;
                        
                        const parts: (string | JSX.Element)[] = [];
                        let lastIndex = 0;
                        
                        // Sort ranges by start position
                        const ranges = remarkMatch.indices
                          .map(([start, end]) => [Math.max(0, start), Math.min(text.length - 1, end)])
                          .sort((a, b) => (a[0] as number) - (b[0] as number));
                        
                        ranges.forEach(([start, end], idx) => {
                          const startIdx = start as number;
                          const endIdx = end as number;
                          
                          if (startIdx >= lastIndex && startIdx < text.length) {
                            // Add text before match
                            if (startIdx > lastIndex) {
                              parts.push(text.slice(lastIndex, startIdx));
                            }
                            // Add highlighted match
                            parts.push(
                              <span key={`match-${idx}`} className="bg-yellow-200 font-semibold">
                                {text.slice(startIdx, endIdx + 1)}
                              </span>
                            );
                            lastIndex = endIdx + 1;
                          }
                        });
                        
                        // Add remaining text
                        if (lastIndex < text.length) {
                          parts.push(text.slice(lastIndex));
                        }
                        
                        return parts.length > 0 ? <>{parts}</> : text;
                      };
                      
                      const household = households.find((h) => h.id === item.household_id);
                      // Use all household data for search results
                      const cell = allCellById.get(item.cell_id) || cellById.get(item.cell_id);
                      const col = allCellToColumn.get(item.cell_id) || cellToColumn.get(item.cell_id);
                      const room = col ? (allColumnToRoom.get(col.id) || (col.room_id ? roomsInHousehold.find((r) => r.id === col.room_id) : null)) : null;
                      const isInCurrentRoom = !!cellById.get(item.cell_id) && !!cellToColumn.get(item.cell_id);
                      
                      // Build location text: only show room if not current room, always show column / cell
                      let locationParts: string[] = [];
                      const isCurrentRoom = room && room.id === roomId;
                      if (room && !isCurrentRoom) locationParts.push(room.name);
                      if (col) locationParts.push(col.name);
                      if (cell) locationParts.push(cell.code);
                      const locationText = locationParts.join(' / ');
                      
                      // Only show household name if it's different from current active household
                      const isCurrentHousehold = household && household.id === activeHouseholdId;
                      
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-black/5 cursor-pointer"
                          onClick={() => {
                            if (isInCurrentRoom) {
                              jumpToCell(item.cell_id);
                              setTimeout(() => {
                                const itemEl = document.querySelector(`[data-item-id="${item.id}"]`);
                                if (itemEl) {
                                  itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  itemEl.classList.add('ring-2', 'ring-blue-500/50');
                                  setTimeout(() => {
                                    itemEl.classList.remove('ring-2', 'ring-blue-500/50');
                                  }, 2000);
                                }
                              }, 600);
                            }
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm truncate" style={fontNunito}>
                                  {item.name}
                                </span>
                                {item.qty !== null && item.qty !== undefined && (
                                  <span className="text-xs text-black/70">× {item.qty}</span>
                                )}
                                {household && !isCurrentHousehold && (
                                  <span className="text-xs text-black/60 whitespace-nowrap">· {household.name}</span>
                                )}
                                {locationText && (
                                  <span className="text-xs text-black/60 whitespace-nowrap">· {locationText}</span>
                                )}
                              </div>
                              {matchedInRemark && item.remark && (
                                <div className="text-xs text-black/60 italic">
                                  {highlightRemark(item.remark)}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {search.trim() && searchResults.length === 0 && (
                <div className="mt-3 pt-3 border-t border-black/10 text-sm text-black/60">
                  No items found
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <ExpiringSection title="Expiring (0–7d)" items={expiring0to7} />
              <ExpiringSection title="Expiring (8–30d)" items={expiring8to30} />
            </div>
          </div>

          {/* Action buttons below search and expiring */}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectionMode(!selectionMode);
                if (selectionMode) {
                  setSelectedItemIds(new Set());
                }
              }}
              className={cx(
                "px-3 py-2 rounded-xl border text-sm",
                selectionMode 
                  ? "border-blue-600/30 bg-blue-50 text-blue-700 hover:bg-blue-100" 
                  : "border-black/10 hover:bg-black/5"
              )}
            >
              {selectionMode ? `Cancel (${selectedItemIds.size} selected)` : 'Select items'}
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
                        <div className="text-base text-black truncate" style={fontOswald}>
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
                                    className="truncate font-bold text-black"
                                    style={{ ...fontOswald, fontSize: '16px' }}
                                    title={cell.code}
                                  >
                                    {cell.code}
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <SmallIconButton title="Add item" onClick={() => openAddItem(cell.id)}>
                                      ➕
                                    </SmallIconButton>
                                    
                                    <div className="relative">
                                      <button
                                        id={`cell-menu-btn-${cell.id}`}
                                        type="button"
                                        className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-black/10 hover:bg-black/5 text-sm"
                                        title="Cell actions"
                                        aria-label="Cell actions"
                                        onClick={() => setCellMenuOpenId((v) => (v === cell.id ? null : cell.id))}
                                      >
                                        ⚙️
                                      </button>

                                      {cellMenuOpenId === cell.id && (
                                        <div
                                          id={`cell-menu-${cell.id}`}
                                          className="absolute right-0 mt-2 w-44 rounded-2xl border border-black/10 bg-white shadow-lg overflow-hidden z-[70]"
                                        >
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setCellMenuOpenId(null);
                                              openEditCell(cell);
                                            }}
                                            className="w-full text-left px-3 py-2 text-sm hover:bg-black/5"
                                          >
                                            ✏️ Edit
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setCellMenuOpenId(null);
                                              openDeleteCell(cell.id);
                                            }}
                                            className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-700"
                                          >
                                            🗑️ Delete
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Items */}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {filteredItems.length === 0 ? (
                                    <div className="text-xs text-black/50">No items</div>
                                  ) : (
                                    (() => {
                                      // Sort items: expired first, then 30 days or less, then others
                                      const sorted = [...filteredItems].sort((a, b) => {
                                        const aExp = a.expires_at ? daysUntil(a.expires_at.slice(0, 10)) : Infinity;
                                        const bExp = b.expires_at ? daysUntil(b.expires_at.slice(0, 10)) : Infinity;
                                        
                                        // Expired items first (negative days)
                                        if (aExp < 0 && bExp >= 0) return -1;
                                        if (aExp >= 0 && bExp < 0) return 1;
                                        
                                        // Both expired: sort by how expired (more expired first)
                                        if (aExp < 0 && bExp < 0) return aExp - bExp;
                                        
                                        // 30 days or less: sort by days (sooner first)
                                        if (aExp <= 30 && bExp <= 30) return aExp - bExp;
                                        
                                        // One is 30 days or less, other is more: 30 days or less comes first
                                        if (aExp <= 30 && bExp > 30) return -1;
                                        if (aExp > 30 && bExp <= 30) return 1;
                                        
                                        // Both more than 30 days: keep original order
                                        return 0;
                                      });
                                      
                                      return sorted.map((it) => (
                                        <div key={it.id} className="flex items-center gap-2">
                                          {selectionMode && (
                                            <input
                                              type="checkbox"
                                              checked={selectedItemIds.has(it.id)}
                                              onChange={(e) => {
                                                e.stopPropagation();
                                                setSelectedItemIds((prev) => {
                                                  const next = new Set(prev);
                                                  if (e.target.checked) {
                                                    next.add(it.id);
                                                  } else {
                                                    next.delete(it.id);
                                                  }
                                                  return next;
                                                });
                                              }}
                                              className="h-4 w-4 rounded border-black/20 text-blue-600 focus:ring-blue-500"
                                            />
                                          )}
                                          <button
                                            data-item-id={it.id}
                                            type="button"
                                            onClick={() => {
                                              if (selectionMode) {
                                                setSelectedItemIds((prev) => {
                                                  const next = new Set(prev);
                                                  if (next.has(it.id)) {
                                                    next.delete(it.id);
                                                  } else {
                                                    next.add(it.id);
                                                  }
                                                  return next;
                                                });
                                              } else {
                                                openEditItem(it);
                                              }
                                            }}
                                            className={cx(
                                              'px-3 py-2 rounded-2xl border text-left hover:shadow-sm transition-shadow flex-1',
                                              expiryChipClass(it.expires_at),
                                              selectionMode && selectedItemIds.has(it.id) && 'ring-2 ring-blue-500 ring-offset-2'
                                            )}
                                            title={selectionMode ? 'Click to select' : 'Click to edit'}
                                          >
                                            <div className="flex flex-col gap-1">
                                              <div className="flex items-center gap-2">
                                                <div className="text-sm truncate" style={fontNunito}>
                                                  {it.name}
                                                </div>
                                                {it.qty !== null && it.qty !== undefined && (
                                                  <div className="text-xs text-black/70">× {it.qty}</div>
                                                )}
                                                {(() => {
                                                  const label = formatExpiryLabel(it.expires_at);
                                                  return label ? (
                                                    <div className="text-[11px] text-black/70 whitespace-nowrap">
                                                      {label}
                                                    </div>
                                                  ) : null;
                                                })()}
                                              </div>
                                            </div>
                                          </button>
                                        </div>
                                      ));
                                    })()
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
          <div className="text-sm text-black/70">Select a household (will return to All rooms):</div>
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
          description="Deleting this column will also delete all cells under it (and all items in those cells). This action cannot be undone."
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
          description="Deleting this cell will also delete all items in it. This action cannot be undone."
          onCancel={() => {
            setDeleteCellConfirmOpen(false);
            setTargetCellId(null);
          }}
          onConfirm={confirmDeleteCell}
        />

        {/* Item modal */}
        <Modal open={itemModalOpen} title={itemMode === 'add' ? 'Add item' : 'Edit item'} onClose={() => setItemModalOpen(false)} widthClass="max-w-4xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveItem();
            }}
          >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* left: fields */}
            <div className="md:col-span-2 space-y-4">
              <div>
                <div className="text-sm text-black/70">Name <span className="text-red-500">*</span></div>
                <input
                  ref={itemNameInputRef}
                  value={itemDraft.name}
                  onChange={(e) => setItemDraft((p) => ({ ...p, name: e.target.value }))}
                  className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="e.g., Milk"
                />
              </div>

              <div>
                <div className="text-sm text-black/70">Qty <span className="text-red-500">*</span></div>
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
                  placeholder="e.g., 1"
                />
              </div>

              <div>
                <div className="text-sm text-black/70">Expires at</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 7);
                      setItemDraft((p) => ({ ...p, expires_at: d.toISOString().slice(0, 10) }));
                    }}
                    className="px-3 py-1.5 rounded-lg border border-black/10 bg-white hover:bg-black/5 text-xs"
                  >
                    1 Week
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setMonth(d.getMonth() + 1);
                      setItemDraft((p) => ({ ...p, expires_at: d.toISOString().slice(0, 10) }));
                    }}
                    className="px-3 py-1.5 rounded-lg border border-black/10 bg-white hover:bg-black/5 text-xs"
                  >
                    1 Month
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setMonth(d.getMonth() + 6);
                      setItemDraft((p) => ({ ...p, expires_at: d.toISOString().slice(0, 10) }));
                    }}
                    className="px-3 py-1.5 rounded-lg border border-black/10 bg-white hover:bg-black/5 text-xs"
                  >
                    6 Months
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setFullYear(d.getFullYear() + 1);
                      setItemDraft((p) => ({ ...p, expires_at: d.toISOString().slice(0, 10) }));
                    }}
                    className="px-3 py-1.5 rounded-lg border border-black/10 bg-white hover:bg-black/5 text-xs"
                  >
                    1 Year
                  </button>
                </div>
                <input
                  type="date"
                  value={itemDraft.expires_at}
                  onChange={(e) => setItemDraft((p) => ({ ...p, expires_at: e.target.value }))}
                  className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="Or select a date"
                />
              </div>

              <div>
                <div className="text-sm text-black/70">Location <span className="text-red-500">*</span></div>
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
                  {(itemDraft.room_id ? (cellsForRoomCache[itemDraft.room_id] ?? []) : [])
                    .sort((a, b) => {
                      // First sort by column position
                      const colPosDiff = (a.column.position ?? 0) - (b.column.position ?? 0);
                      if (colPosDiff !== 0) return colPosDiff;
                      // If same column, sort by cell position
                      return (a.cell.position ?? 0) - (b.cell.position ?? 0);
                    })
                    .map(({ cell, column }) => (
                      <option key={cell.id} value={cell.id}>
                        {column.name} / {cell.code}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <div className="text-sm text-black/70">Remark</div>
                <textarea
                  value={itemDraft.remark ?? ''}
                  onChange={(e) => setItemDraft((p) => ({ ...p, remark: e.target.value }))}
                  className="mt-2 w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10 resize-none"
                  placeholder="Additional notes..."
                  rows={3}
                />
              </div>

              <div>
                <div className="text-sm text-black/70">Image</div>
                <label className="mt-2 block">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setItemDraft((p) => ({ ...p, imageFile: f }));
                    }}
                    className="hidden"
                  />
                  <div className="px-3 py-2 rounded-xl border border-black/10 bg-white hover:bg-black/5 text-sm text-center cursor-pointer">
                    {itemDraft.imageFile || itemDraft.image_path ? 'Change image' : 'Upload image'}
                  </div>
                </label>
                {itemDraft.imageFile && (
                  <button
                    type="button"
                    onClick={() => setItemDraft((p) => ({ ...p, imageFile: null }))}
                    className="mt-2 w-full px-3 py-1.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-xs"
                  >
                    Remove uploaded image
                  </button>
                )}
                {!itemDraft.imageFile && itemDraft.image_path && (
                  <button
                    type="button"
                    onClick={() => setItemDraft((p) => ({ ...p, image_path: null }))}
                    className="mt-2 w-full px-3 py-1.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-xs"
                  >
                    Remove current image
                  </button>
                )}
              </div>
            </div>

            {/* right: image preview */}
            <div className="md:col-span-1">
              <div className="rounded-2xl border border-black/10 bg-white/50 p-4 min-h-[200px] flex items-center justify-center">
                {itemDraft.imageFile ? (
                  <div className="w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={URL.createObjectURL(itemDraft.imageFile)}
                      alt="preview"
                      className="w-full rounded-xl border border-black/10"
                    />
                  </div>
                ) : itemDraft.image_path ? (
                  <div className="w-full">
                    {currentImageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={currentImageUrl}
                        alt="item"
                        className="w-full rounded-xl border border-black/10"
                      />
                    ) : (
                      <div className="text-xs text-black/40">Loading image...</div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-black/60">No image</div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-2">
            <div>
              {itemMode === 'edit' && itemDraft.id && (
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl border border-red-600 text-red-700 hover:bg-red-50 text-sm"
                  onClick={async () => {
                    await deleteItem(itemDraft.id as UUID);
                    setItemModalOpen(false);
                  }}
                >
                  Delete
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button 
                type="button"
                className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm disabled:opacity-60" 
                onClick={() => setItemModalOpen(false)}
                disabled={savingItem}
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="px-3 py-2 rounded-xl border border-black bg-black text-white hover:bg-black/90 text-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                disabled={savingItem}
              >
                {savingItem && (
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                {savingItem ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          </form>
        </Modal>

        {/* Batch move to location modal */}
        <Modal 
          open={moveToLocationModalOpen} 
          title="Move items to location" 
          onClose={() => {
            setMoveToLocationModalOpen(false);
            setBatchMoveTargetCellId(null);
          }} 
          widthClass="max-w-lg"
        >
          <div className="space-y-4">
            <div className="text-sm text-black/70">
              Select the destination location for {selectedItemIds.size} item(s):
            </div>
            
            <div>
              <div className="text-sm text-black/70 mb-2">Room</div>
              <select
                value={batchMoveTargetCellId ? (() => {
                  // Find which room contains the selected cell
                  for (const [roomId, cells] of Object.entries(cellsForRoomCache)) {
                    if (cells.some(({ cell }) => cell.id === batchMoveTargetCellId)) {
                      return roomId;
                    }
                  }
                  return '';
                })() : ''}
                onChange={async (e) => {
                  const rid = (e.target.value || null) as UUID | null;
                  setBatchMoveTargetCellId(null);
                  if (rid) await ensureCellsForRoomLoaded(rid);
                }}
                className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-black/10"
              >
                <option value="">Select room…</option>
                {roomsInHousehold.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="text-sm text-black/70 mb-2">Cell</div>
              <select
                value={batchMoveTargetCellId ?? ''}
                onChange={(e) => setBatchMoveTargetCellId((e.target.value || null) as UUID | null)}
                disabled={Object.keys(cellsForRoomCache).length === 0}
                className={cx(
                  "w-full px-3 py-2 rounded-xl border bg-white text-sm outline-none focus:ring-2 focus:ring-black/10",
                  "border-black/10",
                  Object.keys(cellsForRoomCache).length === 0 && 'opacity-60'
                )}
              >
                <option value="">Select cell…</option>
                {Object.entries(cellsForRoomCache).map(([roomId, cells]) =>
                  cells
                    .sort((a, b) => {
                      const colPosDiff = (a.column.position ?? 0) - (b.column.position ?? 0);
                      if (colPosDiff !== 0) return colPosDiff;
                      return (a.cell.position ?? 0) - (b.cell.position ?? 0);
                    })
                    .map(({ cell, column }) => (
                      <option key={cell.id} value={cell.id}>
                        {column.name} / {cell.code}
                      </option>
                    ))
                )}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setMoveToLocationModalOpen(false);
                  setBatchMoveTargetCellId(null);
                }}
                className="px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={batchMoveItems}
                disabled={!batchMoveTargetCellId}
                className="px-3 py-2 rounded-xl border border-black bg-black text-white hover:bg-black/90 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Move {selectedItemIds.size} item(s)
              </button>
            </div>
          </div>
        </Modal>

        {toast && <Toast message={toast} />}
      </div>
    </AuthGate>
  );
}
