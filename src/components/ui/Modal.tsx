import React from "react";
import { cx } from "@/src/lib/utils";

export default function Modal({
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
