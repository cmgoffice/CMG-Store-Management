import { Timestamp } from 'firebase/firestore';

export interface Project {
  projectNo: string;
  projectName: string;
  location: string;
  projectManager: string;
  constructionManager: string;
}

export type StockStatus =
  | 'Pending Dispatch'
  | 'In Transit'
  | 'Received at Site';

export type DispatchRecordStatus =
  | 'Pending Receipt'
  | 'Received at Site';

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

export interface DispatchItemSnapshot {
  receiveNo: string;
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
