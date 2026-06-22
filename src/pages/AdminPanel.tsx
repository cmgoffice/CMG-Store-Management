import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useInventory } from '../context/InventoryContext';
import { UserProfile, UserRole } from '../types/models';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { UserCheck, UserX, User, ChevronDown, Check, X, FolderKanban } from 'lucide-react';
import '../styles/tables.css';

const APP_NAME = 'CMG-Store-Management';

const AVAILABLE_ROLES: UserRole[] = [
  'MasterAdmin',
  'SuperAdmin',
  'Admin',
  'Store Center',
  'Admin Site',
  'Store Site',
  'Keeper',
  'Staff',
];

type DropdownPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function AdminPanel() {
  const { projects: allProjects } = useInventory();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  // Editing state (stored locally, decoupled from Firestore updates while open)
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editRoles, setEditRoles] = useState<UserRole[]>([]);
  const [editProjects, setEditProjects] = useState<string[]>([]);
  const [editProjectRoles, setEditProjectRoles] = useState<Record<string, UserRole[]>>({});
  const [editStatus, setEditStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);
  const [openProjectRoleDropdown, setOpenProjectRoleDropdown] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalRoleDropdownPosition, setGlobalRoleDropdownPosition] = useState<DropdownPosition | null>(null);
  const [projectRoleDropdownPosition, setProjectRoleDropdownPosition] = useState<DropdownPosition | null>(null);
  const globalRoleTriggerRef = useRef<HTMLButtonElement | null>(null);
  const projectRoleTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const getDropdownPosition = (trigger: HTMLElement, preferredHeight: number): DropdownPosition => {
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 16;
    const gap = 8;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const shouldOpenUpward = availableBelow < preferredHeight && availableAbove > availableBelow;
    const availableSpace = shouldOpenUpward ? availableAbove : availableBelow;
    const maxHeight = Math.max(96, Math.min(preferredHeight, availableSpace - gap));

    return {
      top: shouldOpenUpward ? Math.max(viewportPadding, rect.top - maxHeight - gap) : rect.bottom + gap,
      left: rect.left,
      width: rect.width,
      maxHeight,
    };
  };

  // Load all users in real-time
  useEffect(() => {
    const usersCol = collection(db, APP_NAME, 'root', 'users');
    const unsubscribe = onSnapshot(
      usersCol,
      (snapshot) => {
        const loadedUsers = snapshot.docs.map((docSnap) => docSnap.data() as UserProfile);
        // Sort users by first name
        loadedUsers.sort((a, b) => a.firstName.localeCompare(b.firstName));
        setUsers(loadedUsers);
        setLoading(false);
      },
      (error) => {
        console.error('Failed to listen to users:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Filter users based on query
  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return users;

    return users.filter((user) =>
      [user.firstName, user.lastName, user.email, user.position, ...user.role]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    );
  }, [users, query]);

  useLayoutEffect(() => {
    if (!isRoleDropdownOpen || !globalRoleTriggerRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!globalRoleTriggerRef.current) return;
      setGlobalRoleDropdownPosition(getDropdownPosition(globalRoleTriggerRef.current, 180));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isRoleDropdownOpen]);

  useLayoutEffect(() => {
    if (!openProjectRoleDropdown) {
      return;
    }

    const trigger = projectRoleTriggerRefs.current[openProjectRoleDropdown];
    if (!trigger) {
      return;
    }

    const updatePosition = () => {
      const currentTrigger = projectRoleTriggerRefs.current[openProjectRoleDropdown];
      if (!currentTrigger) return;
      setProjectRoleDropdownPosition(getDropdownPosition(currentTrigger, 140));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [openProjectRoleDropdown]);

  // Open edit modal for a user
  const startEdit = (user: UserProfile) => {
    setEditingUser(user);
    setEditRoles([...user.role]);
    setEditProjects([...(user.assignedProjects || [])]);
    setEditProjectRoles(user.projectRoles ? { ...user.projectRoles } : {});
    setEditStatus(user.status);
    setIsRoleDropdownOpen(false);
    setOpenProjectRoleDropdown(null);
  };

  // Close modal
  const cancelEdit = () => {
    setEditingUser(null);
    setIsRoleDropdownOpen(false);
    setOpenProjectRoleDropdown(null);
    setGlobalRoleDropdownPosition(null);
    setProjectRoleDropdownPosition(null);
  };

  // Toggle a role in the local edit roles list
  const toggleEditRole = (role: UserRole) => {
    setEditRoles((current) =>
      current.includes(role)
        ? current.filter((r) => r !== role)
        : [...current, role]
    );
  };

  // Toggle a project-specific role
  const toggleProjectRole = (projectNo: string, role: UserRole) => {
    setEditProjectRoles((current) => {
      const currentRoles = current[projectNo] || [];
      const updatedRoles = currentRoles.includes(role)
        ? currentRoles.filter((r) => r !== role)
        : [...currentRoles, role];
      return {
        ...current,
        [projectNo]: updatedRoles,
      };
    });
  };

  // Toggle a project in the local edit projects list
  const toggleEditProject = (projectNo: string) => {
    setEditProjects((current) => {
      const isAssigned = current.includes(projectNo);
      if (isAssigned) {
        // Remove project and clear its specific roles
        setEditProjectRoles((prev) => {
          const updated = { ...prev };
          delete updated[projectNo];
          return updated;
        });
        return current.filter((id) => id !== projectNo);
      } else {
        // Add project with default 'Staff' role
        setEditProjectRoles((prev) => ({
          ...prev,
          [projectNo]: ['Staff'],
        }));
        return [...current, projectNo];
      }
    });
  };

  // Save edits to Firestore
  const saveUserEdits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setIsSubmitting(true);

    try {
      const userDocRef = doc(db, APP_NAME, 'root', 'users', editingUser.email.toLowerCase());
      
      const updatedData = {
        role: editRoles,
        status: editStatus,
        assignedProjects: editProjects,
        projectRoles: editProjectRoles,
        firstName: editingUser.firstName,
        lastName: editingUser.lastName,
        position: editingUser.position,
      };

      await updateDoc(userDocRef, updatedData);
      setEditingUser(null);
    } catch (error) {
      console.error('Failed to save user updates:', error);
      alert('Failed to save changes. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick Approval Shortcut
  const handleQuickApprove = async (email: string) => {
    try {
      const userDocRef = doc(db, APP_NAME, 'root', 'users', email.toLowerCase());
      await updateDoc(userDocRef, {
        status: 'approved',
      });
    } catch (error) {
      console.error('Failed to approve user:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-[#4f2ed9]">
        <div className="w-8 h-8 border-4 border-purple-100 border-t-purple-600 rounded-full animate-spin mb-4" />
        <span className="font-semibold text-xs tracking-wider uppercase">Loading directory...</span>
      </div>
    );
  }

  return (
    <div className="p-1 font-sans">
      <PageHeader
        eyebrow="System Security"
        title="User Control Panel"
        description="Approve registration requests, manage project clearance, and assign user permissions in real-time."
        actions={
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search users by name, role, email..."
          />
        }
      />

      <div className="tableScroll">
        <table className="table compact">
          <colgroup>
            <col className="w-[72px]" />
            <col className="w-[280px]" />
            <col className="w-[120px]" />
            <col className="w-[140px]" />
            <col className="w-[170px]" />
            <col className="w-[360px]" />
            <col className="w-[130px]" />
          </colgroup>
          <thead>
            <tr>
              <th>Profile</th>
              <th>Name & Email</th>
              <th>Position</th>
              <th>Status</th>
              <th>Global Roles</th>
              <th>Project Clearance & Roles</th>
              <th className="numeric">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => (
              <tr key={user.email} className="align-top">
                <td className="w-12">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={`${user.firstName} avatar`}
                      className="w-10 h-10 rounded-full object-cover border border-slate-200"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-sm">
                      {user.firstName[0]}
                      {user.lastName[0]}
                    </div>
                  )}
                </td>
                <td>
                  <div className="font-semibold text-slate-800 text-sm leading-5">
                    {user.firstName} {user.lastName} {user.isFirstUser && <span className="text-[10px] font-black text-purple-600 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded ml-1">MASTER</span>}
                  </div>
                  <div className="text-xs text-slate-500 break-all leading-4">{user.email}</div>
                </td>
                <td className="text-sm font-medium text-slate-600 leading-5">{user.position}</td>
                <td>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${
                      user.status === 'approved'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : user.status === 'rejected'
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-amber-50 border-amber-200 text-amber-700'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        user.status === 'approved'
                          ? 'bg-emerald-500'
                          : user.status === 'rejected'
                          ? 'bg-rose-500'
                          : 'bg-amber-500 animate-pulse'
                      }`}
                    />
                    <span className="uppercase tracking-wider text-[10px]">
                      {user.status}
                    </span>
                  </span>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {user.role.map((r) => (
                      <span
                        key={r}
                        className="text-[10px] font-bold px-2 py-0.5 bg-[#f0ecfc] text-[#4f2ed9] rounded border border-purple-100"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="flex min-h-[40px] w-full items-center">
                    {user.role.includes('MasterAdmin') ? (
                      <div className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1">
                        <span className="whitespace-nowrap text-[10px] font-bold italic leading-4 text-slate-500">
                          All Projects & MasterAdmin permissions
                        </span>
                      </div>
                    ) : user.assignedProjects && user.assignedProjects.length > 0 ? (
                      <div className="flex flex-nowrap items-center gap-1 overflow-hidden whitespace-nowrap">
                        {user.assignedProjects.map((pNo) => {
                          const projRoles = user.projectRoles?.[pNo] || ['Staff'];
                          return (
                            <div
                              key={pNo}
                              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200/80 bg-white px-2.5 py-1 text-[10px] font-semibold"
                              title={`Project ${pNo}: ${projRoles.join(', ')}`}
                            >
                              <span className="font-bold whitespace-nowrap text-slate-700">
                                {pNo}
                              </span>
                              <span className="whitespace-nowrap text-slate-500">
                                {projRoles.join(', ')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1">
                        <span className="whitespace-nowrap text-[10px] font-bold leading-4 text-amber-600">
                          No Projects Assigned
                        </span>
                      </div>
                    )}
                  </div>
                </td>
                <td className="numeric">
                  <div className="flex justify-end gap-1.5">
                    {user.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => handleQuickApprove(user.email)}
                        className="h-8 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-1"
                        title="Approve immediately"
                      >
                        <UserCheck size={14} />
                        <span>Approve</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(user)}
                      className="h-8 px-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-bold shadow-sm transition-all"
                    >
                      Manage
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-slate-400 font-semibold text-sm">
                  No users found matching query.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Editing Modal (Z-INDEX 10000) */}
      {editingUser && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <form
            onSubmit={saveUserEdits}
            className="w-full max-w-[560px] bg-white rounded-3xl shadow-2xl overflow-visible border border-slate-100 flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-black text-slate-800">Assign Rights & Roles</h3>
                <p className="text-xs text-slate-500 font-medium">{editingUser.email}</p>
              </div>
              <button
                type="button"
                onClick={cancelEdit}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              
              {/* User Bio Summary */}
              <div className="flex gap-4 p-4 bg-slate-50 border border-slate-200/50 rounded-2xl">
                {editingUser.photoURL ? (
                  <img
                    src={editingUser.photoURL}
                    alt=""
                    className="w-12 h-12 rounded-full object-cover border border-slate-200"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-lg">
                    {editingUser.firstName[0]}
                    {editingUser.lastName[0]}
                  </div>
                )}
                <div>
                  <div className="font-bold text-slate-800">
                    {editingUser.firstName} {editingUser.lastName}
                  </div>
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide">
                    Position: {editingUser.position}
                  </div>
                </div>
              </div>

              {/* Status Section */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  System Clearance Status
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['pending', 'approved', 'rejected'] as const).map((statusVal) => (
                    <button
                      key={statusVal}
                      type="button"
                      onClick={() => setEditStatus(statusVal)}
                      className={`h-10 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                        editStatus === statusVal
                          ? statusVal === 'approved'
                            ? 'bg-emerald-50 border-emerald-400 text-emerald-700 shadow-sm shadow-emerald-100'
                            : statusVal === 'rejected'
                            ? 'bg-rose-50 border-rose-400 text-rose-700 shadow-sm shadow-rose-100'
                            : 'bg-amber-50 border-amber-400 text-amber-700 shadow-sm shadow-amber-100'
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {statusVal === 'approved' && <UserCheck size={14} />}
                      {statusVal === 'rejected' && <UserX size={14} />}
                      {statusVal === 'pending' && <User size={14} />}
                      <span>{statusVal}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Global Roles Selection (z-10010) */}
              <div className="relative overflow-visible">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Global / System Roles (e.g. MasterAdmin, SuperAdmin)
                </label>
                
                {/* Trigger */}
                <button
                  ref={globalRoleTriggerRef}
                  type="button"
                  onClick={() => {
                    setIsRoleDropdownOpen(!isRoleDropdownOpen);
                    setOpenProjectRoleDropdown(null);
                    setProjectRoleDropdownPosition(null);
                  }}
                  className="w-full h-11 border border-slate-200 rounded-xl px-4 flex items-center justify-between bg-white hover:bg-slate-50 transition-all font-semibold text-sm text-slate-800"
                >
                  <div className="flex flex-wrap gap-1 items-center overflow-hidden max-w-[90%]">
                    {editRoles.length === 0 ? (
                      <span className="text-slate-400 text-xs">Select global roles...</span>
                    ) : (
                      editRoles.map((role) => (
                        <span
                          key={role}
                          className="text-[10px] font-bold px-2 py-0.5 bg-[#f0ecfc] text-[#4f2ed9] rounded border border-purple-100"
                        >
                          {role}
                        </span>
                      ))
                    )}
                  </div>
                  <ChevronDown size={16} className={`text-slate-400 transition-all ${isRoleDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown list with z-10010 */}
                {isRoleDropdownOpen && globalRoleDropdownPosition && createPortal(
                  <>
                    <div
                      className="fixed inset-0 z-[10005]"
                      onClick={() => setIsRoleDropdownOpen(false)}
                    />
                    <div
                      className="fixed border border-slate-200 rounded-xl bg-white shadow-xl overflow-y-auto p-1.5 z-[10010]"
                      style={{
                        top: globalRoleDropdownPosition.top,
                        left: globalRoleDropdownPosition.left,
                        width: globalRoleDropdownPosition.width,
                        maxHeight: globalRoleDropdownPosition.maxHeight,
                      }}
                    >
                      {AVAILABLE_ROLES.map((role) => {
                        const isChecked = editRoles.includes(role);
                        return (
                          <button
                            key={role}
                            type="button"
                            onClick={() => toggleEditRole(role)}
                            className="w-full h-9 rounded-lg px-3 flex items-center justify-between text-left text-xs font-semibold hover:bg-slate-50 transition-all text-slate-700"
                          >
                            <span>{role}</span>
                            {isChecked && <Check size={14} className="text-[#6e42f4] shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </>,
                  document.body
                )}
              </div>
              
              {/* Projects Assignment & Project-Specific Roles Section */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <FolderKanban size={14} />
                  <span>Assign Project Site Clearances & Roles</span>
                </label>
                {editRoles.includes('MasterAdmin') ? (
                  <div className="p-4 bg-slate-100 border border-slate-200/50 rounded-xl text-center text-xs font-bold text-slate-500 italic">
                    MasterAdmin bypassed: has access to all projects automatically.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[280px] overflow-y-auto p-2 bg-slate-50/50 border border-slate-200/50 rounded-xl">
                    {allProjects.map((project) => {
                      const isChecked = editProjects.includes(project.projectNo);
                      const isProjDropdownOpen = openProjectRoleDropdown === project.projectNo;

                      return (
                        <div
                          key={project.projectNo}
                          className={`p-3 rounded-xl border bg-white transition-all flex flex-col gap-2.5 ${
                            isChecked ? 'border-purple-300 shadow-sm' : 'border-slate-200 opacity-70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <button
                              type="button"
                              onClick={() => toggleEditProject(project.projectNo)}
                              className="flex items-center gap-3 text-left min-w-0"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                readOnly
                                className="rounded text-[#6e42f4] focus:ring-purple-200 shrink-0 pointer-events-none"
                                aria-label={`Assign Project ${project.projectNo}`}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-800">Project {project.projectNo}</div>
                                <div className="text-[10px] text-slate-500 truncate">{project.projectName}</div>
                              </div>
                            </button>
                            {isChecked && (
                              <span className="text-[10px] font-black text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded shrink-0">
                                Assigned
                              </span>
                            )}
                          </div>

                          {/* Project specific role dropdown (only if project is checked/assigned) */}
                          {isChecked && (
                            <div className="relative overflow-visible">
                              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                Roles on Project {project.projectNo}
                              </label>

                              {/* Trigger button */}
                              <button
                                ref={(element) => {
                                  projectRoleTriggerRefs.current[project.projectNo] = element;
                                }}
                                type="button"
                                onClick={() => {
                                  setOpenProjectRoleDropdown(isProjDropdownOpen ? null : project.projectNo);
                                  setIsRoleDropdownOpen(false);
                                  setGlobalRoleDropdownPosition(null);
                                }}
                                className="w-full h-8 border border-slate-200 rounded-lg px-3 flex items-center justify-between bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-all"
                              >
                                <span className="truncate max-w-[90%]">
                                  {((editProjectRoles[project.projectNo] || []).length === 0) ? (
                                    <span className="text-slate-400 text-xs">Assign roles for this project...</span>
                                  ) : (
                                    (editProjectRoles[project.projectNo] || []).join(', ')
                                  )}
                                </span>
                                <ChevronDown size={14} className="text-slate-400 shrink-0" />
                              </button>

                              {/* Dropdown list with z-10010 */}
                              {isProjDropdownOpen && projectRoleDropdownPosition && createPortal(
                                <>
                                  <div
                                    className="fixed inset-0 z-[10005]"
                                    onClick={() => setOpenProjectRoleDropdown(null)}
                                  />
                                  <div
                                    className="fixed border border-slate-200 rounded-xl bg-white shadow-xl overflow-y-auto p-1.5 z-[10010]"
                                    style={{
                                      top: projectRoleDropdownPosition.top,
                                      left: projectRoleDropdownPosition.left,
                                      width: projectRoleDropdownPosition.width,
                                      maxHeight: projectRoleDropdownPosition.maxHeight,
                                    }}
                                  >
                                    {AVAILABLE_ROLES.filter(r => r !== 'MasterAdmin').map((role) => {
                                      const isRoleChecked = (editProjectRoles[project.projectNo] || []).includes(role);
                                      return (
                                        <button
                                          key={role}
                                          type="button"
                                          onClick={() => toggleProjectRole(project.projectNo, role)}
                                          className="w-full h-8 rounded-lg px-2 flex items-center justify-between text-left text-xs font-semibold hover:bg-slate-50 transition-all text-slate-600"
                                        >
                                          <span>{role}</span>
                                          {isRoleChecked && <Check size={12} className="text-[#6e42f4] shrink-0" />}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </>,
                                document.body
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {allProjects.length === 0 && (
                      <div className="text-center py-4 text-xs text-slate-400 font-bold">
                        No active project sites found in the system database.
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-slate-100 bg-slate-50 rounded-b-3xl flex justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={isSubmitting}
                className="h-10 px-4 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="h-10 px-5 bg-gradient-to-r from-[#6e42f4] to-[#4f2ed9] text-white rounded-xl text-xs font-bold hover:opacity-95 shadow-md shadow-purple-200/50 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  'Save Settings'
                )}
              </button>
            </div>

          </form>
        </div>
      )}
    </div>
  );
}
