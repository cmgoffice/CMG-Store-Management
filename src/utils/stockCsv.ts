import { getItemTypeOption, inferItemTypeCode } from '../constants/itemTypes';

export type StockCsvRow = {
  rowNumber: number;
  itemNo: string;
  itemDescription: string;
  qty: number;
  itemType: string;
  itemTypeGroup?: 'Type 1' | 'Type 2';
};

export type StockCsvParseResult = {
  rows: StockCsvRow[];
  errors: string[];
  warnings: string[];
};

const HEADER_ALIASES = {
  itemNo: ['รหัสสินค้า', 'รหัส', 'item code', 'item_code', 'item no', 'item_no'],
  itemDescription: ['ชื่อสินค้า', 'รายการ', 'item name', 'item_name', 'description'],
  qty: ['จำนวน', 'ยอดรวม', 'qty', 'quantity', 'total'],
} as const;

function normalizeHeader(value: string) {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase();
}

function parseCsvRecords(text: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      record.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      if (record.some((value) => value.trim())) records.push(record);
      record = [];
      field = '';
    } else {
      field += character;
    }
  }

  record.push(field);
  if (record.some((value) => value.trim())) records.push(record);
  return records;
}

function findHeaderIndex(headers: string[], aliases: readonly string[]) {
  return headers.findIndex((header) => aliases.includes(header));
}

export function parseStockCsv(text: string): StockCsvParseResult {
  const records = parseCsvRecords(text);
  if (records.length === 0) return { rows: [], errors: ['ไฟล์ CSV ไม่มีข้อมูล'], warnings: [] };

  const headers = records[0].map(normalizeHeader);
  const itemNoIndex = findHeaderIndex(headers, HEADER_ALIASES.itemNo);
  const descriptionIndex = findHeaderIndex(headers, HEADER_ALIASES.itemDescription);
  const qtyIndex = findHeaderIndex(headers, HEADER_ALIASES.qty);
  if ([itemNoIndex, descriptionIndex, qtyIndex].some((index) => index < 0)) {
    return { rows: [], errors: ['หัวตารางต้องมี รหัสสินค้า, ชื่อสินค้า และ จำนวน'], warnings: [] };
  }

  const rows: StockCsvRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 2;
    const itemNo = (record[itemNoIndex] ?? '').trim().toUpperCase().replace(/\s+/g, '');
    const itemDescription = (record[descriptionIndex] ?? '').trim();
    const qtyText = (record[qtyIndex] ?? '').trim().replace(/,/g, '');
    const qty = Number(qtyText);
    const itemType = inferItemTypeCode({ itemNo });
    const typeOption = getItemTypeOption(itemType);

    if (!itemNo) errors.push(`แถว ${rowNumber}: ไม่ได้ระบุรหัสสินค้า`);
    if (!itemDescription) errors.push(`แถว ${rowNumber}: ไม่ได้ระบุชื่อสินค้า`);
    if (!qtyText || !Number.isFinite(qty) || !Number.isInteger(qty) || qty < 0) {
      warnings.push(`แถว ${rowNumber}: รหัส ${itemNo || '-'} มีจำนวนไม่ถูกต้อง ระบบจะข้ามรายการนี้`);
    } else if (qty === 0) {
      warnings.push(`แถว ${rowNumber}: รหัส ${itemNo || '-'} มีจำนวนเป็น 0 ระบบจะข้ามรายการนี้`);
    }
    if (itemNo && itemDescription && Number.isInteger(qty) && qty > 0) {
      rows.push({
        rowNumber,
        itemNo,
        itemDescription,
        qty,
        itemType: typeOption?.code ?? '',
        itemTypeGroup: typeOption?.group,
      });
    }
  });

  if (records.length === 1) errors.push('ไฟล์ CSV ไม่มีรายการสินค้า');
  return { rows, errors, warnings };
}

export function downloadStockCsvTemplate() {
  const content = '\uFEFFรหัสสินค้า,ชื่อสินค้า,ยอดรวม\r\nCOM-NB-001,Notebook ตัวอย่าง,1\r\nCONS-0001,วัสดุสิ้นเปลืองตัวอย่าง,10\r\n';
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'stock-import-template.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
