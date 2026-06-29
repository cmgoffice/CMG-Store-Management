import type { StockItem } from '../types/models';

export function getStockItemId(item: Pick<StockItem, 'receiveNo' | 'stockItemId'>) {
  return item.stockItemId || item.receiveNo;
}
