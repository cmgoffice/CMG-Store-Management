import { Menu } from 'lucide-react';
import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import styles from './AppShell.module.css';
import { usePendingTasks } from '../hooks/usePendingTasks';
import { PendingTasksModal } from '../components/PendingTasksModal';

const PENDING_TASK_MODAL_DISMISSED_DATE_KEY = 'cmg-pending-task-modal-dismissed-date';

function getTodayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function AppShell({ children }: PropsWithChildren) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isPendingTaskModalOpen, setIsPendingTaskModalOpen] = useState(false);
  const hasShownPendingTaskModal = useRef(false);
  const { tasks: pendingTasks } = usePendingTasks();

  useEffect(() => {
    if (pendingTasks.length === 0 || hasShownPendingTaskModal.current) {
      return;
    }

    hasShownPendingTaskModal.current = true;
    try {
      if (window.localStorage.getItem(PENDING_TASK_MODAL_DISMISSED_DATE_KEY) !== getTodayKey()) {
        setIsPendingTaskModalOpen(true);
      }
    } catch (error) {
      console.warn('Unable to read pending task modal preference:', error);
      setIsPendingTaskModalOpen(true);
    }
  }, [pendingTasks.length]);

  const dismissPendingTaskModalToday = () => {
    try {
      window.localStorage.setItem(PENDING_TASK_MODAL_DISMISSED_DATE_KEY, getTodayKey());
    } catch (error) {
      console.warn('Unable to save pending task modal preference:', error);
    }
    setIsPendingTaskModalOpen(false);
  };

  return (
    <div className={`${styles.shell} ${isSidebarCollapsed ? styles.collapsedShell : ''}`}>
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        pendingTasks={pendingTasks}
      />
      <div className={styles.contentArea}>
        <Header
          pendingTasks={pendingTasks}
          menuButton={
            <button
              className={styles.mobileMenu}
              type="button"
              aria-label="Open navigation"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
          }
        />
        <main className={styles.main}>{children}</main>
      </div>
      {isPendingTaskModalOpen ? (
        <PendingTasksModal
          tasks={pendingTasks}
          onClose={() => setIsPendingTaskModalOpen(false)}
          onDismissToday={dismissPendingTaskModalToday}
        />
      ) : null}
    </div>
  );
}
