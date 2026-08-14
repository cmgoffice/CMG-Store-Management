export const ITEM_TYPE_OPTIONS = [
  { group: 'Type 1', code: 'ML', label: 'วัสดุก่อสร้าง' },
  { group: 'Type 1', code: 'CONS', label: 'สิ้นเปลืองเบ็ดเตล็ด' },
  { group: 'Type 1', code: 'SP-CS', label: 'อะไหล่เครื่องมือ เครื่องจักร สิ้นเปลือง' },
  { group: 'Type 1', code: 'SHE', label: 'เซฟตี้' },
  { group: 'Type 1', code: 'OFF', label: 'อุปกรณ์เครื่องเขียน' },
  { group: 'Type 1', code: 'REPAIR', label: 'อะไหล่ซ่อม' },
  { group: 'Type 2', code: 'EQM', label: 'เครื่องจักร เครื่องมือ และอุปกรณ์สนง.' },
  { group: 'Type 2', code: 'COM', label: 'คอมพิวเตอร์' },
  { group: 'Type 2', code: 'SCAFF', label: 'นั่งร้าน' },
  { group: 'Type 2', code: 'FWPR', label: 'แบบเหล็ก' },
  { group: 'Type 2', code: 'Formwork', label: 'แบบเหล็ก' },
] as const;

export type ItemTypeCode = (typeof ITEM_TYPE_OPTIONS)[number]['code'];
export type ItemTypeGroup = (typeof ITEM_TYPE_OPTIONS)[number]['group'];

type ItemTypeSource = {
  itemType?: string;
  type?: string;
  category?: string;
  itemCategory?: string;
  receiveType?: string;
  poType?: string;
  materialNo?: string;
  itemNo?: string;
};

function normalizeTypeCode(value?: string) {
  return value?.trim().toUpperCase() ?? '';
}

function normalizeMaterialNo(value?: string) {
  return normalizeTypeCode(value).replace(/[^A-Z0-9]/g, '');
}

export function getItemTypeOption(value?: string) {
  const normalizedValue = normalizeTypeCode(value);
  const valuesToMatch = [
    normalizedValue,
    normalizedValue.replace(/^TYPE[\s_-]*/, ''),
  ];
  return ITEM_TYPE_OPTIONS.find((option) => valuesToMatch.includes(normalizeTypeCode(option.code)));
}

export function inferItemTypeCode(source: ItemTypeSource): ItemTypeCode | '' {
  const explicitOption = [
    source.itemType,
    source.type,
    source.category,
    source.itemCategory,
    source.receiveType,
    source.poType,
  ]
    .map((value) => getItemTypeOption(value))
    .find(Boolean);
  if (explicitOption) {
    return explicitOption.code;
  }

  const materialNumbers = [source.materialNo, source.itemNo]
    .map((value) => normalizeMaterialNo(value))
    .filter(Boolean);
  const inferredOption = [...ITEM_TYPE_OPTIONS]
    .sort((left, right) => right.code.length - left.code.length)
    .find((option) => materialNumbers.some((materialNo) => materialNo.startsWith(normalizeMaterialNo(option.code))));

  return inferredOption?.code ?? '';
}

export function matchesItemType(source: ItemTypeSource, selectedType: ItemTypeCode | '') {
  return !selectedType || inferItemTypeCode(source) === selectedType;
}
