import React from 'react';
import { cx } from '@/src/lib/utils';

interface SmallIconButtonProps {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}

export default function SmallIconButton({
  title,
  onClick,
  children,
  className,
}: SmallIconButtonProps) {
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
