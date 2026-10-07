function stableHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function normalizeMaterialNo(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

export function createStockImportFingerprint(projectNo: string, rows: Array<{ itemNo: string; qty: number; prNo?: string; itemDescription?: string }>) {
  const payload = JSON.stringify([projectNo.trim().toUpperCase(), rows.map(row => [
    normalizeMaterialNo(row.itemNo), row.qty, (row.prNo ?? '').trim().toUpperCase(),
    (row.itemDescription ?? '').trim(),
  ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
  return { payload, id: `csv_${stableHash(payload)}${stableHash([...payload].reverse().join(''))}` };
}

export function assertStockIdentityMatches(
  stock: { itemNo: string; materialNo?: string },
  expectedMaterialNo: string,
) {
  const expected = normalizeMaterialNo(expectedMaterialNo);
  const materialNo = normalizeMaterialNo(stock.materialNo || stock.itemNo);
  const itemNo = normalizeMaterialNo(stock.itemNo);
  if (materialNo !== expected || (itemNo && itemNo !== expected)) {
    throw new Error(`ข้อมูลสต็อกมีรหัสขัดกัน: itemNo ${stock.itemNo}, materialNo ${stock.materialNo || '-'} (รับเข้า ${expected}) กรุณาตรวจสอบข้อมูลเดิมก่อนรับเข้า`);
  }
}

export function createStockIdentityKey(projectNo: string, materialNo: string) {
  const normalizedProjectNo = projectNo.trim().toUpperCase();
  const normalizedMaterialNo = normalizeMaterialNo(materialNo);

  return normalizedProjectNo && normalizedMaterialNo
    ? `${normalizedProjectNo}|${normalizedMaterialNo}`
    : '';
}

export function createStockIdentityDocumentId(projectNo: string, materialNo: string) {
  const identityKey = createStockIdentityKey(projectNo, materialNo);
  if (!identityKey) {
    return '';
  }

  const readable = identityKey
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
  const reverseHash = stableHash([...identityKey].reverse().join(''));

  return `stock_${stableHash(identityKey)}${reverseHash}_${readable}`;
}
