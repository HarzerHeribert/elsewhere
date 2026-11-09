import type { ReactNode } from 'react';
export function StatusBadge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: 'neutral' | 'live' | 'waiting' | 'error';
  children: ReactNode;
  className?: string;
}) {
  return <span className={`ew-badge ew-badge--${tone} ${className}`}>{children}</span>;
}
