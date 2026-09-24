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
  addDoc,
  runTransaction,
  setDoc,
  onSnapshot,
  serverTimestamp,
  getDocs,
  deleteDoc
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { APP_NAME } from '../config/firestore';
import { db, masterDataDb, masterDataProjectsPath, storage, maintShopDb } from '../firebase';
import { processPrPoReceivePayload } from '../services/prPoReceiveIntegration';
import { matchesProjectBorrowItemType } from '../constants/itemTypes';
import type {
  DispatchRecord,
  CancellationEntityType,
  CancellationRequest,
  CancellationRequestStatus,
  ProjectBorrowRequest,
  ProjectBorrowStatus,
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
import { getStockItemId, isStockItemAvailableForMovement } from '../utils/stockItem';
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

interface ImportStockLineInput {
  itemNo: string;
  itemDescription: string;
  prNo: string;
  qty: number;
  itemType?: string;
  itemTypeGroup?: 'Type 1' | 'Type 2';
}

interface ImportStockInput {
  projectNo: string;
  items: ImportStockLineInput[];
}

interface UpdateProjectStockItemInput {
  projectNo: string;
  stockItemIds: string[];
  itemNo: string;
  itemDescription: string;
}

interface DeleteProjectStockItemInput {
  projectNo: string;
  stockItemIds: string[];
}

interface CreateWithdrawLineInput {
  receiveNo: string;
  qty: number;
  requesterName: string;
}

interface CreateWithdrawInput {
  projectNo: string;
  type: WithdrawType;
  items: CreateWithdrawLineInput[];
  withdrawDate: string;
  purpose: string;
  dueDate?: string;
  photos: File[];
}

interface CreateProjectBorrowLineInput {
  stockItemId: string;
  qty: number;
}

interface CreateProjectBorrowInput {
  borrowerProjectNo: string;
  lenderProjectNo: string;
  items: CreateProjectBorrowLineInput[];
  purpose: string;
  dueDate?: string;
}

interface CreateCancellationInput {
  entityType: CancellationEntityType;
  entityId: string;
  reason: string;
  qty?: number;
}

interface InventoryContextValue {
  projects: Project[];
  allProjects: Project[];
  activeProjects: Project[];
  stockItems: StockItem[];
  allStockItems: StockItem[];
  receivingRequests: ReceivingRequest[];
  dispatchRecords: DispatchRecord[];
  withdrawRecords: WithdrawRecord[];
  projectBorrowRequests: ProjectBorrowRequest[];
  cancellationRequests: CancellationRequest[];
  updateProjectStatus: (projectNo: string, status: ProjectStatus) => Promise<void>;
  createDispatch: (input: CreateDispatchInput) => Promise<void>;
  cancelDispatch: (dispatchId: string) => Promise<void>;
  createWithdraw: (input: CreateWithdrawInput) => Promise<void>;
  returnWithdraw: (withdrawId: string) => Promise<void>;
  cancelWithdraw: (withdrawId: string) => Promise<void>;
  createProjectBorrowRequest: (input: CreateProjectBorrowInput) => Promise<void>;
  approveProjectBorrowRequest: (requestId: string) => Promise<void>;
  rejectProjectBorrowRequest: (requestId: string) => Promise<void>;
  requestProjectBorrowReturn: (requestId: string) => Promise<void>;
  completeProjectBorrowReturn: (requestId: string) => Promise<void>;
  createCancellationRequest: (input: CreateCancellationInput) => Promise<void>;
  approveCancellationRequest: (requestId: string) => Promise<void>;
  rejectCancellationRequest: (requestId: string, rejectionReason?: string) => Promise<void>;
  approveReceipt: (receiveNo: string) => Promise<void>;
  approveReceivingRequest: (requestId: string, receivedItems?: ApproveReceivingRequestLineInput[]) => Promise<void>;
  receiveDispatch: (dispatchId: string, receivedItems?: ReceiveDispatchLineInput[]) => Promise<void>;
  receiveNewItem: (item: StockItem) => Promise<void>;
  importStockItems: (input: ImportStockInput) => Promise<void>;
  updateProjectStockItem: (input: UpdateProjectStockItemInput) => Promise<void>;
  deleteProjectStockItem: (input: DeleteProjectStockItemInput) => Promise<void>;
  deleteReceivingRequest: (requestId: string) => Promise<void>;
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

function normalizeCancellationEntityType(value: unknown): CancellationEntityType {
  const normalized = String(value || '').trim();
  if (normalized === 'projectStock' || normalized === 'dispatch' || normalized === 'withdraw' || normalized === 'projectBorrow') {
    return normalized;
  }
  return 'receiving';
}

function normalizeCancellationStatus(value: unknown): CancellationRequestStatus {
  const normalized = String(value || '').trim();
  if (normalized === 'Approved' || normalized === 'Rejected') {
    return normalized;
  }
  return 'Pending Approval';
}

function normalizeCancellationRequest(data: DocumentData, fallbackId: string): CancellationRequest {
  return {
    id: normalizeText(data.id) || fallbackId,
    cancellationNo: normalizeText(data.cancellationNo) || fallbackId,
    entityType: normalizeCancellationEntityType(data.entityType),
    entityId: normalizeText(data.entityId),
    referenceNo: normalizeText(data.referenceNo) || normalizeText(data.entityId) || fallbackId,
    projectNos: normalizeStringArray(data.projectNos),
    projectLabel: normalizeText(data.projectLabel),
    reason: normalizeText(data.reason),
    cancelQty: normalizeNumber(data.cancelQty),
    status: normalizeCancellationStatus(data.status),
    approvalStep: Math.min(2, Math.max(0, normalizeNumber(data.approvalStep))) as 0 | 1 | 2,
    requestedByUid: normalizeText(data.requestedByUid),
    requestedByName: normalizeText(data.requestedByName),
    requestedByEmail: normalizeText(data.requestedByEmail),
    requestedAt: normalizeDateText(data.requestedAt) || normalizeDateText(data.createdAt),
    firstApprovedAt: normalizeDateText(data.firstApprovedAt),
    firstApprovedByUid: normalizeText(data.firstApprovedByUid),
    firstApprovedByName: normalizeText(data.firstApprovedByName),
    firstApprovedByEmail: normalizeText(data.firstApprovedByEmail),
    secondApprovedAt: normalizeDateText(data.secondApprovedAt),
    secondApprovedByUid: normalizeText(data.secondApprovedByUid),
    secondApprovedByName: normalizeText(data.secondApprovedByName),
    secondApprovedByEmail: normalizeText(data.secondApprovedByEmail),
    rejectedAt: normalizeDateText(data.rejectedAt),
    rejectedByUid: normalizeText(data.rejectedByUid),
    rejectedByName: normalizeText(data.rejectedByName),
    rejectedReason: normalizeText(data.rejectedReason),
    completedAt: normalizeDateText(data.completedAt),
    completedByUid: normalizeText(data.completedByUid),
    completedByName: normalizeText(data.completedByName),
    completedByEmail: normalizeText(data.completedByEmail),
  };
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

type InventoryActivityAction =
  | 'TRANSFER_REQUEST'
  | 'TRANSFER_APPROVE'
  | 'TRANSFER_REJECT'
  | 'TRANSFER_RETURN_REQUEST'
  | 'TRANSFER_RETURN'
  | 'DISPATCH'
  | 'RECEIVE'
  | 'RECEIVE_TRANSFER'
  | 'RECEIVE_IMPORT'
  | 'WITHDRAW'
  | 'RECEIVE_RETURN'
  | 'CANCEL'
  | 'DELETE_ITEM'
  | 'ADD_ITEM'
  | 'EDIT_ITEM'
  | 'EDIT_PROJECT_STATUS';

async function logInventoryActivity(
  action: InventoryActivityAction,
  userProfile: ReturnType<typeof useAuth>['userProfile'],
  details: Record<string, unknown> = {},
) {
  try {
    await addDoc(collection(db, APP_NAME, 'root', 'activityLogs'), {
      action,
      email: userProfile?.email ?? 'unknown@cmg.local',
      timestamp: serverTimestamp(),
      details: {
        ...Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)),
        uid: userProfile?.uid ?? '',
        userName: formatPersonName(
          userProfile?.firstName,
          userProfile?.lastName,
          userProfile?.email ?? 'Unknown User',
        ),
      },
    });
  } catch (error) {
    // Activity logging must never make a completed stock operation fail.
    console.error('Failed to log inventory activity:', error);
  }
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

function createProjectBorrowNumber(projectNo: string) {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
    String(now.getMilliseconds()).padStart(3, '0'),
  ].join('');
  return `${getProjectShortNo(projectNo)}-BR-${stamp}`;
}

function createCancellationNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CAN-${stamp}-${suffix}`;
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

function createImportNumber(projectNo: string) {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${getProjectShortNo(projectNo)}-IMP-${timestamp}-${suffix}`;
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
    prNo: normalizeText(data.prNo),
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
  const rawItemType = normalizeText(data.itemType ?? data.type ?? data.category ?? data.itemCategory);
  const receiveType = normalizeText(data.receiveType ?? data.poType);
  const itemType = rawItemType || (receiveType.toUpperCase() === 'EQM' ? 'EQM' : '');
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
    itemType,
    itemTypeGroup: normalizeText(data.itemTypeGroup) === 'Type 2'
      ? 'Type 2'
      : normalizeText(data.itemTypeGroup) === 'Type 1'
        ? 'Type 1'
        : itemType.toUpperCase() === 'EQM'
          ? 'Type 2'
          : undefined,
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
    projectBorrowRequestNo: normalizeText(data.projectBorrowRequestNo) || undefined,
    borrowedFromProjectNo: normalizeProjectNoText(data.borrowedFromProjectNo) || undefined,
    borrowerProjectNo: normalizeProjectNoText(data.borrowerProjectNo) || undefined,
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
  const recordRequesterName = normalizeText(data.requesterName);
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
      requesterName: normalizeText(itemData.requesterName) || recordRequesterName,
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
    requesterName: recordRequesterName || items[0]?.requesterName || '',
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

function normalizeProjectBorrowStatus(value: unknown): ProjectBorrowStatus {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, ' ');
  if (normalized === 'approved') return 'Pending Dispatch';
  if (normalized === 'pending dispatch') return 'Pending Dispatch';
  if (normalized === 'in transit') return 'In Transit';
  if (normalized === 'borrowed' || normalized === 'rent / borrow') return 'Borrowed';
  if (normalized === 'rejected') return 'Rejected';
  if (normalized === 'return requested') return 'Return Requested';
  if (normalized === 'returned') return 'Returned';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'Cancelled';
  return 'Pending Approval';
}

