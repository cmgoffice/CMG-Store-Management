import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from 'react';
import type { UserRole } from '../types/models';
import { useAuth } from './AuthContext';
import { useInventory } from './InventoryContext';

interface RoleContextValue {
  roles: UserRole[];
  roleLabel: string;
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (allowedRoles: readonly UserRole[]) => boolean;
  canDispatch: boolean;
  canCancelDispatch: boolean;
  canApproveReceipt: boolean;
  canReceiveStock: boolean;
  isReadOnly: boolean;
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

const APP_ROLES: UserRole[] = [
  'MasterAdmin',
  'Store Center',
  'Admin Site',
  'Store Site',
  'Keeper',
  'Staff',
];

function sanitizeRoles(roles: readonly unknown[]): UserRole[] {
  return [...new Set(roles.filter(
    (role): role is UserRole =>
      typeof role === 'string' && APP_ROLES.includes(role as UserRole)
  ))];
}

function normalizeProjectRoleKey(value: string) {
  const normalized = value.trim().toUpperCase();
  const projectMatch = normalized.match(
    /(?:^|[^A-Z0-9])J[-_\s]*0*(\d+)(?:[-_\s]*([A-Z][A-Z0-9]*))?(?=$|[^A-Z0-9])/
  );

  if (!projectMatch) {
    return normalized;
  }

  const projectNumber = String(Number(projectMatch[1]));
  const projectSuffix = projectMatch[2] ?? '';
  return `J${projectNumber}${projectSuffix}`;
}

function getRolesForProject(
  projectRoles: Record<string, UserRole[]>,
  activeProjectNo: string,
) {
  // Prefer the exact Firestore key so similarly named projects never share roles.
  if (Object.prototype.hasOwnProperty.call(projectRoles, activeProjectNo)) {
    return sanitizeRoles(projectRoles[activeProjectNo] || []);
  }

  // Support legacy records that stored the same project using a different format.
  const normalizedActiveProjectNo = normalizeProjectRoleKey(activeProjectNo);
  const matchingEntry = Object.entries(projectRoles).find(
    ([projectNo]) => normalizeProjectRoleKey(projectNo) === normalizedActiveProjectNo
  );

  return matchingEntry ? sanitizeRoles(matchingEntry[1]) : [];
}

export function RoleProvider({ children }: PropsWithChildren) {
  const { userProfile } = useAuth();
  const { activeProjectNo } = useInventory();

  // All roles assigned for the active project are effective at the same time.
  const roles = useMemo<UserRole[]>(() => {
    if (!userProfile) {
      return ['Staff'];
    }

    const globalRoles = sanitizeRoles(userProfile.role);

    // MasterAdmin is a global role and is not restricted by project assignments.
    if (globalRoles.includes('MasterAdmin')) {
      return globalRoles;
    }

    if (activeProjectNo) {
      const projectRoles = userProfile.projectRoles
        ? getRolesForProject(userProfile.projectRoles, activeProjectNo)
        : [];
      return projectRoles.length > 0 ? projectRoles : ['Staff'];
    }

    return globalRoles.length > 0 ? globalRoles : ['Staff'];
  }, [userProfile, activeProjectNo]);

  const value = useMemo<RoleContextValue>(() => {
    const roleSet = new Set(roles);
    const hasRole = (role: UserRole) => roleSet.has(role);
    const hasAnyRole = (allowedRoles: readonly UserRole[]) =>
      allowedRoles.some((role) => roleSet.has(role));

    const canDispatch = hasAnyRole(['MasterAdmin', 'Store Center', 'Store Site']);
    const canCancelDispatch = hasAnyRole(['MasterAdmin', 'Store Center']);
    const canApproveReceipt = true;
    const canReceiveStock = hasAnyRole(['MasterAdmin', 'Store Center']);
    const isReadOnly = !hasAnyRole([
      'MasterAdmin',
      'Store Center',
      'Admin Site',
      'Store Site',
    ]);

    return {
      roles,
      roleLabel: roles.join(' + '),
      hasRole,
      hasAnyRole,
      canDispatch,
      canCancelDispatch,
      canApproveReceipt,
      canReceiveStock,
      isReadOnly,
    };
  }, [roles]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error('useRole must be used within RoleProvider');
  }
  return context;
}
