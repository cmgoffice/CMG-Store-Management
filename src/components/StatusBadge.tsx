import type { DispatchRecordStatus, StockStatus } from '../types/models';
import styles from './StatusBadge.module.css';

interface StatusBadgeProps {
  status: StockStatus | DispatchRecordStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const className =
    status === 'Pending Dispatch' || status === 'Pending Receipt'
      ? styles.pending
      : status === 'In Transit'
        ? styles.transit
        : styles.received;

  return <span className={`${styles.badge} ${className}`}>{status}</span>;
}
