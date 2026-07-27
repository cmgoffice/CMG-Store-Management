import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  collection,
  doc,
  type DocumentData,
  runTransaction,
  setDoc,
  onSnapshot,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { APP_NAME } from '../config/firestore';
import { db, masterDataDb, masterDataProjectsPath, storage } from '../firebase';
import { processPrPoReceivePayload } from '../services/prPoReceiveIntegration';
import type {
  DispatchRecord,
  PrPoReceivePayload,
  PrPoReceiveResponse,
  Project,
  ProjectStatus,
  ReceivingRequest,
  ReceivingRequestItem,
  ReceivingRequestStatus,
  StockItem,
  WithdrawRecord,
  WithdrawRecordStatus,
  WithdrawType,
} from '../types/models';
import { getStockItemId } from '../utils/stockItem';
import {
  createStockIdentityDocumentId,
  normalizeMaterialNo,
} from '../utils/stockIdentity';
import { useAuth } from './AuthContext';

interface CreateDispatchLineInput {
  receiveNo: string;
  qty: number;
}

interface CreateDispatchInput {
  sourceProjectNo: string;
  items: CreateDispatchLineInput[];
  projectNo: string;
  transport: string;
  note: string;
  photos: File[];
}

interface ReceiveDispatchLineInput {
  stockReceiveNo: string;
  receivedQty: number;
}

interface ApproveReceivingRequestLineInput {
  itemIndex: number;
  receivedQty: number;
  itemType?: string;
  itemTypeGroup?: 'Type 1' | 'Type 2';
}

interface CreateWithdrawLineInput {
  receiveNo: string;
  qty: number;
}

interface CreateWithdrawInput {
  projectNo: string;
  type: WithdrawType;
  items: CreateWithdrawLineInput[];
  requesterName: string;
  requesterPhone: string;
  withdrawDate: string;
  purpose: string;
  dueDate?: string;
  photos: File[];
}

interface InventoryContextValue {
  projects: Project[];
  activeProjects: Project[];
  stockItems: StockItem[];
  receivingRequests: ReceivingRequest[];
  dispatchRecords: DispatchRecord[];
  withdrawRecords: WithdrawRecord[];
  updateProjectStatus: (projectNo: string, status: ProjectStatus) => Promise<void>;
  createDispatch: (input: CreateDispatchInput) => Promise<void>;
  cancelDispatch: (dispatchId: string) => Promise<void>;
  createWithdraw: (input: CreateWithdrawInput) => Promise<void>;
  returnWithdraw: (withdrawId: string) => Promise<void>;
  cancelWithdraw: (withdrawId: string) => Promise<void>;
  approveReceipt: (receiveNo: string) => Promise<void>;
  approveReceivingRequest: (requestId: string, receivedItems?: ApproveReceivingRequestLineInput[]) => Promise<void>;
  receiveDispatch: (dispatchId: string, receivedItems?: ReceiveDispatchLineInput[]) => Promise<void>;
  receiveNewItem: (item: StockItem) => Promise<void>;
  receivePrPoPayload: (payload: PrPoReceivePayload) => Promise<PrPoReceiveResponse>;
  activeProjectNo: string;
  setActiveProjectNo: (projectNo: string) => void;
}

const InventoryContext = createContext<InventoryContextValue | undefined>(undefined);

const MASTER_LOCKED_FIELDS: NonNullable<Project['lockedFields']> = [
  'projectNo',
  'projectName',
  'location',
  'projectManager',
  'constructionManager',
];

interface MasterDataProject {
  id?: string;
  jobNo?: string;
  name?: string;
  location?: string;
  pmName?: string;
  cmName?: string;
}

function normalizeProjectStatus(value: unknown): ProjectStatus {
  return String(value).trim().toLowerCase() === 'disactive' ? 'Disactive' : 'Active';
}

function normalizeReceivingRequestStatus(value: unknown): ReceivingRequestStatus {
  const normalized = String(value || 'pending').trim().toLowerCase();

  if (
    normalized === 'approved' ||
    normalized === 'rejected' ||
    normalized === 'cancelled'
  ) {
    return normalized;
  }

  return 'pending';
}

function normalizeWithdrawType(value: unknown): WithdrawType {
  return String(value || '').trim().toLowerCase() === 'borrow' ? 'borrow' : 'issue';
}

function normalizeWithdrawRecordStatus(value: unknown): WithdrawRecordStatus {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'waiting return' || normalized === 'waiting_return' || normalized === 'borrowed') {
    return 'Waiting Return';
  }

  if (normalized === 'overdue') {
    return 'Overdue';
  }

  if (normalized === 'returned') {
    return 'Returned';
  }

  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'Cancelled';
  }

  return 'Issued';
}

function formatPersonName(firstName?: string, lastName?: string, fallback = 'Unknown User') {
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || fallback;
}

function createReceivedBySnapshot(userProfile: ReturnType<typeof useAuth>['userProfile'], fallbackName: string) {
  return {
    receivedByUid: userProfile?.uid ?? '',
    receivedByName: formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? fallbackName
    ),
    receivedByEmail: userProfile?.email ?? 'unknown@cmg.local',
  };
}

function createDispatchNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `DSP-${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function getProjectShortNo(projectNo: string) {
  const compactProjectNo = normalizeProjectNoText(projectNo).replace(/[^a-zA-Z0-9]+/g, '');
  return compactProjectNo.slice(-5) || 'PROJECT';
}

function createWithdrawNumber(projectNo: string) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${getProjectShortNo(projectNo)}-WD-${yyyy}${mm}${dd}-${hh}${min}${ss}${ms}`;
}

function createProjectLabel(projectNo: string) {
  return `Project ${projectNo}`;
}

function createProjectStoreLocation(projectNo: string) {
  return `Store ${projectNo}`;
}

function createTransitLocation(projectNo: string) {
  return `In Transit to ${createProjectStoreLocation(projectNo)}`;
}

function roundAmount(value: number) {
  return Math.round(value * 100) / 100;
}

function calculatePartialAmount(totalAmount: number, totalQty: number, selectedQty: number) {
  if (totalQty <= 0 || selectedQty <= 0) {
    return 0;
  }

  return roundAmount((totalAmount * selectedQty) / totalQty);
}

function createDispatchStockReceiveNo(receiveNo: string, dispatchNo: string, index: number) {
  return `${receiveNo}-${dispatchNo}-${String(index + 1).padStart(2, '0')}`;
}

function createReceivingStockReceiveNo(request: ReceivingRequest, item: ReceivingRequestItem, index: number) {
  if (item.stockReceiveNo) {
    return item.stockReceiveNo;
  }

  if (request.items.length === 1) {
    return request.receiveNo;
  }

  return `${request.receiveNo}-${String(index + 1).padStart(2, '0')}`;
}

function extractProjectNo(projectLabel: string) {
  return projectLabel.replace(/^Project\s+/i, '').trim();
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDateText(value: unknown) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  return '';
}

function normalizeNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean)
    : [];
}

function normalizeBoolean(value: unknown) {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }

  if (
    value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([entryKey, entryValue]) => [entryKey, stripUndefined(entryValue)]),
    ) as T;
  }

  return value;
}

function normalizeProjectNoText(value: unknown) {
  const text = normalizeText(value);
  const projectMatch = text.match(/\bJ[-\s]?0*([0-9]+[a-z0-9]*)\b/i);

  if (projectMatch) {
    return `J${projectMatch[1].toUpperCase()}`;
  }

  const plainProjectMatch = text.match(/\b0*([0-9]+[a-z0-9]*)\b/i);
  if (plainProjectMatch) {
    return `J${plainProjectMatch[1].toUpperCase()}`;
  }

  return text;
}

