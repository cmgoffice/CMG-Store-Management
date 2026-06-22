import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { UserRole } from '../types/models';
import { useAuth } from './AuthContext';
import { useInventory } from './InventoryContext';

interface RoleContextValue {
  activeRole: UserRole;
  roles: UserRole[];
  setActiveRole: (role: UserRole) => void;
  canDispatch: boolean;
  canApproveReceipt: boolean;
  canReceiveStock: boolean;
  isReadOnly: boolean;
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

const SYSTEM_ROLES: UserRole[] = [
  'Store Center',
  'Admin Site',
  'Store Site',
  'Keeper',
];

export function RoleProvider({ children }: PropsWithChildren) {
  const { userProfile } = useAuth();
  const { activeProjectNo } = useInventory();
  const [activeRole, setActiveRole] = useState<UserRole>('Store Center');

  // Determine which roles are switchable based on the ACTIVE project
  const roles = useMemo<UserRole[]>(() => {
    if (!userProfile) {
      return SYSTEM_ROLES;
    }
    
    // MasterAdmin, SuperAdmin, Admin get access to switch to any role globally
    if (
      userProfile.role.includes('MasterAdmin') ||
      userProfile.role.includes('SuperAdmin') ||
      userProfile.role.includes('Admin')
    ) {
      return [
        'MasterAdmin',
        'SuperAdmin',
        'Admin',
        'Store Center',
        'Admin Site',
        'Store Site',
        'Keeper',
        'Staff',
      ];
    }

    // Get roles specific to the active project
    if (activeProjectNo && userProfile.projectRoles) {
      const rolesForProj = userProfile.projectRoles[activeProjectNo] || [];
      return rolesForProj.length > 0 ? rolesForProj : ['Staff'];
    }

    // Fallback to global roles if no project-specific roles are defined
    return userProfile.role.length > 0 ? userProfile.role : ['Staff'];
  }, [userProfile, activeProjectNo]);

  // Adjust active role to match user's actual capabilities on the active project
  useMemo(() => {
    if (roles.length > 0 && !roles.includes(activeRole)) {
      setActiveRole(roles[0]);
    }
  }, [roles, activeRole]);

  const value = useMemo<RoleContextValue>(
    () => {
      const isAdmin =
        activeRole === 'MasterAdmin' ||
        activeRole === 'SuperAdmin' ||
        activeRole === 'Admin';

      const canDispatch = isAdmin || activeRole === 'Store Center';
      
      const canApproveReceipt =
        isAdmin ||
        activeRole === 'Admin Site' ||
        activeRole === 'Store Site';
        
      const canReceiveStock = isAdmin || activeRole === 'Store Center';
      
      const isReadOnly =
        activeRole === 'Keeper' ||
        activeRole === 'Staff';

      return {
        activeRole,
        roles,
        setActiveRole,
        canDispatch,
        canApproveReceipt,
        canReceiveStock,
        isReadOnly,
      };
    },
    [activeRole, roles],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error('useRole must be used within RoleProvider');
  }
  return context;
}
