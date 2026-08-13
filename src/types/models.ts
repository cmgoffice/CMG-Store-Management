import { Timestamp } from 'firebase/firestore';

export type ProjectStatus = 'Active' | 'Disactive';

export interface Project {
  projectId?: string;
  projectNo: string;
  projectName: string;
  location: string;
  projectManager: string;
  constructionManager: string;
  status?: ProjectStatus;
  source?: 'local' | 'master';
  lockedFields?: Array<'projectNo' | 'projectName' | 'location' | 'projectManager' | 'constructionManager'>;
}

export type StockStatus =
  | 'Available'
  | 'Pending Dispatch'
  | 'In Transit'
  | 'Received at Site'
  | 'Borrowed'
  | 'Withdrawn';

export type DispatchRecordStatus =
  | 'Pending Receipt'
  | 'Received at Site'
  | 'Dispatch Cancelled';

export type WithdrawType =
  | 'issue'
  | 'borrow';

export type WithdrawRecordStatus =
  | 'Issued'
  | 'Waiting Return'
  | 'Overdue'
  | 'Returned'
  | 'Cancelled';

export type ProjectBorrowStatus =
  | 'Pending Approval'
  | 'Pending Dispatch'
  | 'In Transit'
  | 'Borrowed'
  | 'Rejected'
  | 'Return Requested'
  | 'Returned'
  | 'Cancelled';

export type ReceivingRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export type CancellationEntityType =
  | 'projectStock'
  | 'receiving'
  | 'dispatch'
  | 'withdraw'
  | 'projectBorrow';

export type CancellationRequestStatus =
  | 'Pending Approval'
  | 'Approved'
  | 'Rejected';

export interface CancellationRequest {
  id: string;
  cancellationNo: string;
  entityType: CancellationEntityType;
  entityId: string;
  referenceNo: string;
  projectNos: string[];
  projectLabel?: string;
  reason: string;
  cancelQty?: number;
  status: CancellationRequestStatus;
  approvalStep: 0 | 1 | 2;
  requestedByUid: string;
  requestedByName: string;
  requestedByEmail: string;
  requestedAt: string;
  firstApprovedAt?: string;
  firstApprovedByUid?: string;
  firstApprovedByName?: string;
  firstApprovedByEmail?: string;
  secondApprovedAt?: string;
  secondApprovedByUid?: string;
  secondApprovedByName?: string;
  secondApprovedByEmail?: string;
  rejectedAt?: string;
  rejectedByUid?: string;
  rejectedByName?: string;
  rejectedReason?: string;
  completedAt?: string;
  completedByUid?: string;
  completedByName?: string;
  completedByEmail?: string;
}

export interface StockItem {
  stockItemId?: string;
  receiveNo: string;
  poNo: string;
  prNo: string;
  poType: string;
  itemNo: string;
  itemDescription: string;
  amount: number;
  qty: number;
  vendorName: string;
  location: string;
  purchasedForProject: string;
  receiveName: string;
  receiveDate: string;
  status: StockStatus;
  sourceApp?: string;
  sourceReceiveNo?: string;
  rpNo?: string;
  receiveType?: string;
  itemType?: string;
  itemTypeGroup?: 'Type 1' | 'Type 2';
  iditem?: string;
  materialNo?: string;
  unit?: string;
  poItemIndex?: string | number;
  orderedQty?: number;
  unitPrice?: number;
  projectId?: string;
  cmgProjectCode?: string;
  vendorId?: string;
  documentNo?: string;
  poId?: string | number;
  receivedByUid?: string;
  receivedByName?: string;
  receivedByEmail?: string;
  note?: string;
  lastReceiveEventId?: string;
  lastReceivedQty?: number;
  lastReceivedAt?: string;
  projectBorrowRequestNo?: string;
  borrowedFromProjectNo?: string;
  borrowerProjectNo?: string;
}

