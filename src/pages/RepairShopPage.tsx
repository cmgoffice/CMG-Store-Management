import { useInventory } from '../context/InventoryContext';
import { StockListPage } from './StockListPage';

export function RepairShopPage() {
  const { repairShopItems } = useInventory();

  return (
    <StockListPage
      items={repairShopItems}
      showItemStatus
      title="Repair Shop"
      description="ภาพรวมรายการ Repair Shop ทุกโครงการ พร้อมแสดงจำนวนแยกตามโครงการ"
      emptyMessage="ไม่พบรายการ Repair Shop ตามเงื่อนไขที่ค้นหา"
    />
  );
}
