import {
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  PackageMinus,
  SendToBack,
  Settings,
  Store,
  X,
  ShieldCheck,
  ArrowLeftRight,
  ClipboardX,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import styles from './Sidebar.module.css';

type ActionMenuKey = 'receiving' | 'dispatch' | 'withdraw' | 'cancellation';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const groups = [
  {
    label: 'โครงการ',
    icon: FolderKanban,
    items: [{ to: '/projects', label: 'รายการโครงการ', icon: FolderKanban }],
  },
  {
    label: 'ภาพรวม',
    icon: LayoutDashboard,
    items: [
      { to: '/', label: 'แดชบอร์ด', icon: BarChart3 },
    ],
  },
  {
    label: 'สินค้าคงคลัง',
    icon: PackageCheck,
    items: [{ to: '/store/stock', label: 'สินค้าคงคลัง', icon: PackageCheck }],
  },
  {
    label: 'คลังสินค้า',
    icon: Boxes,
    items: [
      { to: '/receiving', label: 'รับสินค้า', icon: ClipboardCheck, actionKey: 'receiving' as const },
      { to: '/store/store', label: 'คลังโครงการ', icon: Store },
      { to: '/store/withdraw', label: 'เบิกสินค้า', icon: PackageMinus, actionKey: 'withdraw' as const },
      { to: '/store/project-borrow', label: 'ยืม-คืนระหว่างโครงการ', icon: ArrowLeftRight },
      { to: '/store/dispatch', label: 'จัดส่งสินค้า', icon: SendToBack, actionKey: 'dispatch' as const },
      { to: '/cancellations', label: 'ยกเลิกรายการ', icon: ClipboardX, actionKey: 'cancellation' as const },
    ],
  },
];

function getMiniProjectLabel(projectNo: string) {
  const trimmed = projectNo.trim();
  return trimmed.length <= 3 ? trimmed : trimmed.slice(-3);
}

function formatBadgeCount(count: number) {
  return count > 99 ? '99+' : String(count);
}

function isWithdrawOverdue(dueDate?: string) {
  if (!dueDate) {
    return false;
  }

  const parsedDueDate = new Date(dueDate.includes('T') ? dueDate : `${dueDate}T23:59:59`);
  return Number.isFinite(parsedDueDate.getTime()) && parsedDueDate.getTime() < Date.now();
}

function normalizeProjectNoText(value?: string) {
  const text = value?.trim() ?? '';
  if (!text) {
    return '';
  }

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

function isPriorityProject(projectNo: string) {
  return normalizeProjectNoText(projectNo) === 'J2B';
}

export function Sidebar({ isOpen, onClose, isCollapsed, onToggleCollapse }: SidebarProps) {
  const {
    projects,
    activeProjects,
    activeProjectNo,
    setActiveProjectNo,
    stockItems,
    receivingRequests,
    withdrawRecords,
    cancellationRequests,
  } = useInventory();
  const { userProfile, logout } = useAuth();
  const { roleLabel, hasRole, hasAnyRole, canDispatch } = useRole();
  const navigate = useNavigate();
  const canManageProjects = hasRole('MasterAdmin');
  const canAccessDispatch = hasAnyRole([
    'MasterAdmin',
    'Store Center',
    'Admin Site',
    'Store Site',
    'Staff',
  ]);
  const isMasterAdmin = hasRole('MasterAdmin');

  // A menu is available when any assigned role grants access to it.
  const filteredGroups = useMemo(() => {
    return groups
      .map((group) => {
        const filteredItems = group.items.filter((item) => {
          if (item.to === '/projects') {
            return canManageProjects;
          }
          if (item.to === '/store/stock') {
            return canDispatch;
          }
          if (item.to === '/store/dispatch') {
            return canAccessDispatch;
          }
          return true;
        });
        return { ...group, items: filteredItems };
      })
      .filter((group) => group.items.length > 0);
  }, [canAccessDispatch, canDispatch, canManageProjects]);
  const location = useLocation();
  const miniProjects = useMemo(
    () => activeProjects.map((project, index) => ({ project, index })),
    [activeProjects]
  );
  const priorityMiniProjects = useMemo(
    () => miniProjects.filter(({ project }) => isPriorityProject(project.projectNo)),
    [miniProjects]
  );
  const regularMiniProjects = useMemo(
    () => miniProjects.filter(({ project }) => !isPriorityProject(project.projectNo)),
    [miniProjects]
  );
  const activeProject = activeProjects.find((project) => project.projectNo === activeProjectNo)
    ?? projects.find((project) => project.projectNo === activeProjectNo);
  const normalizedActiveProjectNo = normalizeProjectNoText(activeProjectNo);
  const projectActionBadges = useMemo<Record<string, number>>(() => {
    const counts = new Map<string, number>();

    const increment = (projectNo: string) => {
      const normalizedProjectNo = normalizeProjectNoText(projectNo);
      if (!normalizedProjectNo) {
        return;
      }

      counts.set(normalizedProjectNo, (counts.get(normalizedProjectNo) ?? 0) + 1);
    };

    receivingRequests.forEach((request) => {
      const projectCode = normalizeProjectNoText(
        request.cmgProjectCode ||
          request.projectItemCode ||
          request.projectNo ||
          request.projectId ||
          request.projectName ||
          request.location
      );

      if (request.requestStatus === 'pending') {
        increment(projectCode);
      }
    });

    stockItems.forEach((item) => {
      const projectCode = normalizeProjectNoText(
        item.cmgProjectCode ||
          item.projectId ||
          item.purchasedForProject ||
          item.location
      );

      if (item.status === 'In Transit') {
        increment(projectCode);
      }

      if (
        canDispatch &&
        item.status === 'Pending Dispatch'
      ) {
        increment(projectCode);
      }
    });

    withdrawRecords.forEach((record) => {
      if (record.type === 'borrow' && record.status !== 'Returned') {
        increment(record.projectNo);
      }
    });

    return Object.fromEntries(counts);
  }, [canDispatch, receivingRequests, stockItems, withdrawRecords]);

  const actionBadges = useMemo<Record<ActionMenuKey, { count: number; title: string }>>(() => {
    const isForActiveProject = (projectCode: string) =>
      !normalizedActiveProjectNo || projectCode === normalizedActiveProjectNo;

    const pendingReceivingCount = receivingRequests.filter((request) => {
      const projectCode = normalizeProjectNoText(
        request.cmgProjectCode ||
          request.projectItemCode ||
          request.projectNo ||
          request.projectId ||
          request.projectName ||
          request.location
      );
      return request.requestStatus === 'pending' && isForActiveProject(projectCode);
    }).length;

    const incomingItemsCount = stockItems.filter((item) => {
      const projectCode = normalizeProjectNoText(
        item.cmgProjectCode ||
          item.projectId ||
          item.purchasedForProject ||
          item.location
      );
      return item.status === 'In Transit' && isForActiveProject(projectCode);
    }).length;

    const dispatchableCount = canDispatch
      ? stockItems.filter(
        (item) =>
          item.status === 'Pending Dispatch' &&
          item.location === 'Store Center' &&
          item.purchasedForProject === `Project ${activeProjectNo}`
      ).length
      : 0;

    const waitingWithdrawReturnCount = withdrawRecords.filter((record) => {
      const projectCode = normalizeProjectNoText(record.projectNo);
      return record.type === 'borrow' && record.status !== 'Returned' && isForActiveProject(projectCode);
    }).length;

    const overdueWithdrawReturnCount = withdrawRecords.filter((record) => {
      const projectCode = normalizeProjectNoText(record.projectNo);
      return (
        record.type === 'borrow' &&
        record.status !== 'Returned' &&
        isForActiveProject(projectCode) &&
        isWithdrawOverdue(record.dueDate)
      );
    }).length;

    return {
      receiving: {
        count: pendingReceivingCount + incomingItemsCount,
        title: `Receiving รอ Action ${pendingReceivingCount + incomingItemsCount} รายการ: รับเข้าใหม่ ${pendingReceivingCount}, ย้ายโครงการ ${incomingItemsCount}`,
      },
      withdraw: {
        count: waitingWithdrawReturnCount,
        title: `Withdraw waiting return ${waitingWithdrawReturnCount} records, overdue ${overdueWithdrawReturnCount}`,
      },
      dispatch: {
        count: dispatchableCount,
        title: `Dispatch รอ Action ${dispatchableCount} รายการ`,
      },
      cancellation: {
        count: cancellationRequests.filter((request) => request.status === 'Pending Approval' && (
          !normalizedActiveProjectNo || request.projectNos.some((projectNo) => isForActiveProject(normalizeProjectNoText(projectNo)))
        )).length,
        title: `คำขอยกเลิกรออนุมัติ ${cancellationRequests.filter((request) => request.status === 'Pending Approval').length} รายการ`,
      },
    };
  }, [activeProjectNo, canDispatch, cancellationRequests, normalizedActiveProjectNo, receivingRequests, stockItems, withdrawRecords]);

  const [pendingCount, setPendingCount] = useState(0);

  const renderMiniProjectButton = (project: typeof activeProjects[number], index: number) => {
    const badgeCount = projectActionBadges[normalizeProjectNoText(project.projectNo)] ?? 0;

    return (
      <div key={project.projectNo} className={styles.projectDotWrap}>
        <button
          className={`${styles.projectDot} ${
            activeProjectNo === project.projectNo ? styles.projectActive : ''
          } ${
            activeProjectNo && activeProjectNo !== project.projectNo ? styles.projectInactive : ''
          } ${styles[`projectTone${(index % 4) + 1}`]}`}
          type="button"
          title={`${project.projectNo} - ${project.projectName}`}
          aria-label={`เปลี่ยนเป็น ${project.projectNo}${badgeCount > 0 ? ` (${badgeCount} รายการรอดำเนินการ)` : ''}`}
          aria-pressed={activeProjectNo === project.projectNo}
          onClick={(e) => {
            e.stopPropagation();
            setActiveProjectNo(project.projectNo);
          }}
        >
          {getMiniProjectLabel(project.projectNo)}
        </button>
        {badgeCount > 0 ? (
          <span className={styles.projectBadge} aria-label={`${project.projectNo} มี ${badgeCount} รายการรอดำเนินการ`}>
            {formatBadgeCount(badgeCount)}
          </span>
        ) : null}
      </div>
    );
  };

  useEffect(() => {
    if (!userProfile || !userProfile.role.includes('MasterAdmin')) {
      setPendingCount(0);
      return;
    }

    const usersCol = collection(db, 'CMG-Store-Management', 'root', 'users');
    const q = query(usersCol, where('status', '==', 'pending'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setPendingCount(snapshot.size);
    }, (error) => {
      console.error('Failed to listen to pending users count:', error);
    });

    return () => unsubscribe();
  }, [userProfile]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    Overview: true,
    Project: true,
    Inventory: true,
    Stock: true,
  });

  useEffect(() => {
    const activeGroup = groups.find((group) =>
      group.items.some((item) => {
        if (item.to === '/') {
          return location.pathname === '/';
        }
        return location.pathname.startsWith(item.to);
      })
    );
    if (activeGroup) {
      setOpenGroups((prev) => ({
        ...prev,
        [activeGroup.label]: true,
      }));
    }
  }, [location.pathname]);

  const toggleGroup = (groupLabel: string) => {
    setOpenGroups((prev) => ({
      ...prev,
      [groupLabel]: !prev[groupLabel],
    }));
  };

  return (
    <>
      <aside className={`${styles.sidebar} ${isOpen ? styles.open : ''} ${isCollapsed ? styles.collapsedSidebar : ''}`}>
        <div
          className={styles.miniRail}
          aria-label="ตัวเลือกเปลี่ยนโครงการด่วน"
          role="button"
          tabIndex={0}
          onClick={onToggleCollapse}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleCollapse();
            }
          }}
        >
          <div className={styles.verticalBrand}>CMG.</div>
          <div className={styles.projectStack}>
            {priorityMiniProjects.length > 0 ? (
              <div className={styles.projectSection}>
                {priorityMiniProjects.map(({ project, index }) => renderMiniProjectButton(project, index))}
              </div>
            ) : null}
            {priorityMiniProjects.length > 0 && regularMiniProjects.length > 0 ? (
              <div className={styles.projectDivider} aria-hidden="true" />
            ) : null}
            {regularMiniProjects.length > 0 ? (
              <div className={styles.projectSection}>
                {regularMiniProjects.map(({ project, index }) => renderMiniProjectButton(project, index))}
              </div>
            ) : null}
            {canManageProjects && (
              <NavLink
                className={styles.addProject}
                to="/projects"
                aria-label="เปิดรายการโครงการ"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
              >
                +
              </NavLink>
            )}
          </div>
          {isCollapsed && (
            <button
              className={styles.expandButton}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse();
              }}
              aria-label="ขยายเมนูนำทาง"
            >
              <ChevronRight size={18} />
            </button>
          )}
        </div>

        <div className={styles.menuPanel}>
          <div className={styles.brand}>
            <div className={styles.branchSelect}>
              <span>{activeProject?.projectNo ?? 'โครงการ'}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
            <button
              className={styles.collapse}
              type="button"
              onClick={onToggleCollapse}
              aria-label="ย่อเมนูนำทาง"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className={styles.close}
              type="button"
              aria-label="ปิดเมนูนำทาง"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
          {userProfile && (
            <div className={styles.profileCard}>
              <div className={styles.profileAvatarWrapper}>
                {userProfile.photoURL ? (
                  <img src={userProfile.photoURL} alt="" className={styles.profileAvatar} />
                ) : (
                  <div className={styles.profileAvatarFallback}>
                    {userProfile.firstName[0]}
                    {userProfile.lastName[0]}
                  </div>
                )}
              </div>
              <div className={styles.profileTextInfo}>
                <div className={styles.profileCardName}>
                  {userProfile.firstName} {userProfile.lastName}
                </div>
                <div className={styles.profileCardRole}>
                  {roleLabel}
                </div>
              </div>
            </div>
          )}

          <nav className={styles.nav} aria-label="เมนูหลัก">
            {filteredGroups.map((group) => {
              const isExpanded = !!openGroups[group.label];
              const groupPendingCount = group.items.reduce((sum, item) => {
                const actionKey = 'actionKey' in item ? item.actionKey as ActionMenuKey | undefined : undefined;
                return sum + (actionKey ? actionBadges[actionKey].count : 0);
              }, 0);
              return (
                <section key={group.label} className={styles.group}>
                  <button
                    type="button"
                    className={styles.groupHeader}
                    onClick={() => toggleGroup(group.label)}
                    aria-expanded={isExpanded}
                  >
                    {group.icon ? <group.icon size={16} className={styles.groupIcon} /> : null}
                    <span className={styles.groupTitle}>{group.label}</span>
                    {groupPendingCount > 0 ? (
                      <span className={styles.groupBadge} title={`มีงานรอ Action ${groupPendingCount} รายการ`}>
                        {formatBadgeCount(groupPendingCount)}
                      </span>
                    ) : null}
                    <ChevronDown
                      size={14}
                      className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ''}`}
                    />
                  </button>
                  <div className={`${styles.itemsContainer} ${isExpanded ? styles.itemsExpanded : ''}`}>
                    <div className={styles.itemsInner}>
                      {group.items.map((item) => {
                        const actionKey = 'actionKey' in item ? item.actionKey as ActionMenuKey | undefined : undefined;
                        const badge = actionKey ? actionBadges[actionKey] : undefined;

                        return (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.to === '/'}
                            className={({ isActive }) =>
                              `${styles.link} ${isActive ? styles.active : ''}`
                            }
                            onClick={onClose}
                            title={badge && badge.count > 0 ? badge.title : undefined}
                          >
                            <item.icon size={16} />
                            <span className={styles.linkText}>{item.label}</span>
                            {badge && badge.count > 0 ? (
                              <span className={styles.menuBadge} aria-label={badge.title}>
                                {formatBadgeCount(badge.count)}
                              </span>
                            ) : null}
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                </section>
              );
            })}
          </nav>

          <div className={styles.bottomNav}>
            {isMasterAdmin && (
              <NavLink
                className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
                to="/admin"
                onClick={onClose}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '16px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <ShieldCheck size={20} />
                  <span>จัดการผู้ใช้</span>
                </div>
                {pendingCount > 0 && (
                  <span className={styles.pendingBadge}>
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            )}
            {canManageProjects && (
              <NavLink className={styles.link} to="/projects" onClick={onClose}>
                <Settings size={20} />
                <span>ตั้งค่า</span>
              </NavLink>
            )}
            <button
              className={styles.logout}
              type="button"
              onClick={async () => {
                try {
                  await logout();
                  navigate('/login');
                } catch (err) {
                  console.error('Logout failed:', err);
                }
              }}
            >
              <LogOut size={20} />
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
      </aside>
      {isOpen ? (
        <button
          className={styles.overlay}
          type="button"
          aria-label="ปิดเมนูนำทาง"
          onClick={onClose}
        />
      ) : null}
    </>
  );
}
