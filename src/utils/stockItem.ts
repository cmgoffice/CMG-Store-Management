import type { StockItem } from '../types/models';

export function getStockItemId(item: Pick<StockItem, 'receiveNo' | 'stockItemId'>) {
  return item.stockItemId || item.receiveNo;
}

export function isStockItemAvailableForMovement(item: Pick<StockItem, 'qty' | 'status'>) {
  return item.qty > 0 && !['In Transit', 'Borrowed', 'Withdrawn'].includes(item.status);
}

export function isStockItemReadyForUse(item: Pick<StockItem, 'status'>) {
  return ['Available', 'Received at Site', 'Borrowed'].includes(item.status);
}

export function getDispatchReceiptBalance(qty: number, alreadyReceived = 0, receiveNow?: number) {
  const remaining = qty - alreadyReceived;
  const delta = receiveNow ?? remaining;
  if (![qty, alreadyReceived, delta].every(Number.isInteger) ||
      qty < 0 || alreadyReceived < 0 || remaining < 0 || delta < 0 || delta > remaining) {
    throw new Error('จำนวนรับเข้าต้องไม่เกินจำนวนที่ยังรอรับ กรุณารีเฟรชแล้วลองใหม่');
  }
  return { delta, received: alreadyReceived + delta, remaining: remaining - delta };
}