function normalizeProjectBorrowRequest(data: DocumentData, fallbackId: string): ProjectBorrowRequest {
  const requestNo = normalizeText(data.requestNo) || fallbackId;
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = rawItems.map((rawItem, index) => {
    const item = rawItem && typeof rawItem === 'object' ? rawItem as DocumentData : {};
    return {
      sourceStockItemId: normalizeText(item.sourceStockItemId) || normalizeText(item.stockItemId),
      dispatchStockItemId: normalizeText(item.dispatchStockItemId) || undefined,
      borrowedStockItemId: normalizeText(item.borrowedStockItemId) || undefined,
      receiveNo: normalizeText(item.receiveNo) || `${requestNo}-${index + 1}`,
      itemNo: normalizeText(item.itemNo),
      itemDescription: normalizeText(item.itemDescription),
      materialNo: normalizeText(item.materialNo) || undefined,
      itemType: normalizeText(item.itemType) || undefined,
      unit: normalizeText(item.unit) || undefined,
      qty: normalizeNumber(item.qty),
      receivedQty: item.receivedQty === undefined || item.receivedQty === null ? undefined : normalizeNumber(item.receivedQty),
      amount: normalizeNumber(item.amount),
      vendorName: normalizeText(item.vendorName),
      sourceLocation: normalizeText(item.sourceLocation),
      sourceStatus: (normalizeText(item.sourceStatus) as StockItem['status']) || 'Available',
    };
  });

  return {
    id: normalizeText(data.id) || fallbackId,
    requestNo,
    borrowerProjectNo: normalizeProjectNoText(data.borrowerProjectNo),
    borrowerProjectName: normalizeText(data.borrowerProjectName),
    lenderProjectNo: normalizeProjectNoText(data.lenderProjectNo),
    lenderProjectName: normalizeText(data.lenderProjectName),
    status: normalizeProjectBorrowStatus(data.status),
    approvalStep: Math.min(2, Math.max(0, Math.floor(normalizeNumber(data.approvalStep)))) as 0 | 1 | 2,
    approvedAt: normalizeDateText(data.approvedAt) || undefined,
    approvedByUid: normalizeText(data.approvedByUid) || undefined,
    approvedByName: normalizeText(data.approvedByName) || undefined,
    firstApprovedAt: normalizeDateText(data.firstApprovedAt) || undefined,
    firstApprovedByUid: normalizeText(data.firstApprovedByUid) || undefined,
    firstApprovedByName: normalizeText(data.firstApprovedByName) || undefined,
    secondApprovedAt: normalizeDateText(data.secondApprovedAt) || undefined,
    secondApprovedByUid: normalizeText(data.secondApprovedByUid) || undefined,
    secondApprovedByName: normalizeText(data.secondApprovedByName) || undefined,
    rejectedAt: normalizeDateText(data.rejectedAt) || undefined,
    rejectedByUid: normalizeText(data.rejectedByUid) || undefined,
    rejectedByName: normalizeText(data.rejectedByName) || undefined,
    returnRequestedAt: normalizeDateText(data.returnRequestedAt) || undefined,
    returnRequestedByUid: normalizeText(data.returnRequestedByUid) || undefined,
    returnRequestedByName: normalizeText(data.returnRequestedByName) || undefined,
    returnedAt: normalizeDateText(data.returnedAt) || undefined,
    returnedByUid: normalizeText(data.returnedByUid) || undefined,
    returnedByName: normalizeText(data.returnedByName) || undefined,
    dispatchNo: normalizeText(data.dispatchNo) || undefined,
    dispatchedAt: normalizeDateText(data.dispatchedAt) || undefined,
    receivedAt: normalizeDateText(data.receivedAt) || undefined,
    requestedByUid: normalizeText(data.requestedByUid),
    requestedByName: normalizeText(data.requestedByName),
    purpose: normalizeText(data.purpose),
    dueDate: normalizeDateText(data.dueDate) || undefined,
    items,
    itemReceiveNos: normalizeStringArray(data.itemReceiveNos),
    totalQty: normalizeNumber(data.totalQty, items.reduce((sum, item) => sum + item.qty, 0)),
    createdAt: normalizeDateText(data.createdAt) || new Date().toISOString(),
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
  const [projectBorrowList, setProjectBorrowList] = useState<ProjectBorrowRequest[]>([]);
  const [cancellationRequestList, setCancellationRequestList] = useState<CancellationRequest[]>([]);
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
    let unsubProjectBorrow = () => {};
    let unsubReceivingRequests = () => {};
    let unsubCancellationRequests = () => {};

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

    const projectBorrowColRef = collection(db, APP_NAME, 'root', 'projectBorrowRequests');
    unsubProjectBorrow = onSnapshot(
      projectBorrowColRef,
      (snapshot) => {
        const loadedRecords = snapshot.docs.map((d) => normalizeProjectBorrowRequest(d.data(), d.id));
        loadedRecords.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setProjectBorrowList(loadedRecords);
      },
      (error) => {
        console.error('Failed to listen to project borrow updates:', error);
        setProjectBorrowList([]);
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

    const cancellationRequestsColRef = collection(db, APP_NAME, 'root', 'cancellationRequests');
    unsubCancellationRequests = onSnapshot(
      cancellationRequestsColRef,
      (snapshot) => {
        const loadedRequests = snapshot.docs.map((requestDoc) => normalizeCancellationRequest(requestDoc.data(), requestDoc.id));
        loadedRequests.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
        setCancellationRequestList(loadedRequests);
      },
      (error) => {
        console.error('Failed to listen to cancellation request updates:', error);
        setCancellationRequestList([]);
      }
    );

    return () => {
      unsubProjects();
      unsubMasterProjects();
      unsubProjectStatuses();
      unsubStock();
      unsubDispatch();
      unsubWithdraw();
      unsubProjectBorrow();
      unsubReceivingRequests();
      unsubCancellationRequests();
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

  useEffect(() => {
    if (!maintShopDb) return;
    const syncJobSites = async () => {
      try {
        const uniqueSites = Array.from(new Set(activeVisibleProjects.map(p => {
          const text = p.projectNo.trim();
          const match = text.match(/\bJ[-\s]?0*([0-9]+[a-z0-9]*)\b/i) || text.match(/\b0*([0-9]+[a-z0-9]*)\b/i);
          return match ? `J${match[1].toUpperCase()}` : text;
        })));
        if (uniqueSites.length > 0) {
          await setDoc(doc(maintShopDb, 'cmg-maint-shop', 'root', 'config', 'activeJobSites'), {
            sites: uniqueSites
          });
        }
      } catch (error) {
        console.error('Failed to sync job sites to maintShopDb', error);
      }
    };
    syncJobSites();
  }, [activeVisibleProjects]);




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
      const projectNo = item.status === 'Borrowed' && item.borrowerProjectNo
        ? normalizeProjectNoText(item.borrowerProjectNo)
        : getStockItemProjectNo(item);
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

  const visibleProjectBorrowRequests = useMemo(() => {
    if (!userProfile) {
      return [];
    }

    if (userProfile.role.includes('MasterAdmin') || userProfile.role.includes('Store Center')) {
      return projectBorrowList;
    }

    const assigned = userProfile.assignedProjects || [];
    return projectBorrowList.filter((record) =>
      assigned.some((projectNo) => (
        projectNoMatches(projectNo, record.borrowerProjectNo) ||
        projectNoMatches(projectNo, record.lenderProjectNo)
      ))
    );
  }, [projectBorrowList, userProfile]);

  const visibleCancellationRequests = useMemo(() => {
    if (!userProfile) {
      return [];
    }

    if (userProfile.role.includes('MasterAdmin') || userProfile.role.includes('Store Center')) {
      return cancellationRequestList;
    }

    const assigned = userProfile.assignedProjects || [];
    return cancellationRequestList.filter((request) =>
      request.projectNos.some((projectNo) => assigned.some((assignedProjectNo) => projectNoMatches(projectNo, assignedProjectNo)))
    );
  }, [cancellationRequestList, userProfile]);

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

  const createProjectBorrowRequest = useCallback(async ({
    borrowerProjectNo,
    lenderProjectNo,
    items: selectedLines,
    purpose,
    dueDate,
  }: CreateProjectBorrowInput) => {
    const normalizedBorrowerProjectNo = normalizeProjectNoText(borrowerProjectNo);
    const normalizedLenderProjectNo = normalizeProjectNoText(lenderProjectNo);
    if (!normalizedBorrowerProjectNo || !normalizedLenderProjectNo) {
      throw new Error('กรุณาเลือกโครงการผู้ยืมและโครงการผู้ให้ยืม');
    }
    if (normalizedBorrowerProjectNo === normalizedLenderProjectNo) {
      throw new Error('โครงการผู้ยืมและโครงการผู้ให้ยืมต้องไม่ใช่โครงการเดียวกัน');
    }

    const borrowerProject = projectList.find((project) => projectNoMatches(project.projectNo, normalizedBorrowerProjectNo));
    const lenderProject = projectList.find((project) => projectNoMatches(project.projectNo, normalizedLenderProjectNo));
    const canRequestForBorrower = userProfile?.role.includes('MasterAdmin') || userProfile?.role.includes('Store Center') ||
      Boolean(userProfile?.assignedProjects?.some((projectNo) => projectNoMatches(projectNo, normalizedBorrowerProjectNo)));
    if (!borrowerProject || !lenderProject || !canRequestForBorrower) {
      throw new Error('ไม่พบโครงการ หรือบัญชีนี้ไม่มีสิทธิ์สร้างคำขอแทนโครงการผู้ยืม');
    }
    if (!purpose.trim()) {
      throw new Error('กรุณาระบุวัตถุประสงค์การยืม');
    }
    if (!selectedLines.length) {
      throw new Error('กรุณาเลือกรายการ EQM อย่างน้อย 1 รายการ');
    }

    const normalizedLines = selectedLines
      .map((line) => ({ stockItemId: line.stockItemId, qty: Number(line.qty) }))
      .filter((line) => line.stockItemId && Number.isFinite(line.qty) && line.qty > 0);
    if (new Set(normalizedLines.map((line) => line.stockItemId)).size !== normalizedLines.length) {
      throw new Error('ไม่สามารถเลือกรายการเดิมซ้ำในคำขอเดียวกันได้');
    }

    const selectedItems = normalizedLines.map((line) => {
      const sourceItem = items.find((item) => getStockItemId(item) === line.stockItemId);
      if (!sourceItem || getStockItemProjectNo(sourceItem) !== normalizedLenderProjectNo) {
        throw new Error('ไม่พบรายการ EQM ของโครงการผู้ให้ยืม กรุณารีเฟรชแล้วลองใหม่');
      }
      const isBorrowableProjectItem = matchesProjectBorrowItemType(sourceItem);
      const reservedQty = projectBorrowList
        .filter((request) => request.status === 'Pending Approval' || request.status === 'Pending Dispatch')
        .reduce((sum, request) => sum + request.items
          .filter((item) => (
            projectNoMatches(request.lenderProjectNo, lenderProject.projectNo) &&
            (normalizeText(item.sourceStockItemId) === getStockItemId(sourceItem) || normalizeText(item.receiveNo) === normalizeText(sourceItem.receiveNo))
          ))
          .reduce((itemSum, item) => itemSum + item.qty, 0), 0);
      const availableQty = Math.max(0, sourceItem.qty - reservedQty);
      if (!isBorrowableProjectItem || !isStockItemAvailableForMovement(sourceItem) || line.qty > availableQty) {
        if (isBorrowableProjectItem && isStockItemAvailableForMovement(sourceItem)) {
          throw new Error(`รายการ ${sourceItem.itemNo || sourceItem.receiveNo} พร้อมให้ยืมเหลือ ${availableQty.toLocaleString()} ชิ้น หลังหักจำนวนที่ถูกจองแล้ว`);
        }
        throw new Error(`รายการ ${sourceItem.itemNo || sourceItem.receiveNo} ไม่ใช่ EQM/นั่งร้าน/แบบเหล็กที่พร้อมให้ยืม หรือจำนวนไม่พอ`);
      }
      return { sourceItem, qty: line.qty };
    });

    const requestNo = createProjectBorrowNumber(borrowerProject.projectNo);
    const createdAt = new Date().toISOString();
    const requestedByName = formatPersonName(userProfile?.firstName, userProfile?.lastName, userProfile?.email ?? 'Unknown User');
    const request: ProjectBorrowRequest = {
      id: requestNo,
      requestNo,
      borrowerProjectNo: borrowerProject.projectNo,
      borrowerProjectName: borrowerProject.projectName,
      lenderProjectNo: lenderProject.projectNo,
      lenderProjectName: lenderProject.projectName,
      status: 'Pending Approval',
      approvalStep: 0,
      requestedByUid: userProfile?.uid ?? '',
      requestedByName,
      purpose: purpose.trim(),
      dueDate: dueDate?.trim() || undefined,
      items: selectedItems.map(({ sourceItem, qty }) => ({
        sourceStockItemId: getStockItemId(sourceItem),
        receiveNo: sourceItem.receiveNo,
        itemNo: sourceItem.itemNo,
        itemDescription: sourceItem.itemDescription,
        materialNo: getStockItemMaterialNo(sourceItem),
        itemType: sourceItem.itemType,
        unit: sourceItem.unit,
        qty,
        amount: calculatePartialAmount(sourceItem.amount, sourceItem.qty, qty),
        vendorName: sourceItem.vendorName,
        sourceLocation: sourceItem.location,
        sourceStatus: sourceItem.status,
      })),
      itemReceiveNos: selectedItems.map(({ sourceItem }) => getStockItemId(sourceItem)),
      totalQty: selectedItems.reduce((sum, item) => sum + item.qty, 0),
      createdAt,
    };
    await setDoc(doc(db, APP_NAME, 'root', 'projectBorrowRequests', requestNo), stripUndefined(request));
    await logInventoryActivity('TRANSFER_REQUEST', userProfile, {
      requestNo,
      borrowerProjectNo: borrowerProject.projectNo,
      lenderProjectNo: lenderProject.projectNo,
      totalQty: request.totalQty,
      itemCount: request.items.length,
    });
  }, [items, projectBorrowList, projectList, userProfile]);

  const getProjectBorrowApprover = useCallback((request: ProjectBorrowRequest) => {
    if (!userProfile) return false;
    if (userProfile.role.includes('MasterAdmin') || userProfile.role.includes('Store Center')) return true;
    const projectRoles = Object.entries(userProfile.projectRoles || {})
      .find(([projectNo]) => projectNoMatches(projectNo, request.lenderProjectNo))?.[1] || [];
    const roles = new Set([...userProfile.role, ...projectRoles]);
    return Boolean(userProfile.assignedProjects?.some((projectNo) => projectNoMatches(projectNo, request.lenderProjectNo))) &&
      ['Admin Site', 'Store Site', 'Keeper'].some((role) => roles.has(role as typeof userProfile.role[number]));
  }, [userProfile]);

  const approveProjectBorrowRequest = useCallback(async (requestId: string) => {
    const target = visibleProjectBorrowRequests.find((request) => request.id === requestId);
    if (!target || target.status !== 'Pending Approval') return;
    if (!getProjectBorrowApprover(target)) throw new Error('เฉพาะผู้มีสิทธิ์ของโครงการผู้ให้ยืมเท่านั้นที่อนุมัติได้');
    const approverUid = userProfile?.uid ?? '';
    const approverName = formatPersonName(userProfile?.firstName, userProfile?.lastName, userProfile?.email ?? 'Approver');
    if (target.requestedByUid === approverUid) {
      throw new Error('ผู้ขอรายการไม่สามารถอนุมัติรายการของตัวเองได้');
    }
    const requestRef = doc(db, APP_NAME, 'root', 'projectBorrowRequests', requestId);
    const approvedAt = new Date().toISOString();

    await runTransaction(db, async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists()) throw new Error('ไม่พบคำขอยืมนี้แล้ว');
      const current = normalizeProjectBorrowRequest(requestSnapshot.data(), requestId);
      if (current.status !== 'Pending Approval') throw new Error('คำขอนี้ถูกดำเนินการไปแล้ว');
      transaction.set(requestRef, stripUndefined({
        status: 'Pending Dispatch',
        approvalStep: 1,
        approvedAt,
        approvedByUid: approverUid,
        approvedByName: approverName,
      }), { merge: true });
    });
    await logInventoryActivity('TRANSFER_APPROVE', userProfile, {
      requestNo: target.requestNo,
      borrowerProjectNo: target.borrowerProjectNo,
      lenderProjectNo: target.lenderProjectNo,
    });
  }, [getProjectBorrowApprover, userProfile, visibleProjectBorrowRequests]);

  const rejectProjectBorrowRequest = useCallback(async (requestId: string) => {
    const target = visibleProjectBorrowRequests.find((request) => request.id === requestId);
    if (!target || target.status !== 'Pending Approval') return;
    if (!getProjectBorrowApprover(target)) throw new Error('เฉพาะผู้มีสิทธิ์ของโครงการผู้ให้ยืมเท่านั้นที่ปฏิเสธได้');
    const rejectedAt = new Date().toISOString();
    await setDoc(doc(db, APP_NAME, 'root', 'projectBorrowRequests', requestId), {
      status: 'Rejected',
      rejectedAt,
      rejectedByUid: userProfile?.uid ?? '',
      rejectedByName: formatPersonName(userProfile?.firstName, userProfile?.lastName, userProfile?.email ?? 'Approver'),
    }, { merge: true });
    await logInventoryActivity('TRANSFER_REJECT', userProfile, {
      requestNo: target.requestNo,
      borrowerProjectNo: target.borrowerProjectNo,
      lenderProjectNo: target.lenderProjectNo,
    });
  }, [getProjectBorrowApprover, userProfile, visibleProjectBorrowRequests]);

  const requestProjectBorrowReturn = useCallback(async (requestId: string) => {
    const target = visibleProjectBorrowRequests.find((request) => request.id === requestId);
    if (!target || target.status !== 'Borrowed') return;
    const canReturn = userProfile?.role.includes('MasterAdmin') || userProfile?.role.includes('Store Center') ||
      userProfile?.assignedProjects?.some((projectNo) => projectNoMatches(projectNo, target.borrowerProjectNo));
    if (!canReturn) throw new Error('เฉพาะโครงการผู้ยืมเท่านั้นที่แจ้งคืนได้');
    await setDoc(doc(db, APP_NAME, 'root', 'projectBorrowRequests', requestId), {
      status: 'Return Requested',
      returnRequestedAt: new Date().toISOString(),
      returnRequestedByUid: userProfile?.uid ?? '',
      returnRequestedByName: formatPersonName(userProfile?.firstName, userProfile?.lastName, userProfile?.email ?? 'User'),
    }, { merge: true });
    await logInventoryActivity('TRANSFER_RETURN_REQUEST', userProfile, {
      requestNo: target.requestNo,
      borrowerProjectNo: target.borrowerProjectNo,
      lenderProjectNo: target.lenderProjectNo,
    });
  }, [userProfile, visibleProjectBorrowRequests]);

  const completeProjectBorrowReturn = useCallback(async (requestId: string) => {
    const target = visibleProjectBorrowRequests.find((request) => request.id === requestId);
    if (!target || target.status !== 'Return Requested') return;
    const canReceive = userProfile?.role.includes('MasterAdmin') || userProfile?.role.includes('Store Center') ||
      userProfile?.assignedProjects?.some((projectNo) => projectNoMatches(projectNo, target.lenderProjectNo));
    if (!canReceive) throw new Error('เฉพาะโครงการผู้ให้ยืมเท่านั้นที่ยืนยันรับคืนได้');
    const returnedAt = new Date().toISOString();
    const requestRef = doc(db, APP_NAME, 'root', 'projectBorrowRequests', requestId);
    await runTransaction(db, async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists()) throw new Error('ไม่พบคำขอยืมนี้แล้ว');
      const current = normalizeProjectBorrowRequest(requestSnapshot.data(), requestId);
      if (current.status !== 'Return Requested') throw new Error('คำขอนี้ยังไม่อยู่ระหว่างรอรับคืน');
      const sourceRefs = current.items.map((item) => doc(db, APP_NAME, 'root', 'stockItems', item.sourceStockItemId));
      const borrowedRefs = current.items.map((item) => item.borrowedStockItemId
        ? doc(db, APP_NAME, 'root', 'stockItems', item.borrowedStockItemId)
        : null);
      const sourceSnapshots = await Promise.all(sourceRefs.map((sourceRef) => transaction.get(sourceRef)));
      const borrowedSnapshots = await Promise.all(borrowedRefs.map((borrowedRef) => borrowedRef ? transaction.get(borrowedRef) : null));
      current.items.forEach((item, index) => {
        const sourceSnapshot = sourceSnapshots[index];
        const sourceItem = sourceSnapshot.exists() ? normalizeStockItem(sourceSnapshot.data(), sourceSnapshot.id) : undefined;
        const borrowedSnapshot = borrowedSnapshots[index];
        const borrowedItem = borrowedSnapshot?.exists() ? normalizeStockItem(borrowedSnapshot.data(), borrowedSnapshot.id) : undefined;
        const qtyToRestore = Math.min(item.qty, borrowedItem?.qty ?? item.receivedQty ?? item.qty);
        const amountToRestore = borrowedItem?.amount ?? item.amount;
        if (!sourceItem) {
          throw new Error(`ไม่พบสต็อกต้นทางของ ${item.itemNo} จึงไม่สามารถรับคืนได้`);
        }
        transaction.set(sourceRefs[index], stripUndefined({
          ...sourceItem,
          stockItemId: item.sourceStockItemId,
          receiveNo: sourceItem.receiveNo || item.receiveNo,
          qty: sourceItem.qty + qtyToRestore,
          amount: roundAmount(sourceItem.amount + amountToRestore),
          status: 'Available',
          location: sourceItem.location || item.sourceLocation,
          purchasedForProject: sourceItem.purchasedForProject || createProjectLabel(current.lenderProjectNo),
          cmgProjectCode: current.lenderProjectNo,
          lastProjectBorrowReturnNo: current.requestNo,
          lastProjectBorrowReturnedAt: returnedAt,
        }), { merge: true });
        if (borrowedRefs[index] && borrowedItem) {
          const remainingQty = borrowedItem.qty - qtyToRestore;
          if (remainingQty <= 0) {
            transaction.delete(borrowedRefs[index]);
          } else {
            transaction.update(borrowedRefs[index], {
              qty: remainingQty,
              amount: Math.max(0, roundAmount(borrowedItem.amount - amountToRestore)),
              status: borrowedItem.status === 'Borrowed' ? 'Received at Site' : borrowedItem.status,
            });
          }
        }
      });
      transaction.set(requestRef, {
        status: 'Returned',
        returnedAt,
        returnedByUid: userProfile?.uid ?? '',
        returnedByName: formatPersonName(userProfile?.firstName, userProfile?.lastName, userProfile?.email ?? 'Receiver'),
      }, { merge: true });
    });
    await logInventoryActivity('TRANSFER_RETURN', userProfile, {
      requestNo: target.requestNo,
      borrowerProjectNo: target.borrowerProjectNo,
      lenderProjectNo: target.lenderProjectNo,
      totalQty: target.totalQty,
    });
  }, [userProfile, visibleProjectBorrowRequests]);

  const getCancellationTarget = useCallback((entityType: CancellationEntityType, entityId: string) => {
    if (entityType === 'projectStock') {
      const target = visibleStockItems.find((item) => getStockItemId(item) === entityId);
      if (!target || target.qty <= 0 || target.status === 'In Transit' || target.status === 'Pending Dispatch') return null;
      return {
        referenceNo: target.itemNo || target.receiveNo,
        projectNos: [getStockItemProjectNo(target)].filter(Boolean),
        projectLabel: `${target.itemDescription || '-'} · ${target.receiveNo}`,
        stockQty: target.qty,
      };
    }
    if (entityType === 'receiving') {
      const target = receivingRequestList.find((request) => request.id === entityId);
      if (!target || target.requestStatus !== 'approved') return null;
      return {
        referenceNo: target.receiveNo,
        projectNos: [target.projectNo || target.cmgProjectCode].filter(Boolean),
        projectLabel: target.projectName,
      };
    }
    if (entityType === 'dispatch') {
      const target = dispatchList.find((record) => record.id === entityId);
      if (!target || target.status !== 'Pending Receipt') return null;
      return {
        referenceNo: target.dispatchNo,
        projectNos: [target.sourceProjectNo, target.destinationProjectNo].filter(Boolean),
        projectLabel: `${target.sourceProjectNo} → ${target.destinationProjectNo}`,
      };
    }
    if (entityType === 'withdraw') {
      const target = withdrawList.find((record) => record.id === entityId);
      if (!target || target.status === 'Returned' || target.status === 'Cancelled') return null;
      return {
        referenceNo: target.withdrawNo,
        projectNos: [target.projectNo].filter(Boolean),
        projectLabel: target.projectName,
      };
    }
    const target = projectBorrowList.find((request) => request.id === entityId);
    if (!target || ['Rejected', 'In Transit', 'Returned', 'Cancelled'].includes(target.status)) return null;
    return {
      referenceNo: target.requestNo,
      projectNos: [target.borrowerProjectNo, target.lenderProjectNo].filter(Boolean),
      projectLabel: `${target.borrowerProjectNo} ↔ ${target.lenderProjectNo}`,
    };
  }, [dispatchList, projectBorrowList, receivingRequestList, visibleStockItems, withdrawList]);

  const createCancellationRequest = useCallback(async ({ entityType, entityId, reason, qty }: CreateCancellationInput) => {
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 5) {
      throw new Error('กรุณาระบุเหตุผลการยกเลิกอย่างน้อย 5 ตัวอักษร');
    }

    const target = getCancellationTarget(entityType, entityId);
    if (!target) {
      throw new Error('รายการนี้ไม่อยู่ในสถานะที่สามารถขอยกเลิกได้แล้ว');
    }
    if (entityType === 'projectStock' && !projectNoMatches(activeProjectNo, target.projectNos[0] || '')) {
      throw new Error('กรุณาเลือกสินค้าในคลังของโครงการที่กำลังใช้งานอยู่');
    }

    const cancelQty = entityType === 'projectStock' ? Math.floor(Number(qty)) : undefined;
    if (entityType === 'projectStock' && (!cancelQty || cancelQty <= 0 || cancelQty > (target.stockQty ?? 0))) {
      throw new Error(`จำนวนที่ยกเลิกต้องอยู่ระหว่าง 1 ถึง ${(target.stockQty ?? 0).toLocaleString()} ชิ้น`);
    }

    const duplicate = cancellationRequestList.find((request) =>
      request.entityType === entityType &&
      request.entityId === entityId &&
      request.status === 'Pending Approval'
    );
    if (duplicate) {
      throw new Error(`รายการนี้มีคำขอยกเลิก ${duplicate.cancellationNo} อยู่แล้ว`);
    }

    const requestedAt = new Date().toISOString();
    const cancellationNo = createCancellationNumber();
    const requestedByName = formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? 'User'
    );
    const request: CancellationRequest = {
      id: cancellationNo,
      cancellationNo,
      entityType,
      entityId,
      referenceNo: target.referenceNo,
      projectNos: target.projectNos.map((projectNo) => normalizeProjectNoText(projectNo)),
      projectLabel: target.projectLabel,
      reason: trimmedReason,
      cancelQty,
      status: 'Pending Approval',
      approvalStep: 0,
      requestedByUid: userProfile?.uid ?? '',
      requestedByName,
      requestedByEmail: userProfile?.email ?? 'unknown@cmg.local',
      requestedAt,
    };

    await setDoc(doc(db, APP_NAME, 'root', 'cancellationRequests', cancellationNo), stripUndefined(request));
    await logInventoryActivity('CANCEL', userProfile, {
      cancellationNo,
      entityType,
      entityId,
      referenceNo: target.referenceNo,
      cancelQty,
    });
  }, [activeProjectNo, cancellationRequestList, getCancellationTarget, userProfile]);

  const canApproveCancellation = useCallback((request: CancellationRequest) => {
    if (!userProfile) return false;
    if (userProfile.role.includes('MasterAdmin') || userProfile.role.includes('Store Center')) return true;
    const assignedProject = userProfile.assignedProjects?.some((assignedProjectNo) =>
      request.projectNos.some((projectNo) => projectNoMatches(projectNo, assignedProjectNo))
    );
    if (!assignedProject) return false;
    const projectRoleValues = Object.entries(userProfile.projectRoles || {})
      .filter(([projectNo]) => request.projectNos.some((targetProjectNo) => projectNoMatches(projectNo, targetProjectNo)))
      .flatMap(([, roles]) => roles);
    return [...userProfile.role, ...projectRoleValues].some((role) =>
      ['Admin Site', 'Store Site', 'Keeper'].includes(role)
    );
  }, [userProfile]);

  const approveCancellationRequest = useCallback(async (requestId: string) => {
    const target = visibleCancellationRequests.find((request) => request.id === requestId);
    if (!target || target.status !== 'Pending Approval') return;
    if (!canApproveCancellation(target)) {
      throw new Error('เฉพาะผู้มีสิทธิ์ของโครงการที่เกี่ยวข้องเท่านั้นที่อนุมัติได้');
    }

    const approverUid = userProfile?.uid ?? '';
    const approverName = formatPersonName(userProfile?.firstName, userProfile?.lastName, userProfile?.email ?? 'Approver');
    const approverEmail = userProfile?.email ?? 'unknown@cmg.local';
    if (target.requestedByUid === approverUid || target.firstApprovedByUid === approverUid) {
      throw new Error('ผู้ขอรายการหรือผู้อนุมัติขั้นแรกไม่สามารถอนุมัติซ้ำได้');
    }

    const cancellationRef = doc(db, APP_NAME, 'root', 'cancellationRequests', requestId);
    const approvedAt = new Date().toISOString();
    await runTransaction(db, async (transaction) => {
      const cancellationSnapshot = await transaction.get(cancellationRef);
      if (!cancellationSnapshot.exists()) throw new Error('ไม่พบคำขอยกเลิกนี้แล้ว');
      const current = normalizeCancellationRequest(cancellationSnapshot.data(), requestId);
      if (current.status !== 'Pending Approval') throw new Error('คำขอยกเลิกนี้ถูกดำเนินการไปแล้ว');

      if (current.approvalStep === 0) {
        transaction.set(cancellationRef, {
          approvalStep: 1,
          firstApprovedAt: approvedAt,
          firstApprovedByUid: approverUid,
          firstApprovedByName: approverName,
          firstApprovedByEmail: approverEmail,
        }, { merge: true });
        return;
      }
      if (current.firstApprovedByUid === approverUid) {
        throw new Error('ต้องใช้ผู้อนุมัติคนละคนในขั้นที่ 2');
      }

      if (current.entityType === 'projectStock') {
        const entityRef = doc(db, APP_NAME, 'root', 'stockItems', current.entityId);
        const entitySnapshot = await transaction.get(entityRef);
        if (!entitySnapshot.exists()) throw new Error('ไม่พบสินค้าในคลังโครงการ');
        const stockItem = normalizeStockItem(entitySnapshot.data(), entitySnapshot.id);
        const cancelQty = Math.floor(current.cancelQty ?? 0);
        if (cancelQty <= 0 || stockItem.qty < cancelQty) {
          throw new Error(`สต็อกคงเหลือไม่พอสำหรับยกเลิก (คงเหลือ ${stockItem.qty.toLocaleString()} ชิ้น)`);
        }
        const beforeQty = stockItem.qty;
        const afterQty = beforeQty - cancelQty;
        const cancelledAmount = calculatePartialAmount(stockItem.amount, beforeQty, cancelQty);
        const historyRef = doc(collection(db, APP_NAME, 'root', 'stockCancellationHistory'));
        transaction.update(entityRef, {
          qty: afterQty,
          amount: Math.max(0, roundAmount(stockItem.amount - cancelledAmount)),
          status: afterQty > 0 ? stockItem.status : 'Available',
          lastCancelledAt: approvedAt,
          lastCancelledByUid: approverUid,
          lastCancelledByName: approverName,
          lastCancellationReason: current.reason,
        });
        transaction.set(historyRef, stripUndefined({
          id: historyRef.id,
          cancellationNo: current.cancellationNo,
          stockItemId: current.entityId,
          receiveNo: stockItem.receiveNo,
          itemNo: stockItem.itemNo,
          itemDescription: stockItem.itemDescription,
          projectNo: getStockItemProjectNo(stockItem),
          cancelledQty: cancelQty,
          beforeQty,
          afterQty,
          reason: current.reason,
          cancelledAt: approvedAt,
          cancelledByUid: approverUid,
          cancelledByName: approverName,
          cancelledByEmail: approverEmail,
          requestedByUid: current.requestedByUid,
          requestedByName: current.requestedByName,
        }));
      } else if (current.entityType === 'dispatch') {
        const entityRef = doc(db, APP_NAME, 'root', 'dispatchRecords', current.entityId);
        const entitySnapshot = await transaction.get(entityRef);
        if (!entitySnapshot.exists()) throw new Error('ไม่พบรายการจัดส่งต้นทาง');
        const dispatch = entitySnapshot.data() as DispatchRecord;
        if (dispatch.status !== 'Pending Receipt') throw new Error('รายการจัดส่งไม่อยู่ในสถานะที่ยกเลิกได้แล้ว');
        const stockIds = Array.from(new Set(dispatch.items.flatMap((item) => [
          item.sourceStockItemId || item.stockItemId || item.receiveNo,
          item.stockReceiveNo,
        ])));
        const stockSnapshots = await Promise.all(stockIds.map((stockId) => transaction.get(doc(db, APP_NAME, 'root', 'stockItems', stockId))));
        const stockById = new Map(stockIds.map((stockId, index) => [stockId, stockSnapshots[index]]));
        dispatch.items.forEach((item) => {
          const sourceStockItemId = item.sourceStockItemId || item.stockItemId || item.receiveNo;
          const sourceSnapshot = stockById.get(sourceStockItemId);
          const transitSnapshot = stockById.get(item.stockReceiveNo);
          if (!transitSnapshot?.exists()) throw new Error(`ไม่พบสินค้าระหว่างจัดส่ง ${item.stockReceiveNo}`);
          const transitItem = normalizeStockItem(transitSnapshot.data(), transitSnapshot.id);
          const sourceItem = sourceSnapshot?.exists() ? normalizeStockItem(sourceSnapshot.data(), sourceSnapshot.id) : undefined;
          transaction.set(doc(db, APP_NAME, 'root', 'stockItems', sourceStockItemId), stripUndefined({
            ...(sourceItem ?? transitItem),
            stockItemId: sourceStockItemId,
            receiveNo: sourceItem?.receiveNo || item.receiveNo,
            qty: (sourceItem?.qty ?? 0) + transitItem.qty,
            amount: roundAmount((sourceItem?.amount ?? 0) + transitItem.amount),
            location: sourceItem?.location || item.sourceLocation,
            purchasedForProject: sourceItem?.purchasedForProject || createProjectLabel(dispatch.sourceProjectNo),
            cmgProjectCode: sourceItem?.cmgProjectCode || normalizeProjectNoText(dispatch.sourceProjectNo),
            status: sourceItem?.status === 'In Transit' ? 'Received at Site' : (sourceItem?.status ?? 'Received at Site'),
            lastCancelledDispatchNo: dispatch.dispatchNo,
            lastCancelledDispatchAt: approvedAt,
            lastCancellationReason: current.reason,
          }), { merge: true });
          transaction.delete(doc(db, APP_NAME, 'root', 'stockItems', item.stockReceiveNo));
        });
        transaction.set(entityRef, {
          status: 'Dispatch Cancelled',
          cancelledAt: approvedAt,
          cancelledByUid: approverUid,
          cancelledByName: approverName,
          cancelledByEmail: approverEmail,
          cancellationReason: current.reason,
        }, { merge: true });
      } else if (current.entityType === 'withdraw') {
        const entityRef = doc(db, APP_NAME, 'root', 'withdrawRecords', current.entityId);
        const entitySnapshot = await transaction.get(entityRef);
        if (!entitySnapshot.exists()) throw new Error('ไม่พบรายการเบิกต้นทาง');
        const withdraw = normalizeWithdrawRecord(entitySnapshot.data(), current.entityId);
        if (withdraw.status === 'Returned' || withdraw.status === 'Cancelled') throw new Error('รายการเบิกไม่อยู่ในสถานะที่ยกเลิกได้แล้ว');
        const groups = withdraw.items.reduce((map, item) => {
          const list = map.get(item.stockItemId) ?? [];
          list.push(item);
          map.set(item.stockItemId, list);
          return map;
        }, new Map<string, typeof withdraw.items>());
        const entries = Array.from(groups.entries());
        const stockSnapshots = await Promise.all(entries.map(([stockId]) => transaction.get(doc(db, APP_NAME, 'root', 'stockItems', stockId))));
        entries.forEach(([stockId, groupedItems], index) => {
          const stockSnapshot = stockSnapshots[index];
          const existing = stockSnapshot?.exists() ? normalizeStockItem(stockSnapshot.data(), stockSnapshot.id) : undefined;
          const base = groupedItems[0];
          if (!existing && !base.stockItemSnapshot) throw new Error(`ไม่พบสินค้าเดิม ${base.receiveNo} สำหรับคืนสต็อก`);
          const qty = groupedItems.reduce((sum, item) => sum + item.qty, 0);
          const amount = groupedItems.reduce((sum, item) => sum + item.amount, 0);
          const restoredStatus = base.originalStatus === 'Borrowed' || base.originalStatus === 'Withdrawn' ? 'Received at Site' : base.originalStatus;
          transaction.set(doc(db, APP_NAME, 'root', 'stockItems', stockId), stripUndefined({
            ...(existing ? {} : base.stockItemSnapshot),
            stockItemId: stockId,
            receiveNo: existing?.receiveNo || base.receiveNo,
            qty: (existing?.qty ?? 0) + qty,
            amount: roundAmount((existing?.amount ?? 0) + amount),
            status: !existing || existing.status === 'Borrowed' || existing.status === 'Withdrawn' || existing.qty <= 0 ? restoredStatus : existing.status,
            location: existing?.location || base.sourceLocation,
            cmgProjectCode: normalizeProjectNoText(withdraw.projectNo),
            lastCancelledWithdrawNo: withdraw.withdrawNo,
            lastCancelledAt: approvedAt,
            lastCancellationReason: current.reason,
          }), { merge: true });
        });
        transaction.set(entityRef, {
          status: 'Cancelled',
          cancelledAt: approvedAt,
          cancelledByUid: approverUid,
          cancelledByName: approverName,
          cancelledByEmail: approverEmail,
          cancellationReason: current.reason,
        }, { merge: true });
      } else if (current.entityType === 'receiving') {
        const entityRef = doc(db, APP_NAME, 'root', 'receivingRequests', current.entityId);
        const entitySnapshot = await transaction.get(entityRef);
        if (!entitySnapshot.exists()) throw new Error('ไม่พบรายการรับเข้าต้นทาง');
        const receiving = normalizeReceivingRequest(entitySnapshot.data(), current.entityId);
        if (receiving.requestStatus !== 'approved') throw new Error('รายการรับเข้าไม่อยู่ในสถานะที่ยกเลิกได้แล้ว');
        const stockEntries = receiving.items.map((item, index) => ({
          item,
          stockItemId: item.stockReceiveNo || receiving.stockReceiveNos?.[index] || '',
        })).filter(({ stockItemId }) => Boolean(stockItemId));
        if (!stockEntries.length) throw new Error('รายการรับเข้าไม่มี Stock Receive No. สำหรับย้อนรายการ');
        const stockSnapshots = await Promise.all(stockEntries.map(({ stockItemId }) => transaction.get(doc(db, APP_NAME, 'root', 'stockItems', stockItemId))));
        stockEntries.forEach(({ item, stockItemId }, index) => {
          const stockSnapshot = stockSnapshots[index];
          if (!stockSnapshot.exists()) throw new Error(`ไม่พบสินค้า ${stockItemId} ในสต็อก`);
          const stockItem = normalizeStockItem(stockSnapshot.data(), stockSnapshot.id);
          if (stockItem.qty < item.receivedQty) throw new Error(`สต็อก ${stockItemId} คงเหลือไม่พอสำหรับย้อนรายการ`);
          const remainingQty = stockItem.qty - item.receivedQty;
          const remainingAmount = Math.max(0, roundAmount(stockItem.amount - item.amount));
          if (remainingQty <= 0) {
            transaction.delete(doc(db, APP_NAME, 'root', 'stockItems', stockItemId));
          } else {
            transaction.update(doc(db, APP_NAME, 'root', 'stockItems', stockItemId), {
              qty: remainingQty,
              amount: remainingAmount,
              lastCancellationReason: current.reason,
            });
          }
        });
        transaction.set(entityRef, {
          requestStatus: 'cancelled',
          cancelledAt: approvedAt,
          cancelledByUid: approverUid,
          cancelledByName: approverName,
          cancelledByEmail: approverEmail,
          cancellationReason: current.reason,
        }, { merge: true });
      } else if (current.entityType === 'projectBorrow') {
        const entityRef = doc(db, APP_NAME, 'root', 'projectBorrowRequests', current.entityId);
        const entitySnapshot = await transaction.get(entityRef);
        if (!entitySnapshot.exists()) throw new Error('ไม่พบรายการยืม-คืนต้นทาง');
        const borrow = normalizeProjectBorrowRequest(entitySnapshot.data(), current.entityId);
        if (['Rejected', 'Returned', 'Cancelled'].includes(borrow.status)) throw new Error('รายการยืม-คืนไม่อยู่ในสถานะที่ยกเลิกได้แล้ว');
        if (borrow.status === 'Borrowed' || borrow.status === 'Return Requested') {
          const sourceRefs = borrow.items.map((item) => doc(db, APP_NAME, 'root', 'stockItems', item.sourceStockItemId));
          const borrowedRefs = borrow.items.map((item) => doc(db, APP_NAME, 'root', 'stockItems', item.borrowedStockItemId || `${borrow.requestNo}-BORROW`));
          const sourceSnapshots = await Promise.all(sourceRefs.map((sourceRef) => transaction.get(sourceRef)));
          borrow.items.forEach((item, index) => {
            const sourceSnapshot = sourceSnapshots[index];
            const sourceItem = sourceSnapshot.exists() ? normalizeStockItem(sourceSnapshot.data(), sourceSnapshot.id) : undefined;
            transaction.set(sourceRefs[index], stripUndefined({
              ...(sourceItem ?? {}),
              stockItemId: item.sourceStockItemId,
              receiveNo: sourceItem?.receiveNo || item.receiveNo,
              qty: (sourceItem?.qty ?? 0) + item.qty,
              amount: roundAmount((sourceItem?.amount ?? 0) + item.amount),
              status: 'Available',
              location: sourceItem?.location || item.sourceLocation,
              purchasedForProject: sourceItem?.purchasedForProject || createProjectLabel(borrow.lenderProjectNo),
              cmgProjectCode: borrow.lenderProjectNo,
              lastCancelledProjectBorrowNo: borrow.requestNo,
              lastCancelledAt: approvedAt,
              lastCancellationReason: current.reason,
            }), { merge: true });
            transaction.delete(borrowedRefs[index]);
          });
        }
        transaction.set(entityRef, {
          status: 'Cancelled',
          cancelledAt: approvedAt,
          cancelledByUid: approverUid,
          cancelledByName: approverName,
          cancelledByEmail: approverEmail,
          cancellationReason: current.reason,
        }, { merge: true });
      }

      transaction.set(cancellationRef, {
        status: 'Approved',
        approvalStep: 2,
        secondApprovedAt: approvedAt,
        secondApprovedByUid: approverUid,
        secondApprovedByName: approverName,
        secondApprovedByEmail: approverEmail,
        completedAt: approvedAt,
        completedByUid: approverUid,
        completedByName: approverName,
        completedByEmail: approverEmail,
      }, { merge: true });
    });
    await logInventoryActivity('DELETE_ITEM', userProfile, {
      entityType: target.entityType,
      entityId: target.entityId,
      cancellationNo: target.cancellationNo,
      referenceNo: target.referenceNo,
      reason: target.reason,
    });
  }, [canApproveCancellation, userProfile, visibleCancellationRequests]);

  const rejectCancellationRequest = useCallback(async (requestId: string, rejectionReason = '') => {
    const target = visibleCancellationRequests.find((request) => request.id === requestId);
    if (!target || target.status !== 'Pending Approval') return;
    if (!canApproveCancellation(target)) throw new Error('เฉพาะผู้มีสิทธิ์ของโครงการที่เกี่ยวข้องเท่านั้นที่ปฏิเสธได้');
    const rejectedAt = new Date().toISOString();
    await setDoc(doc(db, APP_NAME, 'root', 'cancellationRequests', requestId), {
      status: 'Rejected',
      rejectedAt,
      rejectedByUid: userProfile?.uid ?? '',
      rejectedByName: formatPersonName(userProfile?.firstName, userProfile?.lastName, userProfile?.email ?? 'Approver'),
      rejectedReason: rejectionReason.trim(),
    }, { merge: true });
    await logInventoryActivity('CANCEL', userProfile, {
      entityType: target.entityType,
      entityId: target.entityId,
      cancellationNo: target.cancellationNo,
      rejected: true,
    });
  }, [canApproveCancellation, userProfile, visibleCancellationRequests]);

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

      const borrowCandidates = projectBorrowList.filter((request) =>
        request.status === 'Pending Dispatch' &&
        projectNoMatches(request.lenderProjectNo, sourceProject.projectNo) &&
        projectNoMatches(request.borrowerProjectNo, targetProject.projectNo)
      );
      const borrowRefs = borrowCandidates.map((request) =>
        doc(db, APP_NAME, 'root', 'projectBorrowRequests', request.id)
      );
      const borrowSnapshots = await Promise.all(borrowRefs.map((borrowRef) => transaction.get(borrowRef)));
      const dispatchBySourceId = new Map(
        dispatchSnapshots.map((snapshot) => [snapshot.sourceStockItemId, snapshot])
      );
      const linkedBorrowRequests = borrowCandidates
        .map((request, index) => ({ request, ref: borrowRefs[index], snapshot: borrowSnapshots[index] }))
        .filter(({ request, snapshot }) => {
          if (!snapshot.exists()) return false;
          const current = normalizeProjectBorrowRequest(snapshot.data(), request.id);
          return current.status === 'Pending Dispatch' && current.items.every((item) => {
            const dispatched = dispatchBySourceId.get(item.sourceStockItemId);
            return Boolean(dispatched && dispatched.sourceItem.status === 'Available' && dispatched.qty >= item.qty);
          });
        });
      const linkedBorrowItemBySourceId = new Map(
        linkedBorrowRequests.flatMap(({ request }) => request.items.map((item) => [item.sourceStockItemId, request] as const))
      );

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
            projectBorrowRequestNo: linkedBorrowItemBySourceId.get(sourceStockItemId)?.requestNo,
            borrowedFromProjectNo: linkedBorrowItemBySourceId.get(sourceStockItemId)?.lenderProjectNo,
            borrowerProjectNo: linkedBorrowItemBySourceId.get(sourceStockItemId)?.borrowerProjectNo || targetProject.projectNo,
            status: 'In Transit',
            lastDispatchNo: dispatchNo,
            lastDispatchedAt: dispatchedAt,
          })
        );
      });

      linkedBorrowRequests.forEach(({ request, ref }) => {
        transaction.set(ref, stripUndefined({
          status: 'In Transit',
          dispatchNo,
          dispatchedAt,
          items: request.items.map((item) => ({
            ...item,
            dispatchStockItemId: dispatchBySourceId.get(item.sourceStockItemId)?.stockReceiveNo,
          })),
        }), { merge: true });
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
    await logInventoryActivity('DISPATCH', userProfile, {
      dispatchNo,
      sourceProjectNo: sourceProject.projectNo,
      destinationProjectNo: targetProject.projectNo,
      totalQty: selectedItems.reduce((sum, { line }) => sum + line.qty, 0),
      itemCount: selectedItems.length,
    });
  }, [items, projectBorrowList, projectList, userProfile]);

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
    await logInventoryActivity('DELETE_ITEM', userProfile, {
      entityType: 'dispatch',
      dispatchNo: target.dispatchNo,
      sourceProjectNo: target.sourceProjectNo,
      destinationProjectNo: target.destinationProjectNo,
      reason: 'dispatch_cancelled',
    });
  }, [dispatchList, userProfile]);

  const createWithdraw = useCallback(async ({
    projectNo,
    type,
    items: selectedLines,
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
        requesterName: normalizeText(line.requesterName),
      }))
      .filter((line) => line.receiveNo && Number.isFinite(line.qty) && line.qty > 0);

    if (!normalizedProjectNo) {
      throw new Error('Please select an active project before creating a withdrawal.');
    }

    const sourceProject = visibleProjects.find((project) => projectNoMatches(project.projectNo, normalizedProjectNo));
    if (!sourceProject) {
      throw new Error('You can create withdrawals only for projects assigned to your account.');
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
    const lineWithoutRequester = normalizedLines.find((line) => !line.requesterName);
    if (lineWithoutRequester) {
      throw new Error(`Please enter the requester or responsible person for item ${lineWithoutRequester.receiveNo}.`);
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
          requesterName: line.requesterName,
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
        requesterName: withdrawSnapshots[0]?.requesterName || '',
        requesterPhone: '',
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
    await logInventoryActivity('WITHDRAW', userProfile, {
      withdrawNo,
      projectNo: sourceProject.projectNo,
      type: normalizedType,
      totalQty: selectedItems.reduce((sum, { line }) => sum + line.qty, 0),
      itemCount: selectedItems.length,
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
    await logInventoryActivity('RECEIVE_RETURN', userProfile, {
      withdrawNo: target.withdrawNo,
      projectNo: target.projectNo,
      totalQty: target.totalQty,
    });
  }, [items, userProfile, withdrawList]);

  const cancelWithdraw = useCallback(async (withdrawId: string) => {
    if (!userProfile?.role.includes('MasterAdmin')) {
      throw new Error('เฉพาะ MasterAdmin เท่านั้นที่สามารถยกเลิกรายการเบิกได้');
    }

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
    await logInventoryActivity('DELETE_ITEM', userProfile, {
      entityType: 'withdraw',
      withdrawNo: target.withdrawNo,
      projectNo: target.projectNo,
      reason: 'withdraw_cancelled',
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
      const isProjectBorrowTransit = Boolean(transitStockItem?.projectBorrowRequestNo);
      const existingDestinationItem = findStockItemByIdentity(
        items,
        destinationProjectNo,
        materialNo,
        transitIds,
      );
      const destinationStockItemId = isProjectBorrowTransit
        ? `${item.stockReceiveNo}-BORROWED`
        : existingDestinationItem
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
      const borrowCandidates = projectBorrowList.filter((request) =>
        request.status === 'In Transit' && request.dispatchNo === target.dispatchNo
      );
      const borrowRefs = borrowCandidates.map((request) =>
        doc(db, APP_NAME, 'root', 'projectBorrowRequests', request.id)
      );
      const borrowSnapshots = await Promise.all(borrowRefs.map((borrowRef) => transaction.get(borrowRef)));
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

      const transferHistoryItems = receivedSnapshots
        .filter((item) => item.receivedQty > 0)
        .map((item) => ({
          itemNo: item.itemNo,
          itemDescription: item.itemDescription,
          orderedQty: item.qty,
          receivedQty: item.receivedQty,
          unit: item.unit,
          amount: calculatePartialAmount(item.amount ?? 0, item.qty, item.receivedQty),
          materialNo: item.materialNo,
          stockReceiveNo: item.destinationStockItemId,
        }));

      const receivedBySourceId = new Map(
        receivedSnapshots.map((item) => [item.sourceStockItemId, item])
      );
      const linkedReceiveRequests = borrowCandidates
        .map((request, index) => ({ request, ref: borrowRefs[index], snapshot: borrowSnapshots[index] }))
        .filter(({ snapshot }) => snapshot.exists())
        .map(({ request, ref, snapshot }) => ({
          request: normalizeProjectBorrowRequest(snapshot?.data() as DocumentData, request.id),
          ref,
        }))
        .filter(({ request }) => request.status === 'In Transit');
      const borrowDestinationIds = new Set(
        linkedReceiveRequests.flatMap(({ request }) => request.items
          .map((item) => receivedBySourceId.get(item.sourceStockItemId)?.destinationStockItemId)
          .filter((stockItemId): stockItemId is string => Boolean(stockItemId)))
      );

      linkedReceiveRequests.forEach(({ request, ref }) => {
        const nextItems = request.items.map((item) => {
          const received = receivedBySourceId.get(item.sourceStockItemId);
          return {
            ...item,
            borrowedStockItemId: received?.destinationStockItemId || item.borrowedStockItemId,
            receivedQty: received?.receivedQty ?? item.receivedQty ?? 0,
          };
        });
        const isFullyReceived = nextItems.every((item) => (item.receivedQty ?? 0) >= item.qty);
        transaction.set(ref, stripUndefined({
          status: isFullyReceived ? 'Borrowed' : 'In Transit',
          receivedAt: isFullyReceived ? receivedAt : undefined,
          items: nextItems,
        }), { merge: true });
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
            status: borrowDestinationIds.has(destinationStockItemId) ? 'Borrowed' : 'Received at Site',
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

      const transferHistoryId = `${target.dispatchNo}-RECEIVE`;
      const transferHistoryRef = doc(db, APP_NAME, 'root', 'receivingRequests', transferHistoryId);
      transaction.set(
        transferHistoryRef,
        stripUndefined({
          id: transferHistoryId,
          documentNo: target.dispatchNo,
          receiveNo: target.dispatchNo,
          poNo: '-',
          prNo: '-',
          poType: 'Project Transfer',
          projectId: target.destinationProjectNo,
          cmgProjectCode: destinationProjectNo,
          projectNo: target.destinationProjectNo,
          projectName: target.destinationProjectName,
          location: createProjectStoreLocation(target.destinationProjectNo),
          vendorName: '',
          receiveName: receivedByName,
          receiveDate: receivedAt,
          receivedByUid,
          receivedByName,
          receivedByEmail,
          note: `รับเข้ามาจากการย้ายโครงการ ${target.sourceProjectNo} → ${target.destinationProjectNo} (${target.dispatchNo})`,
          sourceApp: 'Project Transfer',
          externalDocId: target.dispatchNo,
          requestStatus: 'approved',
          items: transferHistoryItems,
          totalQty: totalReceivedQty,
          totalAmount: roundAmount(transferHistoryItems.reduce((sum, item) => sum + item.amount, 0)),
          requestedAt: target.dispatchedAt,
          approvedAt: receivedAt,
          approvedByUid: receivedByUid,
          approvedByName: receivedByName,
          approvedByEmail: receivedByEmail,
          stockReceiveNos: transferHistoryItems
            .map((item) => item.stockReceiveNo)
            .filter((stockReceiveNo): stockReceiveNo is string => Boolean(stockReceiveNo)),
        })
      );
    });
    await logInventoryActivity('RECEIVE_TRANSFER', userProfile, {
      dispatchNo: target.dispatchNo,
      sourceProjectNo: target.sourceProjectNo,
      destinationProjectNo: target.destinationProjectNo,
      totalQty: target.items.reduce(
        (sum, item) => sum + Math.min(item.qty, receivedQtyByItem.get(item.stockReceiveNo) ?? item.qty),
        0,
      ),
      itemCount: target.items.filter(
        (item) => (receivedQtyByItem.get(item.stockReceiveNo) ?? item.qty) > 0,
      ).length,
    });
  }, [dispatchList, items, projectBorrowList, userProfile]);

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
    await logInventoryActivity('RECEIVE', userProfile, {
      receiveNo: target.receiveNo,
      requestId: target.id,
      projectNo,
      totalQty: receivingItems.reduce<number>((sum, entry) => sum + entry.receivedQty, 0),
      itemCount: assignments.length,
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
    await logInventoryActivity('RECEIVE', userProfile, {
      receiveNo,
      projectNo,
      itemNo: target.itemNo,
      qty: target.qty,
    });
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
    await logInventoryActivity('ADD_ITEM', userProfile, {
      stockItemId,
      receiveNo: item.receiveNo,
      projectNo: getStockItemProjectNo(item),
      itemNo: item.itemNo,
      qty: item.qty,
    });
  }, [userProfile]);

  const importStockItems = useCallback(async ({ projectNo, items: importedItems }: ImportStockInput) => {
    const normalizedProjectNo = normalizeProjectNoText(projectNo);
    if (!normalizedProjectNo || importedItems.length === 0) {
      throw new Error('กรุณาเลือกโครงการและระบุสินค้าอย่างน้อย 1 รายการ');
    }

    const project = visibleProjects.find(
      (entry) => normalizeProjectNoText(entry.projectNo) === normalizedProjectNo
    );
    if (!project) {
      throw new Error(`ไม่พบโครงการ ${projectNo}`);
    }

    const importedAt = new Date().toISOString();
    const importNo = createImportNumber(normalizedProjectNo);
    const receiver = createReceivedBySnapshot(userProfile, 'CSV Import');
    const groupedItems = Array.from(importedItems.reduce((groups, item) => {
      const materialNo = normalizeMaterialNo(item.itemNo);
      const existing = groups.get(materialNo);
      if (existing) {
        existing.qty += item.qty;
        existing.prNo = existing.prNo || item.prNo;
        existing.itemType = existing.itemType || item.itemType;
        existing.itemTypeGroup = existing.itemTypeGroup || item.itemTypeGroup;
      } else {
        groups.set(materialNo, { ...item, itemNo: materialNo });
      }
      return groups;
    }, new Map<string, ImportStockLineInput>()).values());
    const assignments = groupedItems.map((item) => {
      const existingStockItem = findStockItemByIdentity(
        visibleStockItems,
        normalizedProjectNo,
        item.itemNo,
      );
      return {
        item,
        stockItemId: existingStockItem
          ? getStockItemId(existingStockItem)
          : createStockIdentityDocumentId(normalizedProjectNo, item.itemNo),
      };
    });

    if (assignments.some(({ stockItemId }) => !stockItemId)) {
      throw new Error('พบรหัสสินค้าที่ไม่สามารถบันทึกได้');
    }

    const chunkSize = 350;
    const assignmentChunks = Array.from(
      { length: Math.ceil(assignments.length / chunkSize) },
      (_, index) => assignments.slice(index * chunkSize, (index + 1) * chunkSize),
    );

    for (let chunkIndex = 0; chunkIndex < assignmentChunks.length; chunkIndex += 1) {
      const chunkAssignments = assignmentChunks[chunkIndex];
      const requestId = assignmentChunks.length === 1
        ? importNo
        : `${importNo}-${String(chunkIndex + 1).padStart(2, '0')}`;
      const requestRef = doc(db, APP_NAME, 'root', 'receivingRequests', requestId);
      await runTransaction(db, async (transaction) => {
        const snapshots = await Promise.all(chunkAssignments.map(({ stockItemId }) => (
          transaction.get(doc(db, APP_NAME, 'root', 'stockItems', stockItemId))
        )));

        chunkAssignments.forEach(({ item, stockItemId }, index) => {
        const snapshot = snapshots[index];
        const existing = snapshot.exists()
          ? normalizeStockItem(snapshot.data(), snapshot.id)
          : undefined;
        transaction.set(doc(db, APP_NAME, 'root', 'stockItems', stockItemId), stripUndefined({
          stockItemId,
          receiveNo: existing?.receiveNo || requestId,
          sourceReceiveNo: requestId,
          poNo: existing?.poNo || '',
          prNo: item.prNo || existing?.prNo || '',
          poType: existing?.poType || 'CSV Import',
          itemNo: item.itemNo,
          itemDescription: existing?.itemDescription || item.itemDescription,
          materialNo: item.itemNo,
          itemType: item.itemType || existing?.itemType,
          itemTypeGroup: item.itemTypeGroup || existing?.itemTypeGroup,
          amount: existing?.amount ?? 0,
          qty: (existing?.qty ?? 0) + item.qty,
          vendorName: existing?.vendorName || 'CSV Import',
          location: createProjectStoreLocation(normalizedProjectNo),
          purchasedForProject: createProjectLabel(normalizedProjectNo),
          projectId: project.projectId || normalizedProjectNo,
          cmgProjectCode: normalizedProjectNo,
          receiveName: receiver.receivedByName,
          receiveDate: importedAt,
          receivedByUid: receiver.receivedByUid,
          receivedByName: receiver.receivedByName,
          receivedByEmail: receiver.receivedByEmail,
          lastReceiveEventId: requestId,
          lastReceivedQty: item.qty,
          lastReceivedAt: importedAt,
          status: 'Received at Site' as const,
        }), { merge: true });
        });

        transaction.set(requestRef, stripUndefined({
        id: requestId,
        receiveNo: requestId,
        poNo: '',
        prNo: Array.from(new Set(chunkAssignments.map(({ item }) => item.prNo).filter(Boolean))).join(', '),
        poType: 'CSV Import',
        projectId: project.projectId || normalizedProjectNo,
        cmgProjectCode: normalizedProjectNo,
        projectNo: normalizedProjectNo,
        projectName: project.projectName,
        location: createProjectStoreLocation(normalizedProjectNo),
        vendorName: 'CSV Import',
        receiveName: receiver.receivedByName,
        receiveDate: importedAt,
        receivedByUid: receiver.receivedByUid,
        receivedByName: receiver.receivedByName,
        sourceApp: 'CSV Import',
        requestStatus: 'approved',
        requestedAt: importedAt,
        approvedAt: importedAt,
        approvedByUid: receiver.receivedByUid,
        approvedByName: receiver.receivedByName,
        approvedByEmail: receiver.receivedByEmail,
        items: chunkAssignments.map(({ item, stockItemId }) => ({
          itemNo: item.itemNo,
          materialNo: item.itemNo,
          prNo: item.prNo,
          itemDescription: item.itemDescription,
          receivedQty: item.qty,
          amount: 0,
          itemType: item.itemType,
          itemTypeGroup: item.itemTypeGroup,
          stockReceiveNo: stockItemId,
        })),
        stockReceiveNos: chunkAssignments.map(({ stockItemId }) => stockItemId),
        totalQty: chunkAssignments.reduce<number>((sum, { item }) => sum + item.qty, 0),
        totalAmount: 0,
        }));
      });
    }
    await logInventoryActivity('RECEIVE_IMPORT', userProfile, {
      importNo,
      projectNo: normalizedProjectNo,
      totalQty: groupedItems.reduce((sum, item) => sum + item.qty, 0),
      itemCount: groupedItems.length,
    });
  }, [userProfile, visibleProjects, visibleStockItems]);

  const updateProjectStockItem = useCallback(async ({
    projectNo,
    stockItemIds,
    itemNo,
    itemDescription,
  }: UpdateProjectStockItemInput) => {
    if (!userProfile?.role.includes('MasterAdmin')) {
      throw new Error('เฉพาะ MasterAdmin เท่านั้นที่สามารถแก้ไขรายละเอียดสินค้าได้');
    }

    const normalizedProjectNo = normalizeProjectNoText(projectNo);
    const normalizedItemNo = normalizeText(itemNo);
    const normalizedItemDescription = normalizeText(itemDescription);
    const requestedStockItemIds = [...new Set(stockItemIds.map((id) => normalizeText(id)).filter(Boolean))];

    if (!normalizedProjectNo || !normalizedItemNo || !normalizedItemDescription) {
      throw new Error('กรุณาระบุโครงการ รหัสสินค้า และชื่อสินค้าให้ครบถ้วน');
    }

    const targetItems = items.filter((item) => (
      requestedStockItemIds.includes(getStockItemId(item)) &&
      projectNoMatches(getStockItemProjectNo(item), normalizedProjectNo)
    ));

    if (!targetItems.length) {
      throw new Error('ไม่พบรายการสินค้าในโครงการ กรุณารีเฟรชแล้วลองใหม่');
    }

    const stockRefs = targetItems.map((item) => (
      doc(db, APP_NAME, 'root', 'stockItems', getStockItemId(item))
    ));

    await runTransaction(db, async (transaction) => {
      const stockSnapshots = await Promise.all(stockRefs.map((stockRef) => transaction.get(stockRef)));

      stockSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists()) {
          throw new Error('ไม่พบรายการสินค้าแล้ว กรุณารีเฟรชแล้วลองใหม่');
        }

        const currentItem = normalizeStockItem(snapshot.data(), snapshot.id);
        if (!projectNoMatches(getStockItemProjectNo(currentItem), normalizedProjectNo)) {
          throw new Error('รายการสินค้าไม่อยู่ในโครงการที่เลือก');
        }

        // Intentionally update only the item identity fields. Quantity and all stock movement data remain unchanged.
        transaction.update(stockRefs[index], {
          itemNo: normalizedItemNo,
          materialNo: normalizedItemNo,
          itemDescription: normalizedItemDescription,
        });
      });
    });
    await logInventoryActivity('EDIT_ITEM', userProfile, {
      projectNo: normalizedProjectNo,
      stockItemIds: targetItems.map((item) => getStockItemId(item)),
      itemNo: normalizedItemNo,
      itemDescription: normalizedItemDescription,
      itemCount: targetItems.length,
    });
  }, [items, userProfile]);

  const deleteProjectStockItem = useCallback(async ({
    projectNo,
    stockItemIds,
  }: DeleteProjectStockItemInput) => {
    if (!userProfile?.role.includes('MasterAdmin')) {
      throw new Error('Only MasterAdmin can delete stock items.');
    }

    const normalizedProjectNo = normalizeProjectNoText(projectNo);
    const requestedStockItemIds = [...new Set(stockItemIds.map((id) => normalizeText(id)).filter(Boolean))];

    if (!normalizedProjectNo || !requestedStockItemIds.length) {
      throw new Error('Project and stock item identifiers are required.');
    }

    const targetItems = items.filter((item) => (
      requestedStockItemIds.includes(getStockItemId(item)) &&
      projectNoMatches(getStockItemProjectNo(item), normalizedProjectNo)
    ));

    if (!targetItems.length) {
      throw new Error('Stock item was not found. Please refresh and try again.');
    }

    const stockRefs = targetItems.map((item) => (
      doc(db, APP_NAME, 'root', 'stockItems', getStockItemId(item))
    ));
    const deleteHistoryCollection = collection(db, APP_NAME, 'root', 'deleteitemhistory');
    const deletedAt = new Date().toISOString();
    const deletedBy = createReceivedBySnapshot(userProfile, 'MasterAdmin');
    const historyRefs = targetItems.map(() => doc(deleteHistoryCollection));

    await runTransaction(db, async (transaction) => {
      const stockSnapshots = await Promise.all(stockRefs.map((stockRef) => transaction.get(stockRef)));

      stockSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists()) {
          throw new Error('Stock item was not found. Please refresh and try again.');
        }

        const currentItem = normalizeStockItem(snapshot.data(), snapshot.id);
        if (!projectNoMatches(getStockItemProjectNo(currentItem), normalizedProjectNo)) {
          throw new Error('Stock item is not in the selected project.');
        }

        const originalData = snapshot.data();
        transaction.set(historyRefs[index], stripUndefined({
          ...originalData,
          id: historyRefs[index].id,
          historyId: historyRefs[index].id,
          action: 'delete_project_stock_item',
          originalStockItemId: snapshot.id,
          deletedProjectNo: normalizedProjectNo,
          sourcePath: `${APP_NAME}/root/stockItems/${snapshot.id}`,
          deletedAt,
          deletedByUid: deletedBy.receivedByUid,
          deletedByName: deletedBy.receivedByName,
          deletedByEmail: deletedBy.receivedByEmail,
          recoverable: true,
          originalData,
        }));
        transaction.delete(stockRefs[index]);
      });
    });

    await logInventoryActivity('DELETE_ITEM', userProfile, {
      entityType: 'projectStock',
      projectNo: normalizedProjectNo,
      stockItemIds: targetItems.map((item) => getStockItemId(item)),
      itemNo: targetItems[0]?.itemNo,
      itemDescription: targetItems[0]?.itemDescription,
      itemCount: targetItems.length,
    });
  }, [items, userProfile]);

  const deleteReceivingRequest = useCallback(async (requestId: string) => {
    if (!userProfile?.role.includes('MasterAdmin')) {
      throw new Error('เฉพาะ MasterAdmin เท่านั้นที่สามารถลบรายการรับเข้าได้');
    }

    const target = receivingRequestList.find((request) => request.id === requestId);
    if (!target || target.requestStatus !== 'approved' || !target.items.length) {
      throw new Error('ไม่พบรายการรับเข้าที่ต้องการลบ กรุณารีเฟรชแล้วลองใหม่');
    }

    const requestRef = doc(db, APP_NAME, 'root', 'receivingRequests', requestId);
    const deleteLogRef = doc(collection(db, APP_NAME, 'root', 'logdeletes'));
    const deletedAt = new Date().toISOString();
    const deletedBy = createReceivedBySnapshot(userProfile, 'MasterAdmin');

    await runTransaction(db, async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);

      if (!requestSnapshot.exists()) {
        throw new Error('ไม่พบประวัติการรับเข้านี้แล้ว');
      }

      const requestData = requestSnapshot.data() as DocumentData;
      if (normalizeReceivingRequestStatus(requestData.requestStatus ?? requestData.status) !== 'approved') {
        throw new Error('ลบได้เฉพาะรายการรับเข้าที่อนุมัติแล้ว');
      }

      const rawItems = parseReceivingItems(requestData.items);
      const requestStockReceiveNos = normalizeStringArray(requestData.stockReceiveNos);
      const receivingItems = rawItems
        .map((rawItem, rawIndex) => {
          const rawItemData = rawItem && typeof rawItem === 'object'
            ? rawItem as DocumentData
            : ({} as DocumentData);
          return {
            item: normalizeReceivingRequestItem(rawItemData, rawIndex),
          };
        })
        .filter(({ item }) => item.receivedQty > 0)
        .map(({ item }, itemIndex) => ({
          item,
          stockItemId: item.stockReceiveNo || requestStockReceiveNos[itemIndex],
        }));

      if (!receivingItems.length || receivingItems.some(({ stockItemId }) => !stockItemId)) {
        throw new Error('พบรายการที่ไม่มี Stock Receive No. จึงไม่สามารถลบ Request นี้ได้');
      }

      const deductions = receivingItems.reduce((groups, { item, stockItemId }) => {
        const current = groups.get(stockItemId) ?? { qty: 0, amount: 0 };
        current.qty += item.receivedQty;
        current.amount = roundAmount(current.amount + item.amount);
        groups.set(stockItemId, current);
        return groups;
      }, new Map<string, { qty: number; amount: number }>());
      const stockEntries = Array.from(deductions.entries());
      const stockRefs = stockEntries.map(([stockItemId]) => (
        doc(db, APP_NAME, 'root', 'stockItems', stockItemId)
      ));
      const stockSnapshots = await Promise.all(stockRefs.map((stockRef) => transaction.get(stockRef)));

      const stockChanges = stockEntries.map(([stockItemId, deduction], index) => {
        const stockSnapshot = stockSnapshots[index];
        if (!stockSnapshot.exists()) {
          throw new Error(`ไม่พบสินค้า ${stockItemId} ในสต็อก จึงไม่สามารถลบ Request นี้ได้`);
        }

        const stockItem = normalizeStockItem(stockSnapshot.data(), stockSnapshot.id);
        if (stockItem.qty < deduction.qty) {
          throw new Error(
            `ไม่สามารถลบได้ เนื่องจาก ${stockItemId} คงเหลือ ${stockItem.qty.toLocaleString()} ชิ้น แต่ Request นี้รับเข้า ${deduction.qty.toLocaleString()} ชิ้น`
          );
        }

        const remainingQty = stockItem.qty - deduction.qty;
        const remainingAmount = Math.max(0, roundAmount(stockItem.amount - deduction.amount));
        const beforeData = stockSnapshot.data() as DocumentData;
        const afterData = remainingQty === 0
          ? null
          : {
              ...beforeData,
              qty: remainingQty,
              amount: remainingAmount,
              ...(stockItem.lastReceiveEventId === requestId
                ? { lastReceiveEventId: '', lastReceivedQty: 0, lastReceivedAt: '' }
                : {}),
            };

        return {
          stockItemId,
          deductedQty: deduction.qty,
          deductedAmount: deduction.amount,
          before: beforeData,
          after: afterData,
          stockDocumentDeleted: remainingQty === 0,
        };
      });

      stockChanges.forEach((change, index) => {
        if (change.stockDocumentDeleted) {
          transaction.delete(stockRefs[index]);
        } else {
          transaction.update(stockRefs[index], {
            qty: change.after?.qty,
            amount: change.after?.amount,
            ...(change.before.lastReceiveEventId === requestId
              ? { lastReceiveEventId: '', lastReceivedQty: 0, lastReceivedAt: '' }
              : {}),
          });
        }
      });

      transaction.set(deleteLogRef, stripUndefined({
        id: deleteLogRef.id,
        action: 'delete_receiving_request',
        entityType: 'receivingRequest',
        requestId,
        deletedAt,
        deletedByUid: deletedBy.receivedByUid,
        deletedByName: deletedBy.receivedByName,
        deletedByEmail: deletedBy.receivedByEmail,
        recoverable: true,
        sourcePath: `${APP_NAME}/root/receivingRequests/${requestId}`,
        originalRequest: {
          documentId: requestSnapshot.id,
          data: requestData,
        },
        stockChanges,
      }));
      transaction.delete(requestRef);
    });
    await logInventoryActivity('DELETE_ITEM', userProfile, {
      entityType: 'receivingRequest',
      requestId,
      receiveNo: target.receiveNo,
      projectNo: target.projectNo || target.cmgProjectCode,
      itemCount: target.items.length,
    });
  }, [receivingRequestList, userProfile]);

  const receivePrPoPayload = useCallback(async (payload: PrPoReceivePayload) => {
    const response = await processPrPoReceivePayload(payload);
    await logInventoryActivity('RECEIVE', userProfile, {
      source: 'PR_PO_INTEGRATION',
      projectNo: payload.cmgProjectCode || payload.projectId,
      itemCount: payload.items?.length ?? 0,
      result: response.message,
    });
    return response;
  }, [userProfile]);

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
    await logInventoryActivity('EDIT_PROJECT_STATUS', userProfile, {
      projectNo: normalizedProjectNo,
      status: normalizedStatus,
    });
  }, [userProfile]);

  const value = useMemo<InventoryContextValue>(
    () => ({
      projects: visibleProjects,
      allProjects: projectList,
      activeProjects: activeVisibleProjects,
      stockItems: visibleStockItems,
      allStockItems: items,
      receivingRequests: visibleReceivingRequests,
      dispatchRecords: visibleDispatchRecords,
      withdrawRecords: visibleWithdrawRecords,
      projectBorrowRequests: visibleProjectBorrowRequests,
      cancellationRequests: visibleCancellationRequests,
      updateProjectStatus,
      createDispatch,
      cancelDispatch,
      createWithdraw,
      returnWithdraw,
      cancelWithdraw,
      createProjectBorrowRequest,
      approveProjectBorrowRequest,
      rejectProjectBorrowRequest,
      requestProjectBorrowReturn,
      completeProjectBorrowReturn,
      createCancellationRequest,
      approveCancellationRequest,
      rejectCancellationRequest,
      approveReceipt,
      approveReceivingRequest,
      receiveDispatch,
      receiveNewItem,
      importStockItems,
      updateProjectStockItem,
      deleteProjectStockItem,
      deleteReceivingRequest,
      receivePrPoPayload,
      activeProjectNo,
      setActiveProjectNo,
    }),
    [
      activeProjectNo,
      approveProjectBorrowRequest,
      approveReceivingRequest,
      approveReceipt,
      createDispatch,
      createProjectBorrowRequest,
      cancelDispatch,
      createWithdraw,
      cancelWithdraw,
      completeProjectBorrowReturn,
      createCancellationRequest,
      approveCancellationRequest,
      rejectCancellationRequest,
      receiveDispatch,
      receiveNewItem,
      importStockItems,
      updateProjectStockItem,
      deleteProjectStockItem,
      deleteReceivingRequest,
      receivePrPoPayload,
      rejectProjectBorrowRequest,
      requestProjectBorrowReturn,
      returnWithdraw,
      updateProjectStatus,
      activeVisibleProjects,
      projectList,
      visibleDispatchRecords,
      visibleReceivingRequests,
      visibleStockItems,
      visibleWithdrawRecords,
      visibleProjects,
      visibleProjectBorrowRequests,
      visibleCancellationRequests,
      items,
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
