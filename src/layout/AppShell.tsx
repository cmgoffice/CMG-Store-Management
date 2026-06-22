import { Menu } from 'lucide-react';
import { useState, type PropsWithChildren } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import styles from './AppShell.module.css';

export function AppShell({ children }: PropsWithChildren) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className={`${styles.shell} ${isSidebarCollapsed ? styles.collapsedShell : ''}`}>
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />
      <div className={styles.contentArea}>
        <Header
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
    </div>
  );
}
