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
  | 'Pending Dispatch'
  | 'In Transit'
  | 'Received at Site';

export type DispatchRecordStatus =
  | 'Pending Receipt'
  | 'Received at Site';

export type ReceivingRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface StockItem {
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
}

export interface ReceivingRequestItem {
  itemNo: string;
  itemDescription: string;
  orderedQty?: number;
  receivedQty: number;
  unit?: string;
  price?: number;
  amount: number;
  materialNo?: string;
  photos?: string[];
  stockReceiveNo?: string;
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
}

export interface DispatchItemSnapshot {
  receiveNo: string;
  stockReceiveNo: string;
  prNo: string;
  poNo: string;
  itemNo: string;
  itemDescription: string;
  qty: number;
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
}

export type UserRole =
  | 'MasterAdmin'
  | 'SuperAdmin'
  | 'Admin'
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
