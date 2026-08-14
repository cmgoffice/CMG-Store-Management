import type { StockItem } from '../types/models';

export function getStockItemId(item: Pick<StockItem, 'receiveNo' | 'stockItemId'>) {
  return item.stockItemId || item.receiveNo;
}

export function isStockItemAvailableForMovement(item: Pick<StockItem, 'qty' | 'status'>) {
  return item.qty > 0 && !['In Transit', 'Borrowed', 'Withdrawn'].includes(item.status);
}
