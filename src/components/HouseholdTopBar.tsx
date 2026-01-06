'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function useClickOutside<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  return ref;
}

export default function HouseholdTopBar(props: {
  householdName: string;
  userEmail?: string;

  refreshing?: boolean;
  onRefresh: () => void;

  onOpenSwitchHousehold: () => void;
  onSignOut: () => void;
}) {
  const { householdName, userEmail, refreshing, onRefresh, onOpenSwitchHousehold, onSignOut } = props;

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2">
        <div className="text-xl font-semibold truncate">{householdName || 'Household'}</div>
        <button
          type="button"
          onClick={onOpenSwitchHousehold}
          className={cx(
            'px-2 py-1 rounded-lg border text-sm hover:bg-black/5 flex items-center gap-1',
            'border-black/10'
          )}
          title="Switch household"
        >
          <span>Switch</span>
          <span className="text-xs text-black/60">▾</span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        {/* Refresh（独立按钮） */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={!!refreshing}
          className={cx(
            'px-3 py-2 rounded-xl border text-sm',
            'border-[#2563EB]/25',
            refreshing ? 'bg-black/5 text-black/50' : 'hover:bg-black/5'
          )}
          title="Refresh"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>

        {/* Account pill（邮箱 + 下拉菜单） */}
        <div className="relative" ref={ref}>
          <button
            type="button"
            className={cx(
              'px-3 py-2 rounded-xl border text-sm hover:bg-black/5 flex items-center gap-2',
              'border-black/10'
            )}
            onClick={() => setOpen((v) => !v)}
            aria-label="Account"
            title="Account"
          >
            <span className="max-w-[220px] truncate">{userEmail || 'Account'}</span>
            <span className="text-xs text-black/60">▾</span>
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-60 rounded-2xl border border-black/10 bg-white shadow-lg overflow-hidden z-[70]">
              {/* 邮箱展示区：你要求“合适位置显示邮箱”——这里就是固定一致的位置 */}
              <div className="px-3 py-2 text-xs text-black/60 border-b border-black/10">
                Signed in as
                <div className="text-sm text-black truncate mt-1">{userEmail || '—'}</div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push('/households');
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-black/5"
              >
                Manage households
              </button>

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-700"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
