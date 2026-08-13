import { ITEM_TYPE_OPTIONS } from '../constants/itemTypes';

export type StockCsvRow = {
  rowNumber: number;
  itemNo: string;
  itemDescription: string;
  prNo: string;
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
  prNo: ['pr', 'pr.', 'เลขที่ pr', 'pr no', 'pr no.', 'pr_no', 'pr number', 'pr_number'],
  category: ['หมวดหมู่', 'ประเภทสินค้า', 'category', 'item type', 'item_type', 'type'],
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

function findItemTypeOption(value: string) {
  const normalizedValue = value.trim().toLowerCase();
  return ITEM_TYPE_OPTIONS.find((option) => (
    option.code.toLowerCase() === normalizedValue || option.label.toLowerCase() === normalizedValue
  ));
}

export function parseStockCsv(text: string): StockCsvParseResult {
  const records = parseCsvRecords(text);
  if (records.length === 0) return { rows: [], errors: ['ไฟล์ CSV ไม่มีข้อมูล'], warnings: [] };

  const headers = records[0].map(normalizeHeader);
  const itemNoIndex = findHeaderIndex(headers, HEADER_ALIASES.itemNo);
  const descriptionIndex = findHeaderIndex(headers, HEADER_ALIASES.itemDescription);
  const prNoIndex = findHeaderIndex(headers, HEADER_ALIASES.prNo);
  const categoryIndex = findHeaderIndex(headers, HEADER_ALIASES.category);
  const qtyIndex = findHeaderIndex(headers, HEADER_ALIASES.qty);
  if ([itemNoIndex, descriptionIndex, prNoIndex, categoryIndex, qtyIndex].some((index) => index < 0)) {
    return { rows: [], errors: ['หัวตารางต้องมี รหัสสินค้า, PR, ชื่อสินค้า, หมวดหมู่ และ จำนวน'], warnings: [] };
  }

  const rows: StockCsvRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 2;
    const itemNo = (record[itemNoIndex] ?? '').trim().toUpperCase().replace(/\s+/g, '');
    const itemDescription = (record[descriptionIndex] ?? '').trim();
    const prNo = prNoIndex >= 0 ? (record[prNoIndex] ?? '').trim() : '';
    const categoryText = categoryIndex >= 0 ? (record[categoryIndex] ?? '').trim() : '';
    const qtyText = (record[qtyIndex] ?? '').trim().replace(/,/g, '');
    const qty = Number(qtyText);
    const typeOption = findItemTypeOption(categoryText);

    if (!itemNo) errors.push(`แถว ${rowNumber}: ไม่ได้ระบุรหัสสินค้า`);
    if (!prNo) errors.push(`แถว ${rowNumber}: ไม่ได้ระบุ PR`);
    if (!itemDescription) errors.push(`แถว ${rowNumber}: ไม่ได้ระบุชื่อสินค้า`);
    if (!categoryText) {
      errors.push(`แถว ${rowNumber}: ไม่ได้ระบุหมวดหมู่ (ต้องเป็น Type ของระบบ)`);
    } else if (!typeOption) {
      errors.push(`แถว ${rowNumber}: หมวดหมู่ต้องเป็น Type ของระบบ เช่น ${ITEM_TYPE_OPTIONS[0].label}`);
    }
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
        prNo,
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
  const seenLabels = new Set<string>();
  const sampleRows = ITEM_TYPE_OPTIONS
    .filter((option) => {
      const labelKey = option.label.trim().toLowerCase();
      if (seenLabels.has(labelKey)) return false;
      seenLabels.add(labelKey);
      return true;
    })
    .map((option, index) => [
      `${option.code}-TEMPLATE-${String(index + 1).padStart(3, '0')}`,
      `PR-TEMPLATE-${String(index + 1).padStart(3, '0')}`,
      `${option.label} ตัวอย่าง`,
      option.label,
      '1',
    ]);
  const content = '\uFEFF' + [
    ['รหัสสินค้า', 'PR', 'ชื่อสินค้า', 'หมวดหมู่', 'ยอดรวม'],
    ...sampleRows,
  ].map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'stock-import-template.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