export interface ReceivingRequestItem {
  itemNo: string;
  itemDescription: string;
  prNo?: string;
  orderedQty?: number;
  receivedQty: number;
  unit?: string;
  price?: number;
  amount: number;
  materialNo?: string;
  photos?: string[];
  stockReceiveNo?: string;
  itemType?: string;
  itemTypeGroup?: 'Type 1' | 'Type 2';
}

export interface ReceivingRequest {
  id: string;
  documentNo?: string;
  receiveNo: string;
  poNo: string;
  prNo: string;
  poType: string;
  poId?: string;
  projectId?: string;
  cmgProjectCode?: string;
  projectNo: string;
  projectName: string;
  projectItemCode?: string;
  location: string;
  vendorName: string;
  receiveName: string;
  receiveDate: string;
  receivedByUid?: string;
  receivedByName?: string;
  note?: string;
  sourceApp?: string;
  externalDocId?: string;
  autoCreatedFromPoApproval?: boolean;
  requestStatus: ReceivingRequestStatus;
  items: ReceivingRequestItem[];
  totalQty: number;
  totalAmount: number;
  requestedAt: string;
  approvedAt?: string;
  approvedByUid?: string;
  approvedByName?: string;
  approvedByEmail?: string;
  stockReceiveNos?: string[];
  cancelledAt?: string;
  cancelledByUid?: string;
  cancelledByName?: string;
  cancelledByEmail?: string;
  cancellationReason?: string;
}

export interface DispatchItemSnapshot {
  stockItemId?: string;
  sourceStockItemId?: string;
  destinationStockItemId?: string;
  receiveNo: string;
  stockReceiveNo: string;
  prNo: string;
  poNo: string;
  itemNo: string;
  itemDescription: string;
  materialNo?: string;
  unit?: string;
  amount?: number;
  qty: number;
  receivedQty?: number;
  vendorName: string;
  sourceLocation: string;
}

export interface DispatchRecord {
  id: string;
  dispatchNo: string;
  sourceProjectNo: string;
  sourceProjectName: string;
  destinationProjectNo: string;
  destinationProjectName: string;
  status: DispatchRecordStatus;
  itemReceiveNos: string[];
  items: DispatchItemSnapshot[];
  totalQty: number;
  transport: string;
  note: string;
  photoUrls: string[];
  dispatchedAt: string;
  dispatchedByName: string;
  dispatchedByEmail: string;
  receivedAt?: string;
  receivedByName?: string;
  receivedByEmail?: string;
  totalReceivedQty?: number;
  cancelledAt?: string;
  cancelledByUid?: string;
  cancelledByName?: string;
  cancelledByEmail?: string;
  cancellationReason?: string;
}

export interface WithdrawItemSnapshot {
  stockItemId: string;
  receiveNo: string;
  prNo: string;
  poNo: string;
  itemNo: string;
  itemDescription: string;
  qty: number;
  returnedQty?: number;
  amount: number;
  unit?: string;
  vendorName: string;
  sourceLocation: string;
  originalStatus: StockStatus;
  stockItemSnapshot?: StockItem;
}

export interface WithdrawRecord {
  id: string;
  withdrawNo: string;
  projectNo: string;
  projectShortNo: string;
  projectName: string;
  type: WithdrawType;
  status: WithdrawRecordStatus;
  requesterName: string;
  requesterPhone: string;
  issuedByUid: string;
  issuedByName: string;
  issuedByEmail: string;
  withdrawDate: string;
  purpose: string;
  dueDate?: string;
  returnedAt?: string;
  returnedByUid?: string;
  returnedByName?: string;
  returnedByEmail?: string;
  cancelledAt?: string;
  cancelledByUid?: string;
  cancelledByName?: string;
  cancelledByEmail?: string;
  cancellationReason?: string;
  itemReceiveNos: string[];
  items: WithdrawItemSnapshot[];
  totalQty: number;
  photoUrls: string[];
  createdAt: string;
}

