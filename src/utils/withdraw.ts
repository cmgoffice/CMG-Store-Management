import type { WithdrawRecord } from '../types/models';

export function isWithdrawOverdue(record: WithdrawRecord, now = Date.now()) {
  if (record.type !== 'borrow' || record.status === 'Returned' || record.status === 'Cancelled' || !record.dueDate) {
    return false;
  }

  // Date-only deadlines include the entire return day in Bangkok.
  const deadline = new Date(record.dueDate.includes('T') ? record.dueDate : `${record.dueDate}T23:59:59.999+07:00`);
  return !Number.isNaN(deadline.getTime()) && deadline.getTime() < now;
}