function normalizeCmgProjectCode(...values: unknown[]) {
  for (const value of values) {
    const normalized = normalizeProjectNoText(value);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function getStockItemProjectNo(item: Pick<StockItem, 'cmgProjectCode' | 'purchasedForProject' | 'location' | 'projectId'>) {
  return normalizeCmgProjectCode(
    item.cmgProjectCode,
    item.purchasedForProject,
    item.location,
    item.projectId,
  );
}

function projectNoMatches(left: string, right: string) {
  return left === right || normalizeProjectNoText(left) === normalizeProjectNoText(right);
}

function normalizeProjectNoFromRequest(data: DocumentData) {
  const projectCandidates = [
    data.projectNo,
    data.projectItemCode,
    data.projectId,
    data.receiveNo,
    data.rpNo,
    data.documentNo,
    data.id,
    data.idempotencyKey,
  ];

  for (const candidate of projectCandidates) {
    const projectNo = normalizeProjectNoText(candidate);
    if (projectNo) {
      return projectNo;
    }
  }

  return '';
}

function parseReceivingItems(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeReceivingRequestItem(data: DocumentData, index: number): ReceivingRequestItem {
  const receivedQty = normalizeNumber(
    data.receivedQty ?? data.qtyReceive ?? data.qty ?? data.QTY ?? data.quantity
  );
  const orderedQty = normalizeNumber(data.orderedQty, receivedQty);
  const price = normalizeNumber(data.price ?? data.unitPrice);
  const amount = normalizeNumber(data.amount, price > 0 ? price * receivedQty : 0);
  const materialNo = normalizeText(data.materialNo ?? data.iditem);

  return {
    itemNo:
      normalizeText(data.itemNo ?? data.materialNo ?? data.iditem ?? data.descriptionKey) ||
      `ITEM-${String(index + 1).padStart(2, '0')}`,
    itemDescription: normalizeText(data.itemDescription ?? data.description ?? data.itemName),
    orderedQty,
    receivedQty,
    unit: normalizeText(data.unit),
    price,
    amount,
    materialNo,
    photos: normalizeStringArray(data.photos),
    stockReceiveNo: normalizeText(data.stockReceiveNo),
    itemType: normalizeText(data.itemType),
    itemTypeGroup: normalizeText(data.itemTypeGroup) === 'Type 2' ? 'Type 2' : normalizeText(data.itemTypeGroup) === 'Type 1' ? 'Type 1' : undefined,
  };
}

function normalizeReceivingRequest(data: DocumentData, fallbackId: string): ReceivingRequest {
  const headerData =
    data.header && typeof data.header === 'object'
      ? (data.header as DocumentData)
      : ({} as DocumentData);
  const items = parseReceivingItems(data.items)
    .map((item, index) => normalizeReceivingRequestItem(item as DocumentData, index))
    .filter((item) => item.receivedQty > 0);
  const projectNo = normalizeProjectNoFromRequest(data);
  const totalQty = normalizeNumber(data.totalQty, items.reduce((sum, item) => sum + item.receivedQty, 0));
  const totalAmount = normalizeNumber(data.totalAmount, items.reduce((sum, item) => sum + item.amount, 0));

  return {
    id: normalizeText(data.id) || fallbackId,
    documentNo: normalizeText(data.documentNo ?? headerData.documentNo),
    receiveNo: normalizeText(data.receiveNo ?? data.rpNo ?? headerData.receiveNo ?? headerData.rpNo) || fallbackId,
    poNo: normalizeText(data.poNo ?? data.documentNo ?? headerData.poNo ?? headerData.documentNo),
    prNo: normalizeText(data.prNo ?? headerData.prNo),
    poType: normalizeText(data.poType ?? data.receiveType ?? headerData.poType ?? headerData.receiveType),
    poId: normalizeText(data.poId ?? headerData.poId),
    projectId: normalizeText(data.projectId ?? headerData.projectId),
    cmgProjectCode: normalizeCmgProjectCode(
      data.cmgProjectCode,
      headerData.cmgProjectCode,
      data.projectItemCode,
      headerData.projectItemCode,
      data.projectNo,
      headerData.projectNo,
      data.projectId,
      headerData.projectId,
    ),
    projectNo,
    projectName: normalizeText(data.projectName ?? headerData.projectName) || normalizeProjectNoText(data.projectId ?? headerData.projectId) || projectNo,
    projectItemCode: normalizeText(data.projectItemCode ?? headerData.projectItemCode),
    location: normalizeText(data.location ?? headerData.location),
    vendorName: normalizeText(data.vendorName ?? headerData.vendorName),
    receiveName: normalizeText(data.receiveName ?? data.receivedByName ?? headerData.receiveName ?? headerData.receivedByName),
    receiveDate: normalizeDateText(data.receiveDate ?? data.receivedDate ?? headerData.receiveDate ?? headerData.receivedDate),
    receivedByUid: normalizeText(data.receivedByUid ?? headerData.receivedByUid),
    receivedByName: normalizeText(data.receivedByName ?? headerData.receivedByName),
    note: normalizeText(data.note ?? headerData.note),
    sourceApp: normalizeText(data.sourceApp ?? headerData.sourceApp) || (normalizeBoolean(data.autoCreatedFromPoApproval) ? 'PO Approval' : ''),
    externalDocId: normalizeText(data.externalDocId ?? data.poId ?? data.documentNo ?? data.rpNo ?? data.idempotencyKey ?? headerData.poId ?? headerData.documentNo ?? headerData.rpNo ?? headerData.idempotencyKey),
    autoCreatedFromPoApproval: normalizeBoolean(data.autoCreatedFromPoApproval),
    requestStatus: normalizeReceivingRequestStatus(data.requestStatus ?? data.status),
    items,
    totalQty,
    totalAmount,
    requestedAt: normalizeDateText(data.requestedAt ?? headerData.requestedAt) || normalizeDateText(data.createdAt ?? headerData.createdAt) || new Date().toISOString(),
    approvedAt: normalizeDateText(data.approvedAt ?? headerData.approvedAt),
    approvedByUid: normalizeText(data.approvedByUid ?? headerData.approvedByUid),
    approvedByName: normalizeText(data.approvedByName ?? headerData.approvedByName),
    approvedByEmail: normalizeText(data.approvedByEmail ?? headerData.approvedByEmail),
    stockReceiveNos: normalizeStringArray(data.stockReceiveNos),
  };
}

function normalizeStockItem(data: DocumentData, fallbackId: string): StockItem {
  return {
    stockItemId: normalizeText(data.stockItemId) || fallbackId,
    receiveNo: normalizeText(data.receiveNo ?? data.rpNo) || fallbackId,
    poNo: normalizeText(data.poNo ?? data.documentNo),
    prNo: normalizeText(data.prNo),
    poType: normalizeText(data.poType ?? data.receiveType),
    itemNo:
      normalizeText(data.itemNo ?? data.materialNo ?? data.iditem ?? data.descriptionKey) ||
      fallbackId,
    itemDescription: normalizeText(data.itemDescription ?? data.description ?? data.itemName),
    amount: normalizeNumber(data.amount),
    qty: normalizeNumber(data.qty ?? data.QTY ?? data.quantity),
    vendorName: normalizeText(data.vendorName),
    location: normalizeText(data.location),
    purchasedForProject: normalizeText(data.purchasedForProject ?? data.projectName),
    receiveName: normalizeText(data.receiveName ?? data.receivedByName),
    receiveDate: normalizeDateText(data.receiveDate ?? data.receivedDate ?? data.lastReceivedAt),
    status: (normalizeText(data.status) as StockItem['status']) || 'Pending Dispatch',
    sourceApp: normalizeText(data.sourceApp),
    sourceReceiveNo: normalizeText(data.sourceReceiveNo),
    rpNo: normalizeText(data.rpNo),
    receiveType: normalizeText(data.receiveType),
    itemType: normalizeText(data.itemType),
    itemTypeGroup: normalizeText(data.itemTypeGroup) === 'Type 2' ? 'Type 2' : normalizeText(data.itemTypeGroup) === 'Type 1' ? 'Type 1' : undefined,
    iditem: normalizeText(data.iditem),
    materialNo: normalizeText(data.materialNo),
    unit: normalizeText(data.unit),
    poItemIndex: data.poItemIndex,
    orderedQty:
      data.orderedQty === undefined || data.orderedQty === null
        ? undefined
        : normalizeNumber(data.orderedQty),
    unitPrice:
      data.unitPrice === undefined || data.unitPrice === null
        ? undefined
        : normalizeNumber(data.unitPrice),
    projectId: normalizeText(data.projectId),
    vendorId: normalizeText(data.vendorId),
    documentNo: normalizeText(data.documentNo),
    poId:
      data.poId === undefined || data.poId === null
        ? undefined
        : String(data.poId).trim(),
    receivedByUid: normalizeText(data.receivedByUid),
    receivedByName: normalizeText(data.receivedByName),
    receivedByEmail: normalizeText(data.receivedByEmail),
    note: normalizeText(data.note),
    lastReceiveEventId: normalizeText(data.lastReceiveEventId),
    lastReceivedQty:
      data.lastReceivedQty === undefined || data.lastReceivedQty === null
        ? undefined
        : normalizeNumber(data.lastReceivedQty),
    lastReceivedAt: normalizeDateText(data.lastReceivedAt),
  };
}

function getStockItemMaterialNo(item: Pick<StockItem, 'materialNo' | 'itemNo'>) {
  return normalizeMaterialNo(item.materialNo || item.itemNo);
}

function findStockItemByIdentity(
  stockItems: StockItem[],
  projectNo: string,
  materialNo: string,
  excludedIds: string[] = [],
) {
  const normalizedProjectNo = normalizeProjectNoText(projectNo);
  const normalizedMaterialNo = normalizeMaterialNo(materialNo);
  const excludedIdSet = new Set(excludedIds);

  if (!normalizedProjectNo || !normalizedMaterialNo) {
    return undefined;
  }

  const deterministicId = createStockIdentityDocumentId(normalizedProjectNo, normalizedMaterialNo);

  return stockItems
    .filter((item) => (
      !excludedIdSet.has(getStockItemId(item)) &&
      item.status !== 'In Transit' &&
      getStockItemProjectNo(item) === normalizedProjectNo &&
      getStockItemMaterialNo(item) === normalizedMaterialNo
    ))
    .sort((left, right) => {
      const leftId = getStockItemId(left);
      const rightId = getStockItemId(right);
      const leftScore = Number(Boolean(left.materialNo)) * 2 + Number(leftId === deterministicId);
      const rightScore = Number(Boolean(right.materialNo)) * 2 + Number(rightId === deterministicId);
      return rightScore - leftScore || leftId.localeCompare(rightId);
    })[0];
}

function normalizeWithdrawRecord(data: DocumentData, fallbackId: string): WithdrawRecord {
  const type = normalizeWithdrawType(data.type);
  const rawItems = parseReceivingItems(data.items);
  const projectNo = normalizeProjectNoText(data.projectNo);
  const withdrawNo = normalizeText(data.withdrawNo) || fallbackId;
  const items = rawItems.map((item, index) => {
    const itemData = item as DocumentData;
    const stockItemSnapshot =
      itemData.stockItemSnapshot &&
      typeof itemData.stockItemSnapshot === 'object' &&
      !Array.isArray(itemData.stockItemSnapshot)
        ? normalizeStockItem(itemData.stockItemSnapshot as DocumentData, normalizeText(itemData.stockItemId) || normalizeText(itemData.receiveNo) || `${fallbackId}-${index + 1}`)
        : undefined;

    const receiveNo = normalizeText(itemData.receiveNo) || stockItemSnapshot?.receiveNo || `${withdrawNo}-${index + 1}`;
    const stockItemId = normalizeText(itemData.stockItemId) || stockItemSnapshot?.stockItemId || receiveNo;

    return {
      stockItemId,
      receiveNo,
      prNo: normalizeText(itemData.prNo) || stockItemSnapshot?.prNo || '',
      poNo: normalizeText(itemData.poNo) || stockItemSnapshot?.poNo || '',
      itemNo: normalizeText(itemData.itemNo) || stockItemSnapshot?.itemNo || stockItemId,
      itemDescription: normalizeText(itemData.itemDescription) || stockItemSnapshot?.itemDescription || '',
      qty: normalizeNumber(itemData.qty),
      returnedQty:
        itemData.returnedQty === undefined || itemData.returnedQty === null
          ? undefined
          : normalizeNumber(itemData.returnedQty),
      amount: normalizeNumber(itemData.amount),
      unit: normalizeText(itemData.unit) || stockItemSnapshot?.unit,
      vendorName: normalizeText(itemData.vendorName) || stockItemSnapshot?.vendorName || '',
      sourceLocation: normalizeText(itemData.sourceLocation) || stockItemSnapshot?.location || '',
      originalStatus: (normalizeText(itemData.originalStatus) as StockItem['status']) || stockItemSnapshot?.status || 'Received at Site',
      stockItemSnapshot,
    };
  });

  return {
    id: normalizeText(data.id) || fallbackId,
    withdrawNo,
    projectNo,
    projectShortNo: normalizeText(data.projectShortNo) || getProjectShortNo(projectNo),
    projectName: normalizeText(data.projectName),
    type,
    status: normalizeWithdrawRecordStatus(data.status),
    requesterName: normalizeText(data.requesterName),
    requesterPhone: normalizeText(data.requesterPhone),
    issuedByUid: normalizeText(data.issuedByUid),
    issuedByName: normalizeText(data.issuedByName),
    issuedByEmail: normalizeText(data.issuedByEmail),
    withdrawDate: normalizeDateText(data.withdrawDate) || normalizeDateText(data.createdAt),
    purpose: normalizeText(data.purpose),
    dueDate: normalizeDateText(data.dueDate),
    returnedAt: normalizeDateText(data.returnedAt),
    returnedByUid: normalizeText(data.returnedByUid),
    returnedByName: normalizeText(data.returnedByName),
    returnedByEmail: normalizeText(data.returnedByEmail),
    cancelledAt: normalizeDateText(data.cancelledAt),
    cancelledByUid: normalizeText(data.cancelledByUid),
    cancelledByName: normalizeText(data.cancelledByName),
    cancelledByEmail: normalizeText(data.cancelledByEmail),
    itemReceiveNos: normalizeStringArray(data.itemReceiveNos),
    items,
    totalQty: normalizeNumber(data.totalQty, items.reduce((sum, item) => sum + item.qty, 0)),
    photoUrls: normalizeStringArray(data.photoUrls),
    createdAt: normalizeDateText(data.createdAt) || normalizeDateText(data.withdrawDate) || new Date().toISOString(),
  };
}

function normalizeLocalProject(data: Partial<Project>, fallbackId: string): Project | null {
  const projectNo = normalizeText(data.projectNo) || normalizeText((data as { jobNo?: string }).jobNo) || fallbackId;
  if (!projectNo) {
    return null;
  }

  return {
    projectId: normalizeText(data.projectId) || normalizeText((data as { id?: string }).id) || projectNo,
    projectNo,
    projectName: normalizeText(data.projectName) || normalizeText((data as { name?: string }).name),
    location: normalizeText(data.location),
    projectManager: normalizeText(data.projectManager),
    constructionManager: normalizeText(data.constructionManager),
    status: normalizeProjectStatus(data.status),
    source: 'local',
  };
}

function normalizeMasterProject(data: MasterDataProject, fallbackId: string): Project | null {
  const projectNo = normalizeText(data.jobNo) || fallbackId;
  if (!projectNo) {
    return null;
  }

  return {
    projectId: normalizeText(data.id) || projectNo,
    projectNo,
    projectName: normalizeText(data.name),
    location: normalizeText(data.location),
    projectManager: normalizeText(data.pmName),
    constructionManager: normalizeText(data.cmName),
    status: 'Active',
    source: 'master',
    lockedFields: MASTER_LOCKED_FIELDS,
  };
}

function mergeProjects(
  localProjects: Project[],
  masterProjects: Project[],
  projectStatuses: Record<string, ProjectStatus>
) {
  const merged = new Map<string, Project>();

  localProjects.forEach((project) => {
    merged.set(project.projectNo, {
      ...project,
      status: projectStatuses[project.projectNo] ?? project.status ?? 'Active',
      source: 'local',
    });
  });

  masterProjects.forEach((project) => {
    if (merged.has(project.projectNo)) {
      return;
    }

    merged.set(project.projectNo, {
      ...project,
      status: projectStatuses[project.projectNo] ?? project.status ?? 'Active',
      source: 'master',
      lockedFields: MASTER_LOCKED_FIELDS,
    });
  });

  return Array.from(merged.values()).sort((a, b) => a.projectNo.localeCompare(b.projectNo));
}

export function InventoryProvider({ children }: PropsWithChildren) {
  const { userProfile } = useAuth();
  const [items, setItems] = useState<StockItem[]>([]);
  const [receivingRequestList, setReceivingRequestList] = useState<ReceivingRequest[]>([]);
  const [localProjects, setLocalProjects] = useState<Project[]>([]);
  const [masterProjects, setMasterProjects] = useState<Project[]>([]);
  const [projectStatuses, setProjectStatuses] = useState<Record<string, ProjectStatus>>({});
  const [dispatchList, setDispatchList] = useState<DispatchRecord[]>([]);
  const [withdrawList, setWithdrawList] = useState<WithdrawRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProjectNo, setActiveProjectNo] = useState<string>('');
  const projectList = useMemo(
    () => mergeProjects(localProjects, masterProjects, projectStatuses),
    [localProjects, masterProjects, projectStatuses]
  );

  useEffect(() => {
    let unsubProjects = () => {};
    let unsubMasterProjects = () => {};
    let unsubProjectStatuses = () => {};
    let unsubStock = () => {};
    let unsubDispatch = () => {};
    let unsubWithdraw = () => {};
    let unsubReceivingRequests = () => {};

    const projectsColRef = collection(db, APP_NAME, 'root', 'projects');
    unsubProjects = onSnapshot(
      projectsColRef,
      (snapshot) => {
        const loadedProjects = snapshot.docs
          .map((projectDoc) => normalizeLocalProject(projectDoc.data() as Partial<Project>, projectDoc.id))
          .filter((project): project is Project => project !== null);
        loadedProjects.sort((a, b) => a.projectNo.localeCompare(b.projectNo));
        setLocalProjects(loadedProjects);
      },
      (error) => {
        console.error('Failed to listen to projects updates:', error);
        setLocalProjects([]);
      }
    );

    if (masterDataDb && masterDataProjectsPath) {
      const sanitizedPath = masterDataProjectsPath.replace(/^\/+|\/+$/g, '');
      const pathSegments = sanitizedPath.split('/').filter(Boolean);

      if (pathSegments.length % 2 === 1) {
        const masterProjectsColRef = collection(masterDataDb, sanitizedPath);
        unsubMasterProjects = onSnapshot(
          masterProjectsColRef,
          (snapshot) => {
            const loadedProjects = snapshot.docs
              .map((projectDoc) => normalizeMasterProject(projectDoc.data() as MasterDataProject, projectDoc.id))
              .filter((project): project is Project => project !== null);
            loadedProjects.sort((a, b) => a.projectNo.localeCompare(b.projectNo));
            setMasterProjects(loadedProjects);
          },
          (error) => {
            console.error('Failed to listen to MasterData project updates:', error);
            setMasterProjects([]);
          }
        );
      } else {
        console.error('Invalid MasterData projects path. Expected a Firestore collection path:', masterDataProjectsPath);
        setMasterProjects([]);
      }
    } else {
      setMasterProjects([]);
    }

    const projectStatusesColRef = collection(db, APP_NAME, 'root', 'projectStatuses');
    unsubProjectStatuses = onSnapshot(
      projectStatusesColRef,
      (snapshot) => {
        const loadedStatuses = snapshot.docs.reduce<Record<string, ProjectStatus>>((acc, statusDoc) => {
          const data = statusDoc.data() as DocumentData;
          acc[statusDoc.id] = normalizeProjectStatus(data.status);
          return acc;
        }, {} as Record<string, ProjectStatus>);
        setProjectStatuses(loadedStatuses);
      },
      (error) => {
        console.error('Failed to listen to project status updates:', error);
        setProjectStatuses({});
      }
    );

    const stockColRef = collection(db, APP_NAME, 'root', 'stockItems');
    unsubStock = onSnapshot(
      stockColRef,
      (snapshot) => {
        const loadedItems = snapshot.docs.map((d) => normalizeStockItem(d.data(), d.id));
        loadedItems.sort((a, b) => b.receiveNo.localeCompare(a.receiveNo));
        setItems(loadedItems);
        setLoading(false);
      },
      (error) => {
        console.error('Failed to listen to stockItems updates:', error);
        setItems([]);
        setLoading(false);
      }
    );

    const dispatchColRef = collection(db, APP_NAME, 'root', 'dispatchRecords');
    unsubDispatch = onSnapshot(
      dispatchColRef,
      (snapshot) => {
        const loadedRecords = snapshot.docs.map((d) => d.data() as DispatchRecord);
        loadedRecords.sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt));
        setDispatchList(loadedRecords);
      },
      (error) => {
        console.error('Failed to listen to dispatch updates:', error);
        setDispatchList([]);
      }
    );

    const withdrawColRef = collection(db, APP_NAME, 'root', 'withdrawRecords');
    unsubWithdraw = onSnapshot(
      withdrawColRef,
      (snapshot) => {
        const loadedRecords = snapshot.docs.map((d) => normalizeWithdrawRecord(d.data(), d.id));
        loadedRecords.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setWithdrawList(loadedRecords);
      },
      (error) => {
        console.error('Failed to listen to withdraw updates:', error);
        setWithdrawList([]);
      }
    );

    const receivingRequestsColRef = collection(db, APP_NAME, 'root', 'receivingRequests');
    unsubReceivingRequests = onSnapshot(
      receivingRequestsColRef,
      (snapshot) => {
        const loadedRequests = snapshot.docs.map((d) => normalizeReceivingRequest(d.data(), d.id));
        loadedRequests.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
        setReceivingRequestList(loadedRequests);
      },
      (error) => {
        console.error('Failed to listen to receiving request updates:', error);
        setReceivingRequestList([]);
      }
    );

    return () => {
      unsubProjects();
      unsubMasterProjects();
      unsubProjectStatuses();
      unsubStock();
      unsubDispatch();
      unsubWithdraw();
      unsubReceivingRequests();
    };
  }, []);

  const visibleProjects = useMemo(() => {
    if (!userProfile) {
      return [];
    }

    if (
      userProfile.role.includes('MasterAdmin') ||
      userProfile.role.includes('Store Center')
    ) {
      return projectList;
    }

    const assigned = userProfile.assignedProjects || [];
    return projectList.filter((proj) => assigned.includes(proj.projectNo));
  }, [projectList, userProfile]);

  const activeVisibleProjects = useMemo(
    () => visibleProjects.filter((project) => normalizeProjectStatus(project.status) === 'Active'),
    [visibleProjects]
  );

  const visibleStockItems = useMemo(() => {
    if (!userProfile) {
      return [];
    }

    if (
      userProfile.role.includes('MasterAdmin') ||
      userProfile.role.includes('Store Center')
    ) {
      return items;
    }

    const assigned = userProfile.assignedProjects || [];
    return items.filter((item) => {
      const projectNo = getStockItemProjectNo(item);
      return assigned.some((assignedProjectNo) => projectNoMatches(assignedProjectNo, projectNo));
    });
  }, [items, userProfile]);

  const visibleReceivingRequests = useMemo(() => {
    if (!userProfile) {
      return [];
    }

    if (
      userProfile.role.includes('MasterAdmin') ||
      userProfile.role.includes('Store Center')
    ) {
      return receivingRequestList;
    }

    const assigned = userProfile.assignedProjects || [];
    return receivingRequestList.filter((request) => {
      const projectNo = normalizeProjectNoFromRequest(request);
      return assigned.some((assignedProjectNo) => projectNoMatches(assignedProjectNo, projectNo));
    });
  }, [receivingRequestList, userProfile]);

  const visibleDispatchRecords = useMemo(() => {
    if (!userProfile) {
      return [];
    }

    if (
      userProfile.role.includes('MasterAdmin') ||
      userProfile.role.includes('Store Center')
    ) {
      return dispatchList;
    }

    const assigned = new Set(userProfile.assignedProjects || []);
    return dispatchList.filter(
      (record) =>
        assigned.has(record.sourceProjectNo) ||
        assigned.has(record.destinationProjectNo)
    );
  }, [dispatchList, userProfile]);

  const visibleWithdrawRecords = useMemo(() => {
    if (!userProfile) {
      return [];
    }

    if (
      userProfile.role.includes('MasterAdmin') ||
      userProfile.role.includes('Store Center')
    ) {
      return withdrawList;
    }

    const assigned = userProfile.assignedProjects || [];
    return withdrawList.filter((record) =>
      assigned.some((projectNo) => projectNoMatches(projectNo, record.projectNo))
    );
  }, [userProfile, withdrawList]);

  useEffect(() => {
    if (activeVisibleProjects.length > 0) {
      const isValid = activeVisibleProjects.some((p) => p.projectNo === activeProjectNo);
      if (!activeProjectNo || !isValid) {
        setActiveProjectNo(activeVisibleProjects[0].projectNo);
      }
    } else {
      setActiveProjectNo('');
    }
  }, [activeVisibleProjects, activeProjectNo]);

  const createDispatch = useCallback(async ({
    sourceProjectNo,
    items: selectedLines,
    projectNo,
    transport,
    note,
    photos,
  }: CreateDispatchInput) => {
    const normalizedLines = selectedLines
      .map((line) => ({
        receiveNo: line.receiveNo,
        qty: Number(line.qty),
      }))
      .filter((line) => line.receiveNo && Number.isFinite(line.qty) && line.qty > 0);

    if (!sourceProjectNo) {
      throw new Error('Please select a source project before dispatching.');
    }

    if (!projectNo) {
      throw new Error('Please select a destination project before dispatching.');
    }

    if (projectNoMatches(sourceProjectNo, projectNo)) {
      throw new Error('Destination project must be different from the source project.');
    }

    if (!normalizedLines.length) {
      throw new Error('Please select at least one item and enter dispatch qty greater than 0.');
    }
    if (new Set(normalizedLines.map((line) => line.receiveNo)).size !== normalizedLines.length) {
      throw new Error('The same stock item cannot be added to one dispatch more than once.');
    }

    const sourceProject = projectList.find((project) => projectNoMatches(project.projectNo, sourceProjectNo));
    const targetProject = projectList.find((project) => projectNoMatches(project.projectNo, projectNo));
    const normalizedSourceProjectNo = normalizeProjectNoText(sourceProjectNo);

    if (!sourceProject || !targetProject) {
      throw new Error('Source or destination project could not be found. Please refresh and try again.');
    }

    const selectedItems = normalizedLines.map((line) => {
      const sourceItem = items.find((item) => getStockItemId(item) === line.receiveNo);
      const sourceItemProjectNo = sourceItem ? getStockItemProjectNo(sourceItem) : '';

      if (
        !sourceItem
      ) {
        throw new Error(`Item ${line.receiveNo} could not be found. Please refresh and try again.`);
      }

      if (sourceItemProjectNo !== normalizedSourceProjectNo) {
        throw new Error(`Item ${sourceItem.receiveNo} is not in the active source project.`);
      }

      if (sourceItem.qty <= 0 || sourceItem.status === 'In Transit') {
        throw new Error(`Item ${sourceItem.receiveNo} is not available for dispatch.`);
      }

      if (line.qty > sourceItem.qty) {
        throw new Error(`Dispatch qty for ${sourceItem.receiveNo} is greater than available qty.`);
      }

      return {
        line,
        sourceItem,
      };
    });

    const dispatchNo = createDispatchNumber();
    const dispatchId = dispatchNo;
    const dispatchedAt = new Date().toISOString();
    const dispatchedByName = formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? 'Store Center'
    );
    const dispatchedByEmail = userProfile?.email ?? 'unknown@cmg.local';
    const photoUrls = await Promise.all(
      photos.map(async (photo, index) => {
        const storageRef = ref(
          storage,
          `dispatchRecords/${dispatchNo}/${String(index + 1).padStart(2, '0')}-${sanitizeFileName(photo.name)}`
        );
        await uploadBytes(storageRef, photo);
        return getDownloadURL(storageRef);
      })
    );

    const dispatchRef = doc(db, APP_NAME, 'root', 'dispatchRecords', dispatchId);
    await runTransaction(db, async (transaction) => {
      const sourceRefs = selectedItems.map(({ sourceItem }) => (
        doc(db, APP_NAME, 'root', 'stockItems', getStockItemId(sourceItem))
      ));
      const sourceSnapshots = await Promise.all(sourceRefs.map((sourceRef) => transaction.get(sourceRef)));
      const dispatchSnapshots = selectedItems.map(({ line }, index) => {
        const sourceSnapshot = sourceSnapshots[index];
        if (!sourceSnapshot.exists()) {
          throw new Error(`Item ${line.receiveNo} could not be found. Please refresh and try again.`);
        }

        const currentSourceItem = normalizeStockItem(sourceSnapshot.data(), sourceSnapshot.id);
        if (getStockItemProjectNo(currentSourceItem) !== normalizedSourceProjectNo) {
          throw new Error(`Item ${currentSourceItem.receiveNo} is not in the active source project.`);
        }
        if (currentSourceItem.qty <= 0 || currentSourceItem.status === 'In Transit') {
          throw new Error(`Item ${currentSourceItem.receiveNo} is not available for dispatch.`);
        }
        if (line.qty > currentSourceItem.qty) {
          throw new Error(`Dispatch qty for ${currentSourceItem.receiveNo} is greater than available qty.`);
        }

        const sourceStockItemId = getStockItemId(currentSourceItem);
        const stockReceiveNo = createDispatchStockReceiveNo(sourceStockItemId, dispatchNo, index);
        const dispatchedAmount = calculatePartialAmount(currentSourceItem.amount, currentSourceItem.qty, line.qty);

        return {
          sourceItem: currentSourceItem,
          sourceStockItemId,
          receiveNo: currentSourceItem.receiveNo,
          stockItemId: stockReceiveNo,
          stockReceiveNo,
          prNo: currentSourceItem.prNo,
          poNo: currentSourceItem.poNo,
          itemNo: currentSourceItem.itemNo,
          itemDescription: currentSourceItem.itemDescription,
          materialNo: getStockItemMaterialNo(currentSourceItem),
          unit: currentSourceItem.unit,
          amount: dispatchedAmount,
          qty: line.qty,
          vendorName: currentSourceItem.vendorName,
          sourceLocation: currentSourceItem.location,
        };
      });

      dispatchSnapshots.forEach(({ sourceItem, sourceStockItemId, amount, ...snapshot }) => {
        const sourceRef = doc(db, APP_NAME, 'root', 'stockItems', sourceStockItemId);
        const transitRef = doc(db, APP_NAME, 'root', 'stockItems', snapshot.stockReceiveNo);
        const remainingQty = sourceItem.qty - snapshot.qty;
        const remainingAmount = roundAmount(sourceItem.amount - amount);

        transaction.update(sourceRef, {
          qty: Math.max(0, remainingQty),
          amount: Math.max(0, remainingAmount),
          lastDispatchNo: dispatchNo,
          lastDispatchedAt: dispatchedAt,
        });
        transaction.set(
          transitRef,
          stripUndefined({
            ...sourceItem,
            stockItemId: snapshot.stockReceiveNo,
            receiveNo: snapshot.stockReceiveNo,
            sourceStockItemId,
            qty: snapshot.qty,
            amount,
            location: createTransitLocation(targetProject.projectNo),
            purchasedForProject: createProjectLabel(targetProject.projectNo),
            cmgProjectCode: normalizeProjectNoText(targetProject.projectNo),
            status: 'In Transit',
            lastDispatchNo: dispatchNo,
            lastDispatchedAt: dispatchedAt,
          })
        );
      });

      const record: DispatchRecord = {
        id: dispatchId,
        dispatchNo,
        sourceProjectNo: sourceProject.projectNo,
        sourceProjectName: sourceProject.projectName,
        destinationProjectNo: targetProject.projectNo,
        destinationProjectName: targetProject.projectName,
        status: 'Pending Receipt',
        itemReceiveNos: dispatchSnapshots.map((item) => item.stockReceiveNo),
        items: dispatchSnapshots.map(({ sourceItem: _sourceItem, ...snapshot }) => snapshot),
        totalQty: dispatchSnapshots.reduce((sum, item) => sum + item.qty, 0),
        transport: transport.trim(),
        note: note.trim(),
        photoUrls,
        dispatchedAt,
        dispatchedByName,
        dispatchedByEmail,
      };

      transaction.set(dispatchRef, stripUndefined(record));
    });
  }, [items, projectList, userProfile]);

  const cancelDispatch = useCallback(async (dispatchId: string) => {
    const target = dispatchList.find((record) => record.id === dispatchId);
    if (!target || target.status !== 'Pending Receipt') {
      return;
    }

    const cancelledAt = new Date().toISOString();
    const cancelledByName = formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? 'Store Center'
    );
    const cancelledByEmail = userProfile?.email ?? 'unknown@cmg.local';
    const cancelledByUid = userProfile?.uid ?? '';
    const dispatchRef = doc(db, APP_NAME, 'root', 'dispatchRecords', dispatchId);

    await runTransaction(db, async (transaction) => {
      const dispatchSnapshot = await transaction.get(dispatchRef);
      if (!dispatchSnapshot.exists()) {
        throw new Error(`Dispatch ${dispatchId} could not be found.`);
      }
      if (normalizeText(dispatchSnapshot.data().status) !== 'Pending Receipt') {
        throw new Error('This dispatch can no longer be cancelled.');
      }

      const stockIds = Array.from(new Set(target.items.flatMap((item) => [
        item.sourceStockItemId || item.stockItemId || item.receiveNo,
        item.stockReceiveNo,
      ])));
      const stockSnapshots = await Promise.all(
        stockIds.map((stockItemId) => transaction.get(doc(db, APP_NAME, 'root', 'stockItems', stockItemId)))
      );
      const stockSnapshotById = new Map(stockIds.map((stockItemId, index) => [stockItemId, stockSnapshots[index]]));

      target.items.forEach((item) => {
        const sourceStockItemId = item.sourceStockItemId || item.stockItemId || item.receiveNo;
        const sourceSnapshot = stockSnapshotById.get(sourceStockItemId);
        const transitSnapshot = stockSnapshotById.get(item.stockReceiveNo);

        if (!transitSnapshot?.exists()) {
          throw new Error(`In-transit item ${item.stockReceiveNo} could not be found.`);
        }

        const transitItem = normalizeStockItem(transitSnapshot.data(), transitSnapshot.id);
        const sourceItem = sourceSnapshot?.exists()
          ? normalizeStockItem(sourceSnapshot.data(), sourceSnapshot.id)
          : undefined;
        const sourceRef = doc(db, APP_NAME, 'root', 'stockItems', sourceStockItemId);

        transaction.set(
          sourceRef,
          stripUndefined({
            ...(sourceItem ?? transitItem),
            stockItemId: sourceStockItemId,
            receiveNo: sourceItem?.receiveNo || item.receiveNo,
            qty: (sourceItem?.qty ?? 0) + transitItem.qty,
            amount: roundAmount((sourceItem?.amount ?? 0) + transitItem.amount),
            location: sourceItem?.location || item.sourceLocation,
            purchasedForProject: sourceItem?.purchasedForProject || createProjectLabel(target.sourceProjectNo),
            cmgProjectCode: sourceItem?.cmgProjectCode || normalizeProjectNoText(target.sourceProjectNo),
            status: sourceItem?.status === 'In Transit' ? 'Received at Site' : (sourceItem?.status ?? 'Received at Site'),
            lastCancelledDispatchNo: target.dispatchNo,
            lastCancelledDispatchAt: cancelledAt,
          }),
          { merge: true }
        );
        transaction.delete(doc(db, APP_NAME, 'root', 'stockItems', item.stockReceiveNo));
      });

      transaction.set(
        dispatchRef,
        {
          status: 'Dispatch Cancelled',
          cancelledAt,
          cancelledByUid,
          cancelledByName,
          cancelledByEmail,
        },
        { merge: true }
      );
    });
  }, [dispatchList, userProfile]);

  const createWithdraw = useCallback(async ({
    projectNo,
    type,
    items: selectedLines,
    requesterName,
    requesterPhone,
    withdrawDate,
    purpose,
    dueDate,
    photos,
  }: CreateWithdrawInput) => {
    const normalizedProjectNo = normalizeProjectNoText(projectNo);
    const normalizedType = normalizeWithdrawType(type);
    const normalizedLines = selectedLines
      .map((line) => ({
        receiveNo: line.receiveNo,
        qty: Number(line.qty),
      }))
      .filter((line) => line.receiveNo && Number.isFinite(line.qty) && line.qty > 0);

    if (!normalizedProjectNo) {
      throw new Error('Please select an active project before creating a withdrawal.');
    }

    const sourceProject = visibleProjects.find((project) => projectNoMatches(project.projectNo, normalizedProjectNo));
    if (!sourceProject) {
      throw new Error('You can create withdrawals only for projects assigned to your account.');
    }

    if (!requesterName.trim()) {
      throw new Error('Please enter the requester or responsible person.');
    }

    if (!requesterPhone.trim()) {
      throw new Error('Please enter the requester phone number.');
    }

    if (!withdrawDate.trim()) {
      throw new Error('Please select the withdrawal date.');
    }

    if (!purpose.trim()) {
      throw new Error('Please enter the withdrawal purpose.');
    }

    if (normalizedType === 'borrow' && !dueDate?.trim()) {
      throw new Error('Please select the return due date for borrowed items.');
    }

    if (!normalizedLines.length) {
      throw new Error('Please select at least one item and enter withdraw qty greater than 0.');
    }
    if (new Set(normalizedLines.map((line) => line.receiveNo)).size !== normalizedLines.length) {
      throw new Error('The same stock item cannot be added to one withdrawal more than once.');
    }

    const selectedItems = normalizedLines.map((line) => {
      const sourceItem = items.find((item) => getStockItemId(item) === line.receiveNo);
      const sourceItemProjectNo = sourceItem ? getStockItemProjectNo(sourceItem) : '';

      if (!sourceItem) {
        throw new Error(`Item ${line.receiveNo} could not be found. Please refresh and try again.`);
      }

      if (sourceItemProjectNo !== normalizedProjectNo) {
        throw new Error(`Item ${sourceItem.receiveNo} is not in the active project store.`);
      }

      if (
        sourceItem.qty <= 0 ||
        sourceItem.status === 'In Transit' ||
        sourceItem.status === 'Borrowed' ||
        sourceItem.status === 'Withdrawn'
      ) {
        throw new Error(`Item ${sourceItem.receiveNo} is not available for withdrawal.`);
      }

      if (line.qty > sourceItem.qty) {
        throw new Error(`Withdraw qty for ${sourceItem.receiveNo} is greater than available qty.`);
      }

      return {
        line,
        sourceItem,
      };
    });

    const withdrawNo = createWithdrawNumber(sourceProject.projectNo);
    const withdrawId = withdrawNo;
    const createdAt = new Date().toISOString();
    const issuedByName = formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? 'Store Issuer'
    );
    const issuedByEmail = userProfile?.email ?? 'unknown@cmg.local';
    const issuedByUid = userProfile?.uid ?? '';
    const photoUrls = await Promise.all(
      photos.map(async (photo, index) => {
        const storageRef = ref(
          storage,
          `withdrawRecords/${withdrawNo}/${String(index + 1).padStart(2, '0')}-${sanitizeFileName(photo.name)}`
        );
        await uploadBytes(storageRef, photo);
        return getDownloadURL(storageRef);
      })
    );

    const withdrawRef = doc(db, APP_NAME, 'root', 'withdrawRecords', withdrawId);
    await runTransaction(db, async (transaction) => {
      const sourceRefs = selectedItems.map(({ sourceItem }) => (
        doc(db, APP_NAME, 'root', 'stockItems', getStockItemId(sourceItem))
      ));
      const sourceSnapshots = await Promise.all(sourceRefs.map((sourceRef) => transaction.get(sourceRef)));
      const withdrawSnapshots = selectedItems.map(({ line }, index) => {
        const sourceSnapshot = sourceSnapshots[index];
        if (!sourceSnapshot.exists()) {
          throw new Error(`Item ${line.receiveNo} could not be found. Please refresh and try again.`);
        }

        const sourceItem = normalizeStockItem(sourceSnapshot.data(), sourceSnapshot.id);
        if (getStockItemProjectNo(sourceItem) !== normalizedProjectNo) {
          throw new Error(`Item ${sourceItem.receiveNo} is not in the active project store.`);
        }
        if (
          sourceItem.qty <= 0 ||
          sourceItem.status === 'In Transit' ||
          sourceItem.status === 'Borrowed' ||
          sourceItem.status === 'Withdrawn'
        ) {
          throw new Error(`Item ${sourceItem.receiveNo} is not available for withdrawal.`);
        }
        if (line.qty > sourceItem.qty) {
          throw new Error(`Withdraw qty for ${sourceItem.receiveNo} is greater than available qty.`);
        }

        const stockItemId = getStockItemId(sourceItem);
        const withdrawAmount = calculatePartialAmount(sourceItem.amount, sourceItem.qty, line.qty);
        const remainingQty = sourceItem.qty - line.qty;
        const remainingAmount = roundAmount(sourceItem.amount - withdrawAmount);

        transaction.update(sourceRefs[index], {
          qty: Math.max(0, remainingQty),
          amount: Math.max(0, remainingAmount),
          status:
            remainingQty <= 0
              ? normalizedType === 'borrow'
                ? 'Borrowed'
                : 'Withdrawn'
              : sourceItem.status,
          lastWithdrawNo: withdrawNo,
          lastWithdrawAt: createdAt,
        });

        return {
          stockItemId,
          receiveNo: sourceItem.receiveNo,
          prNo: sourceItem.prNo,
          poNo: sourceItem.poNo,
          itemNo: sourceItem.itemNo,
          itemDescription: sourceItem.itemDescription,
          qty: line.qty,
          returnedQty: normalizedType === 'borrow' ? 0 : undefined,
          amount: withdrawAmount,
          unit: sourceItem.unit,
          vendorName: sourceItem.vendorName,
          sourceLocation: sourceItem.location,
          originalStatus: sourceItem.status,
          stockItemSnapshot: sourceItem,
        };
      });
      const record: WithdrawRecord = {
        id: withdrawId,
        withdrawNo,
        projectNo: sourceProject.projectNo,
        projectShortNo: getProjectShortNo(sourceProject.projectNo),
        projectName: sourceProject.projectName,
        type: normalizedType,
        status: normalizedType === 'borrow' ? 'Waiting Return' : 'Issued',
        requesterName: requesterName.trim(),
        requesterPhone: requesterPhone.trim(),
        issuedByUid,
        issuedByName,
        issuedByEmail,
        withdrawDate: withdrawDate.trim(),
        purpose: purpose.trim(),
        dueDate: normalizedType === 'borrow' ? dueDate?.trim() : undefined,
        itemReceiveNos: withdrawSnapshots.map((item) => item.stockItemId),
        items: withdrawSnapshots,
        totalQty: withdrawSnapshots.reduce((sum, item) => sum + item.qty, 0),
        photoUrls,
        createdAt,
      };

      transaction.set(withdrawRef, stripUndefined(record));
    });
  }, [items, userProfile, visibleProjects]);

  const returnWithdraw = useCallback(async (withdrawId: string) => {
    const target = withdrawList.find((record) => record.id === withdrawId);

    if (!target || target.type !== 'borrow' || target.status === 'Returned') {
      return;
    }

    const returnedAt = new Date().toISOString();
    const returnedByName = formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? 'Store Receiver'
    );
    const returnedByEmail = userProfile?.email ?? 'unknown@cmg.local';
    const returnedByUid = userProfile?.uid ?? '';
    const withdrawRef = doc(db, APP_NAME, 'root', 'withdrawRecords', target.id);
    const restorations = target.items.map((item) => {
      const exactItem = items.find((stockItem) => (
        getStockItemId(stockItem) === item.stockItemId &&
        getStockItemProjectNo(stockItem) === normalizeProjectNoText(target.projectNo)
      ));
      const materialNo = getStockItemMaterialNo(item.stockItemSnapshot ?? {
        materialNo: undefined,
        itemNo: item.itemNo,
      });
      const identityItem = exactItem ?? findStockItemByIdentity(items, target.projectNo, materialNo);
      return {
        item,
        stockItemId:
          (identityItem ? getStockItemId(identityItem) : '') ||
          createStockIdentityDocumentId(normalizeProjectNoText(target.projectNo), materialNo) ||
          item.stockItemId,
      };
    });

    await runTransaction(db, async (transaction) => {
      const withdrawSnapshot = await transaction.get(withdrawRef);
      if (!withdrawSnapshot.exists()) {
        throw new Error(`Withdraw record ${target.withdrawNo} could not be found.`);
      }
      const withdrawData = withdrawSnapshot.data() as DocumentData;
      const currentStatus = normalizeWithdrawRecordStatus(withdrawData.status);
      if (normalizeWithdrawType(withdrawData.type) !== 'borrow' || currentStatus === 'Returned' || currentStatus === 'Cancelled') {
        return;
      }

      const restorationGroups = restorations.reduce((acc, restoration) => {
        const grouped = acc.get(restoration.stockItemId) ?? [];
        grouped.push(restoration.item);
        acc.set(restoration.stockItemId, grouped);
        return acc;
      }, new Map<string, Array<typeof target.items[number]>>());
      const stockEntries = Array.from(restorationGroups.entries());
      const stockSnapshots = await Promise.all(
        stockEntries.map(([stockItemId]) => (
          transaction.get(doc(db, APP_NAME, 'root', 'stockItems', stockItemId))
        ))
      );

      stockEntries.forEach(([stockItemId, groupedItems], index) => {
        const stockSnapshot = stockSnapshots[index];
        const existingStockItem = stockSnapshot.exists()
          ? normalizeStockItem(stockSnapshot.data(), stockSnapshot.id)
          : undefined;
        const baseItem = groupedItems[0];
        const snapshot = baseItem.stockItemSnapshot;
        if (!existingStockItem && !snapshot) {
          throw new Error(`Original stock item ${baseItem.receiveNo} could not be restored. Please contact admin.`);
        }

        const qtyToRestore = groupedItems.reduce((sum, item) => sum + item.qty, 0);
        const amountToRestore = groupedItems.reduce((sum, item) => sum + item.amount, 0);
        const restoredStatus =
          baseItem.originalStatus === 'Borrowed' || baseItem.originalStatus === 'Withdrawn'
            ? 'Received at Site'
            : baseItem.originalStatus;

        transaction.set(
          doc(db, APP_NAME, 'root', 'stockItems', stockItemId),
          stripUndefined({
            ...(!existingStockItem ? snapshot : {}),
            stockItemId,
            receiveNo: existingStockItem?.receiveNo || baseItem.receiveNo,
            qty: (existingStockItem?.qty ?? 0) + qtyToRestore,
            amount: roundAmount((existingStockItem?.amount ?? 0) + amountToRestore),
            status:
              !existingStockItem ||
              existingStockItem.status === 'Borrowed' ||
              existingStockItem.status === 'Withdrawn' ||
              existingStockItem.qty <= 0
                ? restoredStatus
                : existingStockItem.status,
            location: existingStockItem?.location || baseItem.sourceLocation || snapshot?.location,
            cmgProjectCode: normalizeProjectNoText(target.projectNo),
            materialNo: snapshot ? getStockItemMaterialNo(snapshot) : existingStockItem?.materialNo,
            lastReturnedWithdrawNo: target.withdrawNo,
            lastReturnedAt: returnedAt,
          }),
          { merge: true }
        );
      });

      transaction.set(
        withdrawRef,
        stripUndefined({
          status: 'Returned',
          returnedAt,
          returnedByUid,
          returnedByName,
          returnedByEmail,
          items: target.items.map((item) => ({ ...item, returnedQty: item.qty })),
        }),
        { merge: true }
      );
    });
  }, [items, userProfile, withdrawList]);

  const cancelWithdraw = useCallback(async (withdrawId: string) => {
    const target = withdrawList.find((record) => record.id === withdrawId);

    if (!target || target.status === 'Returned' || target.status === 'Cancelled') {
      return;
    }

    const cancelledAt = new Date().toISOString();
    const cancelledByName = formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? 'Store User'
    );
    const cancelledByEmail = userProfile?.email ?? 'unknown@cmg.local';
    const cancelledByUid = userProfile?.uid ?? '';
    const withdrawRef = doc(db, APP_NAME, 'root', 'withdrawRecords', target.id);
    const restorations = target.items.map((item) => {
      const exactItem = items.find((stockItem) => (
        getStockItemId(stockItem) === item.stockItemId &&
        getStockItemProjectNo(stockItem) === normalizeProjectNoText(target.projectNo)
      ));
      const materialNo = getStockItemMaterialNo(item.stockItemSnapshot ?? {
        materialNo: undefined,
        itemNo: item.itemNo,
      });
      const identityItem = exactItem ?? findStockItemByIdentity(items, target.projectNo, materialNo);
      return {
        item,
        stockItemId:
          (identityItem ? getStockItemId(identityItem) : '') ||
          createStockIdentityDocumentId(normalizeProjectNoText(target.projectNo), materialNo) ||
          item.stockItemId,
      };
    });

    await runTransaction(db, async (transaction) => {
      const withdrawSnapshot = await transaction.get(withdrawRef);
      if (!withdrawSnapshot.exists()) {
        throw new Error(`Withdraw record ${target.withdrawNo} could not be found.`);
      }
      const currentStatus = normalizeWithdrawRecordStatus(withdrawSnapshot.data().status);
      if (currentStatus === 'Returned' || currentStatus === 'Cancelled') {
        return;
      }

      const restorationGroups = restorations.reduce((acc, restoration) => {
        const grouped = acc.get(restoration.stockItemId) ?? [];
        grouped.push(restoration.item);
        acc.set(restoration.stockItemId, grouped);
        return acc;
      }, new Map<string, Array<typeof target.items[number]>>());
      const stockEntries = Array.from(restorationGroups.entries());
      const stockSnapshots = await Promise.all(
        stockEntries.map(([stockItemId]) => (
          transaction.get(doc(db, APP_NAME, 'root', 'stockItems', stockItemId))
        ))
      );

      stockEntries.forEach(([stockItemId, groupedItems], index) => {
        const stockSnapshot = stockSnapshots[index];
        const existingStockItem = stockSnapshot.exists()
          ? normalizeStockItem(stockSnapshot.data(), stockSnapshot.id)
          : undefined;
        const baseItem = groupedItems[0];
        const snapshot = baseItem.stockItemSnapshot;
        if (!existingStockItem && !snapshot) {
          throw new Error(`Original stock item ${baseItem.receiveNo} could not be restored. Please contact admin.`);
        }

        const qtyToRestore = groupedItems.reduce((sum, item) => sum + item.qty, 0);
        const amountToRestore = groupedItems.reduce((sum, item) => sum + item.amount, 0);
        const restoredStatus =
          baseItem.originalStatus === 'Borrowed' || baseItem.originalStatus === 'Withdrawn'
            ? 'Received at Site'
            : baseItem.originalStatus;

        transaction.set(
          doc(db, APP_NAME, 'root', 'stockItems', stockItemId),
          stripUndefined({
            ...(!existingStockItem ? snapshot : {}),
            stockItemId,
            receiveNo: existingStockItem?.receiveNo || baseItem.receiveNo,
            qty: (existingStockItem?.qty ?? 0) + qtyToRestore,
            amount: roundAmount((existingStockItem?.amount ?? 0) + amountToRestore),
            status:
              !existingStockItem ||
              existingStockItem.status === 'Borrowed' ||
              existingStockItem.status === 'Withdrawn' ||
              existingStockItem.qty <= 0
                ? restoredStatus
                : existingStockItem.status,
            location: existingStockItem?.location || baseItem.sourceLocation || snapshot?.location,
            cmgProjectCode: normalizeProjectNoText(target.projectNo),
            materialNo: snapshot ? getStockItemMaterialNo(snapshot) : existingStockItem?.materialNo,
            lastCancelledWithdrawNo: target.withdrawNo,
            lastCancelledAt: cancelledAt,
          }),
          { merge: true }
        );
      });

      transaction.set(
        withdrawRef,
        {
          status: 'Cancelled',
          cancelledAt,
          cancelledByUid,
          cancelledByName,
          cancelledByEmail,
        },
        { merge: true }
      );
    });
  }, [items, userProfile, withdrawList]);

  const receiveDispatch = useCallback(async (dispatchId: string, receivedItems?: ReceiveDispatchLineInput[]) => {
    const target = dispatchList.find((record) => record.id === dispatchId);
    if (!target || target.status === 'Received at Site' || target.status === 'Dispatch Cancelled') {
      return;
    }

    const receivedQtyByItem = new Map(
      (receivedItems ?? []).map((item) => [item.stockReceiveNo, Math.max(0, Math.floor(item.receivedQty))])
    );
    const receivedAt = new Date().toISOString();
    const receivedByName = formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? 'Site Receiver'
    );
    const receivedByEmail = userProfile?.email ?? 'unknown@cmg.local';
    const receivedByUid = userProfile?.uid ?? '';

    const dispatchRef = doc(db, APP_NAME, 'root', 'dispatchRecords', dispatchId);
    const destinationProjectNo = normalizeProjectNoText(target.destinationProjectNo);
    const transitIds = target.items.map((item) => item.stockReceiveNo);
    const plans = target.items.map((item) => {
      const transitStockItem = items.find((stockItem) => getStockItemId(stockItem) === item.stockReceiveNo);
      const materialNo = normalizeMaterialNo(item.materialNo || transitStockItem?.materialNo || item.itemNo);
      const existingDestinationItem = findStockItemByIdentity(
        items,
        destinationProjectNo,
        materialNo,
        transitIds,
      );
      const destinationStockItemId = existingDestinationItem
        ? getStockItemId(existingDestinationItem)
        : createStockIdentityDocumentId(destinationProjectNo, materialNo) || item.stockReceiveNo;

      return { item, materialNo, destinationStockItemId };
    });

    await runTransaction(db, async (transaction) => {
      const dispatchSnapshot = await transaction.get(dispatchRef);
      if (!dispatchSnapshot.exists()) {
        throw new Error(`Dispatch ${dispatchId} could not be found.`);
      }
      if (normalizeText(dispatchSnapshot.data().status) !== 'Pending Receipt') {
        return;
      }

      const uniqueTransitIds = Array.from(new Set(plans.map((plan) => plan.item.stockReceiveNo)));
      const uniqueDestinationIds = Array.from(new Set(plans.map((plan) => plan.destinationStockItemId)));
      const allStockIds = Array.from(new Set([...uniqueTransitIds, ...uniqueDestinationIds]));
      const allStockSnapshots = await Promise.all(
        allStockIds.map((stockItemId) => (
          transaction.get(doc(db, APP_NAME, 'root', 'stockItems', stockItemId))
        ))
      );
      const stockSnapshotById = new Map(
        allStockIds.map((stockItemId, index) => [stockItemId, allStockSnapshots[index]])
      );
      const destinationGroups = new Map<string, Array<{
        plan: typeof plans[number];
        transitStockItem: StockItem;
        receivedQty: number;
        receivedAmount: number;
      }>>();
      let totalReceivedQty = 0;

      const receivedSnapshots = plans.map((plan) => {
        const transitSnapshot = stockSnapshotById.get(plan.item.stockReceiveNo);
        if (!transitSnapshot?.exists()) {
          throw new Error(`In-transit stock item ${plan.item.stockReceiveNo} could not be found.`);
        }

        const transitStockItem = normalizeStockItem(transitSnapshot.data(), transitSnapshot.id);
        const requestedQty = plan.item.qty;
        const receivedQty = Math.min(
          requestedQty,
          receivedQtyByItem.get(plan.item.stockReceiveNo) ?? requestedQty
        );
        const receivedAmount = calculatePartialAmount(
          transitStockItem.amount,
          transitStockItem.qty,
          receivedQty,
        );

        totalReceivedQty += receivedQty;
        if (receivedQty > 0) {
          const grouped = destinationGroups.get(plan.destinationStockItemId) ?? [];
          grouped.push({ plan, transitStockItem, receivedQty, receivedAmount });
          destinationGroups.set(plan.destinationStockItemId, grouped);
        }

        return {
          ...plan.item,
          materialNo: plan.materialNo,
          destinationStockItemId: receivedQty > 0 ? plan.destinationStockItemId : undefined,
          receivedQty,
        };
      });

      destinationGroups.forEach((groupedPlans, destinationStockItemId) => {
        const destinationSnapshot = stockSnapshotById.get(destinationStockItemId);
        const destinationIsTransitItem = groupedPlans.some(
          ({ plan }) => plan.item.stockReceiveNo === destinationStockItemId
        );
        const existingDestinationItem = destinationSnapshot?.exists() && !destinationIsTransitItem
          ? normalizeStockItem(destinationSnapshot.data(), destinationSnapshot.id)
          : undefined;
        const base = groupedPlans[0];
        const qtyToAdd = groupedPlans.reduce((sum, entry) => sum + entry.receivedQty, 0);
        const amountToAdd = groupedPlans.reduce((sum, entry) => sum + entry.receivedAmount, 0);
        const destinationRef = doc(db, APP_NAME, 'root', 'stockItems', destinationStockItemId);

        transaction.set(
          destinationRef,
          stripUndefined({
            ...(!existingDestinationItem ? base.transitStockItem : {}),
            stockItemId: destinationStockItemId,
            receiveNo:
              existingDestinationItem?.receiveNo ||
              base.plan.item.receiveNo ||
              base.transitStockItem.sourceReceiveNo ||
              destinationStockItemId,
            qty: (existingDestinationItem?.qty ?? 0) + qtyToAdd,
            amount: roundAmount((existingDestinationItem?.amount ?? 0) + amountToAdd),
            materialNo: base.plan.materialNo,
            status: 'Received at Site',
            location: createProjectStoreLocation(target.destinationProjectNo),
            purchasedForProject: createProjectLabel(target.destinationProjectNo),
            projectId: target.destinationProjectNo,
            cmgProjectCode: destinationProjectNo,
            receiveName: receivedByName,
            receivedByUid,
            receivedByName,
            receivedByEmail,
            lastReceivedAt: receivedAt,
            lastDispatchNo: target.dispatchNo,
          }),
          { merge: true }
        );
      });

      uniqueTransitIds.forEach((transitId) => {
        const isDestination = destinationGroups.has(transitId);
        if (!isDestination) {
          transaction.delete(doc(db, APP_NAME, 'root', 'stockItems', transitId));
        }
      });

      transaction.set(
        dispatchRef,
        {
          status: 'Received at Site',
          receivedAt,
          receivedByName,
          receivedByEmail,
          items: receivedSnapshots,
          totalReceivedQty,
        },
        { merge: true }
      );
    });
  }, [dispatchList, items, userProfile]);

  const approveReceivingRequest = useCallback(async (requestId: string, receivedItems?: ApproveReceivingRequestLineInput[]) => {
    const target = receivingRequestList.find(
      (request) => request.id === requestId && request.requestStatus === 'pending'
    );

    if (!target || !target.items.length) {
      return;
    }

    const requestedItemByIndex = new Map(
      (receivedItems ?? []).map((item) => [item.itemIndex, item])
    );
    const receivingItems = target.items.map((item, index) => {
      const requestedItem = requestedItemByIndex.get(index);
      const requestedQty = requestedItem?.receivedQty;
      const receivedQty = requestedQty === undefined ? item.receivedQty : requestedQty;
      const itemType = requestedItem?.itemType?.trim() || item.itemType;
      const itemTypeGroup = requestedItem?.itemTypeGroup || item.itemTypeGroup;

      if (!Number.isInteger(receivedQty) || receivedQty < 0 || receivedQty > item.receivedQty) {
        throw new Error(`Received quantity for ${item.itemDescription || item.itemNo} must be between 0 and ${item.receivedQty}.`);
      }

      return {
        item,
        index,
        receivedQty,
        amount: calculatePartialAmount(item.amount, item.receivedQty, receivedQty),
        itemType,
        itemTypeGroup,
      };
    });

    if (!receivingItems.some((entry) => entry.receivedQty > 0)) {
      throw new Error('Please enter a received quantity greater than 0 for at least one item.');
    }

    const projectNo = normalizeProjectNoText(
      target.cmgProjectCode ||
      target.projectItemCode ||
      target.projectNo ||
      target.projectId ||
      extractProjectNo(target.projectName)
    );
    const cmgProjectCode = normalizeCmgProjectCode(
      target.cmgProjectCode,
      target.projectItemCode,
      target.projectNo,
      target.projectId,
    );
    if (!projectNo || !cmgProjectCode) {
      throw new Error(`Receiving request ${target.id} does not have a valid project number.`);
    }

    const location = target.location || (projectNo ? createProjectStoreLocation(projectNo) : 'Store Center');
    const stockStatus: StockItem['status'] = location === 'Store Center' ? 'Pending Dispatch' : 'Received at Site';
    const approvedAt = new Date().toISOString();
    const approvedByName = formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? 'Store Receiver'
    );
    const approvedByEmail = userProfile?.email ?? 'unknown@cmg.local';
    const approvedByUid = userProfile?.uid ?? '';
    const requestRef = doc(db, APP_NAME, 'root', 'receivingRequests', target.id);
    const assignments = receivingItems
      .filter((entry) => entry.receivedQty > 0)
      .map(({ item: sourceItem, index, receivedQty, amount, itemType, itemTypeGroup }) => {
      const item = {
        ...sourceItem,
        receivedQty,
        amount,
        itemType,
        itemTypeGroup,
      };
      const materialNo = normalizeMaterialNo(item.materialNo || item.itemNo);
      const existingStockItem = findStockItemByIdentity(items, cmgProjectCode, materialNo);
      const deterministicId = createStockIdentityDocumentId(cmgProjectCode, materialNo);
      const stockItemId = existingStockItem
        ? getStockItemId(existingStockItem)
        : deterministicId || createReceivingStockReceiveNo(target, item, index);

        return { item, index, materialNo, stockItemId };
      });
    const assignmentsByStockId = assignments.reduce((acc, assignment) => {
      const grouped = acc.get(assignment.stockItemId) ?? [];
      grouped.push(assignment);
      acc.set(assignment.stockItemId, grouped);
      return acc;
    }, new Map<string, typeof assignments>());

    await runTransaction(db, async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists()) {
        throw new Error(`Receiving request ${target.id} could not be found.`);
      }

      const requestData = requestSnapshot.data() as DocumentData;
      if (normalizeReceivingRequestStatus(requestData.requestStatus ?? requestData.status) !== 'pending') {
        return;
      }

      const stockEntries = Array.from(assignmentsByStockId.entries());
      const stockSnapshots = await Promise.all(
        stockEntries.map(([stockItemId]) => (
          transaction.get(doc(db, APP_NAME, 'root', 'stockItems', stockItemId))
        ))
      );

      stockEntries.forEach(([stockItemId, groupedAssignments], stockIndex) => {
        const stockSnapshot = stockSnapshots[stockIndex];
        const existingStockItem = stockSnapshot.exists()
          ? normalizeStockItem(stockSnapshot.data(), stockSnapshot.id)
          : undefined;
        const firstItem = groupedAssignments[0].item;
        const qtyToAdd = groupedAssignments.reduce((sum, assignment) => sum + assignment.item.receivedQty, 0);
        const amountToAdd = groupedAssignments.reduce((sum, assignment) => sum + assignment.item.amount, 0);
        const stockRef = doc(db, APP_NAME, 'root', 'stockItems', stockItemId);

        transaction.set(
          stockRef,
          stripUndefined({
            stockItemId,
            receiveNo: existingStockItem?.receiveNo || target.receiveNo || stockItemId,
            sourceReceiveNo: target.receiveNo,
            poNo: target.poNo,
            prNo: target.prNo,
            poType: target.poType,
            itemNo: firstItem.itemNo || groupedAssignments[0].materialNo,
            itemDescription: firstItem.itemDescription,
            materialNo: groupedAssignments[0].materialNo,
            unit: firstItem.unit,
            itemType: firstItem.itemType,
            itemTypeGroup: firstItem.itemTypeGroup,
            orderedQty: firstItem.orderedQty,
            unitPrice: firstItem.price,
            amount: roundAmount((existingStockItem?.amount ?? 0) + amountToAdd),
            qty: (existingStockItem?.qty ?? 0) + qtyToAdd,
            vendorName: target.vendorName,
            location,
            purchasedForProject: createProjectLabel(projectNo),
            projectId: target.projectId || projectNo,
            cmgProjectCode,
            receiveName: target.receiveName || approvedByName,
            receiveDate: target.receiveDate,
            receivedByUid: approvedByUid,
            receivedByName: approvedByName,
            receivedByEmail: approvedByEmail,
            lastReceiveEventId: target.id,
            lastReceivedQty: qtyToAdd,
            lastReceivedAt: approvedAt,
            status: stockStatus,
          }),
          { merge: true }
        );
      });

      const rawItems = parseReceivingItems(requestData.items);
      let activeItemIndex = 0;
      const updatedItems = rawItems.map((rawItem, rawItemIndex) => {
        const rawItemData = rawItem && typeof rawItem === 'object'
          ? rawItem as DocumentData
          : ({} as DocumentData);
        const normalizedRawItem = normalizeReceivingRequestItem(rawItemData, rawItemIndex);
        if (normalizedRawItem.receivedQty <= 0) {
          return rawItemData;
        }

        const receivingItem = receivingItems[activeItemIndex];
        activeItemIndex += 1;
        const assignment = assignments.find((entry) => entry.index === receivingItem?.index);
        return {
          ...rawItemData,
          receivedQty: receivingItem?.receivedQty ?? 0,
          amount: receivingItem?.amount ?? 0,
          itemType: receivingItem?.itemType,
          itemTypeGroup: receivingItem?.itemTypeGroup,
          stockReceiveNo: assignment?.stockItemId,
        };
      });

      transaction.set(
        requestRef,
        stripUndefined({
          requestStatus: 'approved',
          approvedAt,
          approvedByUid,
          approvedByName,
          approvedByEmail,
          items: updatedItems,
          stockReceiveNos: assignments.map((assignment) => assignment.stockItemId),
          totalQty: receivingItems.reduce<number>((sum, entry) => sum + entry.receivedQty, 0),
          totalAmount: roundAmount(receivingItems.reduce<number>((sum, entry) => sum + entry.amount, 0)),
        }),
        { merge: true }
      );
    });
  }, [items, receivingRequestList, userProfile]);

  const approveReceipt = useCallback(async (receiveNo: string) => {
    const pendingDispatch = dispatchList.find(
      (record) => record.status === 'Pending Receipt' && record.itemReceiveNos.includes(receiveNo)
    );

    if (pendingDispatch) {
      await receiveDispatch(pendingDispatch.id);
      return;
    }

    const docRef = doc(db, APP_NAME, 'root', 'stockItems', receiveNo);
    const target = items.find((item) => getStockItemId(item) === receiveNo);
    if (!target) return;

    const projectNo = extractProjectNo(target.purchasedForProject);
    const receiver = createReceivedBySnapshot(userProfile, 'Site Receiver');

    await setDoc(
      docRef,
      {
        status: 'Received at Site',
        location: projectNo ? createProjectStoreLocation(projectNo) : target.location,
        receiveName: receiver.receivedByName,
        receivedByUid: receiver.receivedByUid,
        receivedByName: receiver.receivedByName,
        receivedByEmail: receiver.receivedByEmail,
        lastReceivedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }, [dispatchList, items, receiveDispatch, userProfile]);

  const receiveNewItem = useCallback(async (item: StockItem) => {
    const stockItemId = getStockItemId(item);
    const docRef = doc(db, APP_NAME, 'root', 'stockItems', stockItemId);
    const receiver = createReceivedBySnapshot(userProfile, 'Store Receiver');
    await setDoc(docRef, stripUndefined({
      ...item,
      stockItemId,
      receiveName: item.receiveName || receiver.receivedByName,
      receivedByUid: item.receivedByUid || receiver.receivedByUid,
      receivedByName: item.receivedByName || receiver.receivedByName,
      receivedByEmail: item.receivedByEmail || receiver.receivedByEmail,
      lastReceivedAt: item.lastReceivedAt || item.receiveDate || new Date().toISOString(),
    }));
  }, [userProfile]);

  const receivePrPoPayload = useCallback(async (payload: PrPoReceivePayload) => {
    return processPrPoReceivePayload(payload);
  }, []);

  const updateProjectStatus = useCallback(async (projectNo: string, status: ProjectStatus) => {
    const normalizedProjectNo = projectNo.trim();
    if (!normalizedProjectNo) {
      return;
    }
    const normalizedStatus = normalizeProjectStatus(status);

    const docRef = doc(db, APP_NAME, 'root', 'projectStatuses', normalizedProjectNo);
    await setDoc(
      docRef,
      {
        projectNo: normalizedProjectNo,
        status: normalizedStatus,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }, []);

  const value = useMemo<InventoryContextValue>(
    () => ({
      projects: visibleProjects,
      activeProjects: activeVisibleProjects,
      stockItems: visibleStockItems,
      receivingRequests: visibleReceivingRequests,
      dispatchRecords: visibleDispatchRecords,
      withdrawRecords: visibleWithdrawRecords,
      updateProjectStatus,
      createDispatch,
      cancelDispatch,
      createWithdraw,
      returnWithdraw,
      cancelWithdraw,
      approveReceipt,
      approveReceivingRequest,
      receiveDispatch,
      receiveNewItem,
      receivePrPoPayload,
      activeProjectNo,
      setActiveProjectNo,
    }),
    [
      activeProjectNo,
      approveReceivingRequest,
      approveReceipt,
      createDispatch,
      cancelDispatch,
      createWithdraw,
      cancelWithdraw,
      receiveDispatch,
      receiveNewItem,
      receivePrPoPayload,
      returnWithdraw,
      updateProjectStatus,
      activeVisibleProjects,
      visibleDispatchRecords,
      visibleReceivingRequests,
      visibleStockItems,
      visibleWithdrawRecords,
      visibleProjects,
    ]
  );

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#f7f5ff',
          color: '#4f2ed9',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div
          style={{
            width: '40px',
            height: '40px',
            border: '4px solid rgb(79 46 217 / 18%)',
            borderTop: '4px solid #4f2ed9',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: '16px',
          }}
        />
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
        <span style={{ fontWeight: 600, fontSize: '14px', letterSpacing: '0.05em' }}>
          LOADING DATABASE...
        </span>
      </div>
    );
  }

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within InventoryProvider');
  }
  return context;
}