export interface ProjectBorrowItemSnapshot {
  sourceStockItemId: string;
  dispatchStockItemId?: string;
  borrowedStockItemId?: string;
  receiveNo: string;
  itemNo: string;
  itemDescription: string;
  materialNo?: string;
  itemType?: string;
  unit?: string;
  qty: number;
  receivedQty?: number;
  amount: number;
  vendorName: string;
  sourceLocation: string;
  sourceStatus: StockStatus;
}

export interface ProjectBorrowRequest {
  id: string;
  requestNo: string;
  borrowerProjectNo: string;
  borrowerProjectName: string;
  lenderProjectNo: string;
  lenderProjectName: string;
  status: ProjectBorrowStatus;
  approvalStep: 0 | 1 | 2;
  approvedAt?: string;
  approvedByUid?: string;
  approvedByName?: string;
  firstApprovedAt?: string;
  firstApprovedByUid?: string;
  firstApprovedByName?: string;
  secondApprovedAt?: string;
  secondApprovedByUid?: string;
  secondApprovedByName?: string;
  rejectedAt?: string;
  rejectedByUid?: string;
  rejectedByName?: string;
  returnRequestedAt?: string;
  returnRequestedByUid?: string;
  returnRequestedByName?: string;
  returnedAt?: string;
  returnedByUid?: string;
  returnedByName?: string;
  dispatchNo?: string;
  dispatchedAt?: string;
  receivedAt?: string;
  cancelledAt?: string;
  cancelledByUid?: string;
  cancelledByName?: string;
  cancelledByEmail?: string;
  cancellationReason?: string;
  requestedByUid: string;
  requestedByName: string;
  purpose: string;
  dueDate?: string;
  items: ProjectBorrowItemSnapshot[];
  itemReceiveNos: string[];
  totalQty: number;
  createdAt: string;
}

export type UserRole =
  | 'MasterAdmin'
  | 'Store Center'
  | 'Admin Site'
  | 'Store Site'
  | 'Keeper'
  | 'Staff';

export interface UserProfile {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  position: string;
  role: UserRole[];
  status: 'pending' | 'approved' | 'rejected';
  assignedProjects: string[];
  createdAt: Timestamp;
  photoURL?: string;
  isFirstUser: boolean;
  projectRoles?: Record<string, UserRole[]>;
}

export interface AppMetaConfig {
  firstUserRegistered: boolean;
  totalUsers: number;
  createdAt: Timestamp;
}

export type PrPoReceiveResponseStatus = 'success' | 'duplicate' | 'ignored' | 'failed';

export interface PrPoReceiveItemPayload {
  iditem?: string | number;
  materialNo?: string | number;
  description?: string;
  itemName?: string;
  unit?: string;
  poItemIndex?: string | number;
  orderedQty?: string | number;
  receivedQty?: string | number;
  qtyReceive?: string | number;
  price?: string | number;
  unitPrice?: string | number;
  amount?: string | number;
}

export interface PrPoReceivePayload {
  sourceApp?: string;
  receiveNo?: string;
  rpNo?: string;
  poId?: string | number;
  poNo?: string;
  prNo?: string;
  projectId?: string | number;
  cmgProjectCode?: string;
  vendorId?: string | number;
  vendorName?: string;
  documentNo?: string;
  receivedDate?: string;
  receivedByUid?: string;
  receivedByName?: string;
  note?: string;
  createdAt?: string;
  receiveType?: string;
  items?: PrPoReceiveItemPayload[];
}

export interface PrPoReceiveItemResult {
  status: PrPoReceiveResponseStatus;
  message: string;
  stockItemId?: string;
  itemKey?: string;
  itemKeyType?: 'iditem' | 'materialNo';
  idempotencyKey?: string;
  qtyIncrement?: number;
}

export interface PrPoReceiveResponse {
  status: PrPoReceiveResponseStatus;
  message: string;
  receiveNo?: string;
  processedCount: number;
  duplicateCount: number;
  failedCount: number;
  ignoredCount: number;
  items: PrPoReceiveItemResult[];
}
