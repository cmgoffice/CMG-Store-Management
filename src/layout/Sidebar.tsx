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
  History,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import type { PendingTask } from '../hooks/usePendingTasks';
import styles from './Sidebar.module.css';

type ActionMenuKey = 'receiving' | 'dispatch' | 'withdraw' | 'projectBorrow' | 'cancellation';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  pendingTasks: PendingTask[];
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
      { to: '/store/project-borrow', label: 'ยืม-คืนระหว่างโครงการ', icon: ArrowLeftRight, actionKey: 'projectBorrow' as const },
      { to: '/store/dispatch', label: 'จัดส่งสินค้า', icon: SendToBack, actionKey: 'dispatch' as const },
      { to: '/cancellations', label: 'ยกเลิกรายการ', icon: ClipboardX, actionKey: 'cancellation' as const },
    ],
  },
];

const settingsItems = [
  { to: '/admin', label: 'จัดการผู้ใช้', icon: ShieldCheck },
  { to: '/activity-logs', label: 'ประวัติกิจกรรม', icon: History },
];

function getMiniProjectLabel(projectNo: string) {
  const trimmed = projectNo.trim();
  return trimmed.length <= 3 ? trimmed : trimmed.slice(-3);
}

function formatBadgeCount(count: number) {
  return count > 99 ? '99+' : String(count);
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

export function Sidebar({ isOpen, onClose, isCollapsed, onToggleCollapse, pendingTasks }: SidebarProps) {
  const {
    projects,
    activeProjects,
    activeProjectNo,
    setActiveProjectNo,
  } = useInventory();
  const { userProfile, logout } = useAuth();
  const { roleLabel, hasRole, hasAnyRole } = useRole();
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
            return hasAnyRole(['MasterAdmin', 'Store Center']);
          }
          if (item.to === '/store/dispatch') {
            return canAccessDispatch;
          }
          return true;
        });
        return { ...group, items: filteredItems };
      })
      .filter((group) => group.items.length > 0);
  }, [canAccessDispatch, canManageProjects, hasAnyRole]);
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

    const increment = (projectNo?: string) => {
      const normalizedProjectNo = normalizeProjectNoText(projectNo);
      if (!normalizedProjectNo) {
        return;
      }

      counts.set(normalizedProjectNo, (counts.get(normalizedProjectNo) ?? 0) + 1);
    };

    pendingTasks.forEach((task) => increment(task.projectNo));

    return Object.fromEntries(counts);
  }, [pendingTasks]);

  const actionBadges = useMemo<Record<ActionMenuKey, { count: number; title: string }>>(() => {
    const isForActiveProject = (projectCode: string) =>
      !normalizedActiveProjectNo || projectCode === normalizedActiveProjectNo;

    const getCount = (type: PendingTask['type']) => pendingTasks.filter((task) =>
      task.type === type && (!task.projectNo || isForActiveProject(normalizeProjectNoText(task.projectNo)))
    ).length;
    const receivingCount = getCount('receiving');
    const dispatchCount = getCount('dispatch');
    const withdrawCount = getCount('withdraw');
    const projectBorrowCount = getCount('projectBorrow');
    const cancellationCount = getCount('cancellation');

    return {
      receiving: {
        count: receivingCount,
        title: `รับสินค้า รอ Action ${receivingCount} รายการ`,
      },
      withdraw: {
        count: withdrawCount,
        title: `เบิกสินค้า รอคืน ${withdrawCount} รายการ`,
      },
      projectBorrow: {
        count: projectBorrowCount,
        title: `ยืม-คืนระหว่างโครงการ รอ Action ${projectBorrowCount} รายการ`,
      },
      dispatch: {
        count: dispatchCount,
        title: `จัดส่งสินค้า รอ Action ${dispatchCount} รายการ`,
      },
      cancellation: {
        count: cancellationCount,
        title: `คำขอยกเลิกรออนุมัติ ${cancellationCount} รายการ`,
      },
    };
  }, [normalizedActiveProjectNo, pendingTasks]);

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

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    โครงการ: false,
    ภาพรวม: false,
    สินค้าคงคลัง: true,
    คลังสินค้า: true,
    ตั้งค่า: false,
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

  useEffect(() => {
    if (settingsItems.some((item) => location.pathname.startsWith(item.to))) {
      setOpenGroups((prev) => ({
        ...prev,
        ตั้งค่า: true,
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
            {isMasterAdmin && (() => {
              const isSettingsExpanded = !!openGroups['ตั้งค่า'];
              const isSettingsActive = settingsItems.some((item) => location.pathname.startsWith(item.to));

              return (
                <section className={styles.bottomGroup}>
                  <button
                    type="button"
                    className={`${styles.groupHeader} ${isSettingsActive ? styles.groupHeaderActive : ''}`}
                    onClick={() => toggleGroup('ตั้งค่า')}
                    aria-expanded={isSettingsExpanded}
                  >
                    <Settings size={18} className={styles.groupIcon} />
                    <span className={styles.groupTitle}>ตั้งค่า</span>
                    <ChevronDown
                      size={14}
                      className={`${styles.chevron} ${isSettingsExpanded ? styles.chevronExpanded : ''}`}
                    />
                  </button>
                  <div className={`${styles.itemsContainer} ${isSettingsExpanded ? styles.itemsExpanded : ''}`}>
                    <div className={styles.itemsInner}>
                      {settingsItems.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
                          onClick={onClose}
                        >
                          <item.icon size={16} />
                          <span className={styles.linkText}>{item.label}</span>
                          {item.to === '/admin' && pendingTasks.filter((task) => task.type === 'admin').length > 0 ? (
                            <span className={styles.menuBadge}>
                              {formatBadgeCount(pendingTasks.filter((task) => task.type === 'admin').length)}
                            </span>
                          ) : null}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </section>
              );
            })()}
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
