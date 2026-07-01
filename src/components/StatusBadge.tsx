import type {
  DispatchRecordStatus,
  ReceivingRequestStatus,
  StockStatus,
  WithdrawRecordStatus,
} from '../types/models';
import styles from './StatusBadge.module.css';

interface StatusBadgeProps {
  status: StockStatus | DispatchRecordStatus | ReceivingRequestStatus | WithdrawRecordStatus;
}

function formatStatusLabel(status: StatusBadgeProps['status']) {
  if (status === 'pending') return 'Pending';
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'cancelled') return 'Cancelled';
  return status;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const className =
    status === 'Pending Dispatch' ||
    status === 'Pending Receipt' ||
    status === 'Waiting Return' ||
    status === 'pending'
      ? styles.pending
      : status === 'In Transit' || status === 'Borrowed'
        ? styles.transit
        : status === 'Overdue'
          ? styles.overdue
          : status === 'Issued' || status === 'Withdrawn'
            ? styles.neutral
            : styles.received;

  return <span className={`${styles.badge} ${className}`}>{formatStatusLabel(status)}</span>;
}
