import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import type {
  CancellationRequest,
  ReceivingRequest,
  StockItem,
  UserRole,
} from '../types/models';

export type PendingTaskType = 'receiving' | 'dispatch' | 'withdraw' | 'projectBorrow' | 'cancellation' | 'admin';

export interface PendingTask {
  id: string;
  type: PendingTaskType;
  title: string;
  description: string;
  route: string;
  projectNo?: string;
  timestamp?: string;
}

interface PendingUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  createdAt?: unknown;
}

const PROJECT_APPROVER_ROLES: UserRole[] = ['Admin Site', 'Store Site', 'Keeper'];
const PROJECT_DISPATCH_ROLES: UserRole[] = ['Store Site'];
const PROJECT_WITHDRAW_ROLES: UserRole[] = ['Admin Site', 'Store Site'];

function normalizeProjectNo(value?: string) {
  const text = value?.trim() ?? '';
  if (!text) return '';
  const match = text.match(/\bJ[-\s]?0*([0-9]+[a-z0-9]*)\b/i);
  if (match) return `J${match[1].toUpperCase()}`;
  return text.toUpperCase();
}

function projectMatches(left?: string, right?: string) {
  const normalizedLeft = normalizeProjectNo(left);
  const normalizedRight = normalizeProjectNo(right);
  return Boolean(normalizedLeft && normalizedLeft === normalizedRight);
}

function getProjectCodeFromReceiving(request: ReceivingRequest) {
  return request.cmgProjectCode || request.projectItemCode || request.projectNo || request.projectId || request.projectName || request.location;
}

function getProjectCodeFromStock(item: StockItem) {
  return item.cmgProjectCode || item.projectId || item.purchasedForProject || item.location;
}

function getUserName(user: PendingUser) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'ผู้ใช้ใหม่';
}

function getSortableTimestamp(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return new Date(value.toMillis()).toISOString();
  }
  return undefined;
}

