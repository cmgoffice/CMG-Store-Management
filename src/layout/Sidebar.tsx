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
  SendToBack,
  Settings,
  Store,
  X,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import styles from './Sidebar.module.css';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const groups = [
  {
    label: 'Project',
    icon: FolderKanban,
    items: [{ to: '/projects', label: 'Projects', icon: FolderKanban }],
  },
  {
    label: 'Overview',
    icon: LayoutDashboard,
    items: [
      { to: '/', label: 'Dashboard', icon: BarChart3 },
      { to: '/receiving', label: 'Receiving', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Stock',
    icon: Boxes,
    items: [
      { to: '/store/stock', label: 'Inventory', icon: PackageCheck },
      { to: '/store/store', label: 'Store', icon: Store },
      { to: '/store/dispatch', label: 'Dispatch', icon: SendToBack },
    ],
  },
];

export function Sidebar({ isOpen, onClose, isCollapsed, onToggleCollapse }: SidebarProps) {
  const { projects, activeProjectNo, setActiveProjectNo } = useInventory();
  const { userProfile, logout } = useAuth();
  const { activeRole } = useRole();
  const navigate = useNavigate();

  // Filter sidebar groups based on activeRole
  const filteredGroups = useMemo(() => {
    return groups
      .map((group) => {
        const filteredItems = group.items.filter((item) => {
          if (item.to === '/projects') {
            return !['Store Center', 'Store Site', 'Keeper'].includes(activeRole);
          }
          if (item.to === '/store/stock') {
            return !['Store Site', 'Keeper'].includes(activeRole);
          }
          if (item.to === '/store/dispatch') {
            return activeRole !== 'Keeper';
          }
          return true;
        });
        return { ...group, items: filteredItems };
      })
      .filter((group) => group.items.length > 0);
  }, [activeRole]);
  const location = useLocation();
  const miniProjects = useMemo(() => projects.slice(0, 4), [projects]);
  const activeProject = projects.find((project) => project.projectNo === activeProjectNo);

  const [pendingCount, setPendingCount] = useState(0);

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
          aria-label="Project quick switcher"
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
            {miniProjects.map((project, index) => (
              <button
                key={project.projectNo}
                className={`${styles.projectDot} ${
                  activeProjectNo === project.projectNo ? styles.projectActive : ''
                } ${styles[`projectTone${index + 1}`]}`}
                type="button"
                title={`${project.projectNo} - ${project.projectName}`}
                aria-label={`Switch to ${project.projectNo}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveProjectNo(project.projectNo);
                }}
              >
                {project.projectNo.replace('J', '')}
              </button>
            ))}
            {!['Store Center', 'Store Site', 'Keeper'].includes(activeRole) && (
              <NavLink
                className={styles.addProject}
                to="/projects"
                aria-label="Open project list"
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
              aria-label="Expand navigation"
            >
              <ChevronRight size={18} />
            </button>
          )}
        </div>

        <div className={styles.menuPanel}>
          <div className={styles.brand}>
            <div className={styles.branchSelect}>
              <span>{activeProject?.projectNo ?? 'Project'}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
            <button
              className={styles.collapse}
              type="button"
              onClick={onToggleCollapse}
              aria-label="Collapse navigation"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className={styles.close}
              type="button"
              aria-label="Close navigation"
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
                  {activeRole}
                </div>
              </div>
            </div>
          )}

          <nav className={styles.nav} aria-label="Main navigation">
            {filteredGroups.map((group) => {
              const isExpanded = !!openGroups[group.label];
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
                    <ChevronDown
                      size={14}
                      className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ''}`}
                    />
                  </button>
                  <div className={`${styles.itemsContainer} ${isExpanded ? styles.itemsExpanded : ''}`}>
                    <div className={styles.itemsInner}>
                      {group.items.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === '/'}
                          className={({ isActive }) =>
                            `${styles.link} ${isActive ? styles.active : ''}`
                          }
                          onClick={onClose}
                        >
                          <item.icon size={16} />
                          <span>{item.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </section>
              );
            })}
          </nav>

          <div className={styles.bottomNav}>
            {(activeRole === 'MasterAdmin' || activeRole === 'Admin') && (
              <NavLink
                className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
                to="/admin"
                onClick={onClose}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '16px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <ShieldCheck size={20} />
                  <span>User Mgmt</span>
                </div>
                {pendingCount > 0 && (
                  <span className={styles.pendingBadge}>
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            )}
            {!['Store Center', 'Store Site', 'Keeper'].includes(activeRole) && (
              <NavLink className={styles.link} to="/projects" onClick={onClose}>
                <Settings size={20} />
                <span>Settings</span>
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
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>
      {isOpen ? (
        <button
          className={styles.overlay}
          type="button"
          aria-label="Close navigation overlay"
          onClick={onClose}
        />
      ) : null}
    </>
  );
}
