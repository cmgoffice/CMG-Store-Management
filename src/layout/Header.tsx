import React, { useState } from 'react';
import { Bell, ChevronDown, Search, ShieldCheck, LogOut, User as UserIcon, X, Settings } from 'lucide-react';
import { useRole } from '../context/RoleContext';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import type { UserRole } from '../types/models';
import styles from './Header.module.css';

interface HeaderProps {
  menuButton: React.ReactNode;
}

const roleLabels: Record<UserRole, string> = {
  'MasterAdmin': 'MasterAdmin',
  'Store Center': 'Store Center',
  'Admin Site': 'Admin Site',
  'Store Site': 'Store Site',
  'Keeper': 'Keeper',
  'Staff': 'Staff',
};

export function Header({ menuButton }: HeaderProps) {
  const { activeRole, roles, setActiveRole } = useRole();
  const { userProfile, updateProfile, logout } = useAuth();
  const navigate = useNavigate();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Profile Edit Local Form States
  const [firstName, setFirstName] = useState(userProfile?.firstName || '');
  const [lastName, setLastName] = useState(userProfile?.lastName || '');
  const [position, setPosition] = useState(userProfile?.position || '');

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleOpenModal = () => {
    if (userProfile) {
      setFirstName(userProfile.firstName);
      setLastName(userProfile.lastName);
      setPosition(userProfile.position);
    }
    setIsModalOpen(true);
    setIsDropdownOpen(false);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !position) {
      alert('Please fill in all fields.');
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({ firstName, lastName, position });
      setIsModalOpen(false);
    } catch (err) {
      console.error('Failed to update profile:', err);
      alert('Failed to update profile settings.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.left}>
          {menuButton}
          <div>
            <p className={styles.system}>CMG Store Management</p>
            <span>Inventory, dispatch, and site receiving</span>
          </div>
        </div>
        
        <label className={styles.searchBar}>
          <select aria-label="Search category">
            <option>All Category</option>
            <option>Stock</option>
            <option>Project</option>
            <option>Shipment</option>
          </select>
          <input type="search" placeholder="Search here....." />
          <Search size={18} aria-hidden="true" />
        </label>

        <div className={styles.actions}>
          <button className={styles.iconButton} type="button" aria-label="Alerts">
            <Bell size={18} />
          </button>

          {/* Role Selector Dropdown */}
          <label className={styles.roleSwitcher}>
            <ShieldCheck size={16} aria-hidden="true" />
            <select
              aria-label="Switch active role"
              value={activeRole}
              onChange={(event) => setActiveRole(event.target.value as UserRole)}
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role] || role}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </label>

          {/* User Profile Avatar with dropdown list */}
          <div className="relative overflow-visible">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={styles.avatarButton}
              type="button"
              aria-label="User profile options"
            >
              {userProfile?.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  alt={`${userProfile.firstName} avatar`}
                  className={styles.headerAvatar}
                />
              ) : (
                <div className={styles.headerAvatarFallback}>
                  {userProfile?.firstName[0] || 'U'}
                </div>
              )}
            </button>

            {/* Profile Dropdown (z-index 10010) */}
            {isDropdownOpen && (
              <>
                <div className="fixed inset-0 z-[10005]" onClick={() => setIsDropdownOpen(false)} />
                <div className={`${styles.dropdownMenu} z-[10010]`}>
                  <div className={styles.dropdownHeader}>
                    <div className="font-bold text-slate-800 text-sm">
                      {userProfile?.firstName} {userProfile?.lastName}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{userProfile?.email}</div>
                    <div className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 mt-1 inline-block uppercase">
                      {userProfile?.position}
                    </div>
                  </div>
                  <div className="border-t border-slate-100 py-1">
                    <button
                      type="button"
                      onClick={handleOpenModal}
                      className={styles.dropdownItem}
                    >
                      <Settings size={14} />
                      <span>Edit Profile</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className={`${styles.dropdownItem} text-red-600 hover:bg-red-50`}
                    >
                      <LogOut size={14} />
                      <span>Logout</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Edit Profile Modal (z-index 10000) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleUpdateProfile}
            className="w-full max-w-[420px] bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden"
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-800">Edit Profile</h3>
                <p className="text-xs text-slate-500">Update your account settings</p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  First Name
                </label>
                <div className="relative">
                  <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={isSaving}
                    className="w-full h-10 pl-10 pr-4 border border-slate-200 focus:border-[#6e42f4] rounded-xl outline-none font-semibold text-sm transition-all text-slate-800"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Last Name
                </label>
                <div className="relative">
                  <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={isSaving}
                    className="w-full h-10 pl-10 pr-4 border border-slate-200 focus:border-[#6e42f4] rounded-xl outline-none font-semibold text-sm transition-all text-slate-800"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Position / Job Title
                </label>
                <input
                  type="text"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  disabled={isSaving}
                  className="w-full h-10 px-4 border border-slate-200 focus:border-[#6e42f4] rounded-xl outline-none font-semibold text-sm transition-all text-slate-800"
                  required
                />
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                disabled={isSaving}
                className="h-10 px-4 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="h-10 px-5 bg-gradient-to-r from-[#6e42f4] to-[#4f2ed9] text-white rounded-xl text-xs font-bold hover:opacity-95 shadow-md shadow-purple-100 flex items-center justify-center gap-1.5"
              >
                {isSaving ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  'Save Settings'
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