export function usePendingTasks() {
  const { userProfile } = useAuth();
  const { allProjects, receivingRequests, dispatchRecords, stockItems, withdrawRecords, projectBorrowRequests, cancellationRequests } = useInventory();
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);

  useEffect(() => {
    if (!userProfile?.role.includes('MasterAdmin')) {
      setPendingUsers([]);
      return;
    }

    const usersRef = collection(db, 'CMG-Store-Management', 'root', 'users');
    const usersQuery = query(usersRef, where('status', '==', 'pending'));
    return onSnapshot(usersQuery, (snapshot) => {
      setPendingUsers(snapshot.docs.map((userDoc) => ({
        id: userDoc.id,
        ...(userDoc.data() as Omit<PendingUser, 'id'>),
      })));
    }, (error) => {
      console.error('Failed to listen to pending user tasks:', error);
      setPendingUsers([]);
    });
  }, [userProfile]);

  const tasks = useMemo<PendingTask[]>(() => {
    if (!userProfile) return [];

    const globalRoles = new Set(userProfile.role);
    const resolveProjectNo = (value?: string) => {
      const normalized = normalizeProjectNo(value);
      return allProjects.find((project) => normalizeProjectNo(project.projectNo) === normalized)?.projectNo || value?.trim() || undefined;
    };
    const hasGlobalRole = (allowedRoles: readonly UserRole[]) => allowedRoles.some((role) => globalRoles.has(role));
    const getProjectRoles = (projectNo?: string) => {
      const matchingEntry = Object.entries(userProfile.projectRoles || {}).find(([key]) => projectMatches(key, projectNo));
      return new Set<UserRole>([...userProfile.role, ...(matchingEntry?.[1] || [])]);
    };
    const isAssignedToProject = (projectNo?: string) =>
      hasGlobalRole(['MasterAdmin', 'Store Center']) ||
      Boolean(projectNo && userProfile.assignedProjects?.some((assignedProjectNo) => projectMatches(assignedProjectNo, projectNo)));
    const hasProjectRole = (projectNo: string | undefined, allowedRoles: readonly UserRole[]) =>
      allowedRoles.some((role) => getProjectRoles(projectNo).has(role));
    const canReceive = hasGlobalRole(['MasterAdmin', 'Store Center']);
    const canApproveProjectBorrow = (projectNo?: string) =>
      hasGlobalRole(['MasterAdmin', 'Store Center']) ||
      (isAssignedToProject(projectNo) && hasProjectRole(projectNo, PROJECT_APPROVER_ROLES));
    const canDispatchForProject = (projectNo?: string) =>
      hasGlobalRole(['MasterAdmin', 'Store Center']) ||
      (isAssignedToProject(projectNo) && hasProjectRole(projectNo, PROJECT_DISPATCH_ROLES));
    const canReturnWithdrawForProject = (projectNo?: string) =>
      hasGlobalRole(['MasterAdmin', 'Store Center']) ||
      (isAssignedToProject(projectNo) && hasProjectRole(projectNo, PROJECT_WITHDRAW_ROLES));
    const canApproveCancellation = (request: CancellationRequest) => {
      if (hasGlobalRole(['MasterAdmin', 'Store Center'])) return true;
      const relatedProject = request.projectNos.find((projectNo) => isAssignedToProject(projectNo));
      return Boolean(relatedProject && hasProjectRole(relatedProject, PROJECT_APPROVER_ROLES));
    };

    const nextTasks: PendingTask[] = [];

    if (canReceive) {
      receivingRequests
        .filter((request) => request.requestStatus === 'pending')
        .forEach((request) => {
          const projectNo = resolveProjectNo(getProjectCodeFromReceiving(request));
          nextTasks.push({
            id: `receiving:${request.id}`,
            type: 'receiving',
            title: 'คำขอรับสินค้าใหม่',
            description: `${request.receiveNo || request.id} · ${projectNo || 'ไม่ระบุโครงการ'}`,
            route: '/receiving?tab=receive',
            projectNo,
            timestamp: request.requestedAt,
          });
        });

      dispatchRecords
        .filter((record) => record.status === 'Pending Receipt')
        .forEach((record) => {
          const projectNo = resolveProjectNo(record.destinationProjectNo || record.destinationProjectName);
          nextTasks.push({
            id: `dispatch-receipt:${record.id}`,
            type: 'receiving',
            title: 'ย้ายโครงการรอรับเข้า',
            description: `${record.dispatchNo} · จาก ${record.sourceProjectNo || '-'}`,
            route: '/receiving?tab=incoming',
            projectNo,
            timestamp: record.dispatchedAt,
          });
        });
    }

    stockItems
      .filter((item) => item.status === 'Pending Dispatch')
      .forEach((item) => {
        const projectNo = resolveProjectNo(getProjectCodeFromStock(item));
        if (!canDispatchForProject(projectNo)) return;
        nextTasks.push({
          id: `dispatch:${item.stockItemId || item.receiveNo}`,
          type: 'dispatch',
          title: 'สินค้ารอจัดส่ง',
          description: `${item.itemNo || item.receiveNo} · ${projectNo || 'ไม่ระบุโครงการ'}`,
          route: '/store/dispatch',
          projectNo,
          timestamp: item.receiveNo,
        });
      });

    withdrawRecords
      .filter((record) => record.type === 'borrow' && record.status !== 'Returned' && record.status !== 'Cancelled')
      .forEach((record) => {
        const projectNo = resolveProjectNo(record.projectNo);
        if (!canReturnWithdrawForProject(projectNo)) return;
        nextTasks.push({
          id: `withdraw:${record.id}`,
          type: 'withdraw',
          title: 'สินค้ายืมรอคืน',
          description: `${record.withdrawNo} · ${record.projectName || projectNo || 'ไม่ระบุโครงการ'}`,
          route: '/store/withdraw',
          projectNo,
          timestamp: record.createdAt,
        });
      });

    projectBorrowRequests
      .filter((request) =>
        (request.status === 'Pending Approval' || request.status === 'Return Requested') &&
        request.requestedByUid !== userProfile.uid &&
        canApproveProjectBorrow(request.lenderProjectNo)
      )
      .forEach((request) => {
        const projectNo = resolveProjectNo(request.lenderProjectNo);
        nextTasks.push({
          id: `project-borrow:${request.id}`,
          type: 'projectBorrow',
          title: request.status === 'Pending Approval' ? 'คำขอยืมรออนุมัติ' : 'คำขอยืมรอยืนยันรับคืน',
          description: `${request.requestNo} · ${request.borrowerProjectNo}`,
          route: '/store/project-borrow',
          projectNo,
          timestamp: request.createdAt,
        });
      });

    cancellationRequests
      .filter((request) =>
        request.status === 'Pending Approval' &&
        request.requestedByUid !== userProfile.uid &&
        request.firstApprovedByUid !== userProfile.uid &&
        canApproveCancellation(request)
      )
      .forEach((request) => {
        const projectNo = resolveProjectNo(request.projectNos[0]);
        nextTasks.push({
          id: `cancellation:${request.id}`,
          type: 'cancellation',
          title: `คำขอยกเลิกรออนุมัติขั้นที่ ${request.approvalStep + 1}`,
          description: `${request.cancellationNo} · ${request.projectLabel || projectNo || 'ไม่ระบุโครงการ'}`,
          route: '/cancellations',
          projectNo,
          timestamp: request.requestedAt,
        });
      });

    if (globalRoles.has('MasterAdmin')) {
      pendingUsers.forEach((user) => {
        nextTasks.push({
          id: `admin:${user.id}`,
          type: 'admin',
          title: 'ผู้ใช้ใหม่รออนุมัติ',
          description: getUserName(user),
          route: '/admin',
          timestamp: getSortableTimestamp(user.createdAt),
        });
      });
    }

    return nextTasks.sort((left, right) => (right.timestamp || '').localeCompare(left.timestamp || ''));
  }, [allProjects, cancellationRequests, dispatchRecords, pendingUsers, projectBorrowRequests, receivingRequests, stockItems, userProfile, withdrawRecords]);

  return { tasks };
}
