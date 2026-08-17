import React, { useState } from 'react';
import { Bell, Search, LogOut, User as UserIcon, X, Settings } from 'lucide-react';
import { ITEM_TYPE_OPTIONS, getItemTypeOption } from '../constants/itemTypes';
import { useAuth } from '../context/AuthContext';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useDialog } from '../context/DialogContext';
import { useLanguage } from '../context/LanguageContext';
import { useInventory } from '../context/InventoryContext';
import type { PendingTask } from '../hooks/usePendingTasks';
import styles from './Header.module.css';

interface HeaderProps {
  menuButton: React.ReactNode;
  pendingTasks: PendingTask[];
}

const menuTitles = [
  { path: '/store/project-borrow', title: 'ยืม-คืนระหว่างโครงการ' },
  { path: '/store/withdraw', title: 'เบิกสินค้า' },
  { path: '/store/dispatch', title: 'จัดส่งสินค้า' },
  { path: '/store/store', title: 'คลังโครงการ' },
  { path: '/store/stock', title: 'สินค้าคงคลัง' },
  { path: '/receiving', title: 'รับสินค้า' },
  { path: '/cancellations', title: 'ยกเลิกรายการ' },
  { path: '/projects', title: 'รายการโครงการ' },
  { path: '/admin', title: 'จัดการผู้ใช้' },
  { path: '/activity-logs', title: 'ประวัติกิจกรรม' },
];

function getActiveMenuTitle(pathname: string) {
  return menuTitles.find(({ path }) => pathname === path || pathname.startsWith(`${path}/`))?.title ?? 'แดชบอร์ด';
}

export function Header({ menuButton, pendingTasks }: HeaderProps) {
  const { userProfile, updateProfile, logout } = useAuth();
  const { setActiveProjectNo } = useInventory();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showAlert } = useDialog();
  const { language, setLanguage } = useLanguage();
  const selectedItemType = getItemTypeOption(searchParams.get('itemType') ?? '')?.code ?? '';
  const activeMenuTitle = getActiveMenuTitle(location.pathname);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
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

  const handleItemTypeChange = (value: string) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    const itemType = getItemTypeOption(value)?.code;

    if (itemType) {
      nextSearchParams.set('itemType', itemType);
    } else {
      nextSearchParams.delete('itemType');
    }

    setSearchParams(nextSearchParams, { replace: true });
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !position) {
      await showAlert('กรุณากรอกข้อมูลให้ครบทุกช่อง', { title: 'ข้อมูลไม่ครบถ้วน', variant: 'warning' });
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({ firstName, lastName, position });
      setIsModalOpen(false);
    } catch (err) {
      console.error('Failed to update profile:', err);
      await showAlert('ไม่สามารถบันทึกการตั้งค่าโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง', { variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTaskClick = (task: PendingTask) => {
    if (task.projectNo) {
      setActiveProjectNo(task.projectNo);
    }
    setIsNotificationsOpen(false);
    navigate(task.route);
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.left}>
          {menuButton}
          <div>
            <p className={styles.system}>ระบบจัดการคลังสินค้า CMG</p>
            <span>{activeMenuTitle}</span>
          </div>
        </div>
        
        <label className={styles.searchBar}>
          <select
            aria-label="หมวดหมู่สำหรับค้นหา"
            value={selectedItemType}
            onChange={(event) => handleItemTypeChange(event.target.value)}
          >
            <option value="">ทุกหมวดหมู่</option>
            <optgroup label="Type 1">
              {ITEM_TYPE_OPTIONS.filter((option) => option.group === 'Type 1').map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} — {option.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Type 2">
              {ITEM_TYPE_OPTIONS.filter((option) => option.group === 'Type 2').map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} — {option.label}
                </option>
              ))}
            </optgroup>
          </select>
          <input type="search" placeholder="ค้นหาที่นี่..." />
          <Search size={18} aria-hidden="true" />
        </label>

        <div className={styles.actions}>
          <div className={styles.notificationWrap}>
            <button
              className={styles.iconButton}
              type="button"
              aria-label={`การแจ้งเตือน${pendingTasks.length ? ` ${pendingTasks.length} รายการ` : ''}`}
              aria-expanded={isNotificationsOpen}
              onClick={() => setIsNotificationsOpen((open) => !open)}
            >
              <Bell size={18} />
              {pendingTasks.length > 0 ? (
                <span className={styles.notificationBadge}>{pendingTasks.length > 99 ? '99+' : pendingTasks.length}</span>
              ) : null}
            </button>
            {isNotificationsOpen ? (
              <div className={styles.notificationPanel} role="dialog" aria-label="รายการแจ้งเตือน">
                <div className={styles.notificationHeader}>
                  <div>
                    <strong>รายการรอดำเนินการ</strong>
                    <span>{pendingTasks.length} รายการตามสิทธิ์ของคุณ</span>
                  </div>
                  <button type="button" className={styles.notificationClose} onClick={() => setIsNotificationsOpen(false)} aria-label="ปิดแจ้งเตือน">
                    <X size={15} />
                  </button>
                </div>
                <div className={styles.notificationList}>
                  {pendingTasks.length > 0 ? pendingTasks.map((task) => (
                    <button key={task.id} type="button" className={styles.notificationItem} onClick={() => handleTaskClick(task)}>
                      <span className={styles.notificationDot} />
                      <span className={styles.notificationItemText}>
                        <strong>{task.title}</strong>
                        <small>{task.description}</small>
                      </span>
                    </button>
                  )) : (
                    <div className={styles.notificationEmpty}>ไม่มีรายการที่รอดำเนินการ</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <button
            className={styles.languageButton}
            type="button"
            onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
            aria-label={language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
            title={language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
          >
            {language === 'th' ? 'EN' : 'TH'}
          </button>

          {/* User Profile Avatar with dropdown list */}
          <div className="relative overflow-visible">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={styles.avatarButton}
              type="button"
              aria-label="ตัวเลือกโปรไฟล์ผู้ใช้"
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
                      <span>แก้ไขโปรไฟล์</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className={`${styles.dropdownItem} text-red-600 hover:bg-red-50`}
                    >
                      <LogOut size={14} />
                      <span>ออกจากระบบ</span>
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
                <h3 className="text-base font-black text-slate-800">แก้ไขโปรไฟล์</h3>
                <p className="text-xs text-slate-500">อัปเดตการตั้งค่าบัญชีของคุณ</p>
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
