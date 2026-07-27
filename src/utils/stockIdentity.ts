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
