import React from "react";
import { cx } from "@/src/lib/utils";
import Modal from "./Modal";

export default function ConfirmModal({
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
