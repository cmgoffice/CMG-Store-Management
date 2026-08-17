import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { DispatchPage } from './pages/DispatchPage';
import { ProjectListPage } from './pages/ProjectListPage';
import { ReceivingPage } from './pages/ReceivingPage';
import { StockListPage } from './pages/StockListPage';
import { StorePage } from './pages/StorePage';
import { WithdrawPage } from './pages/WithdrawPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { PendingApprovalPage } from './pages/PendingApprovalPage';
import { AdminPanel } from './pages/AdminPanel';
import { ProjectBorrowPage } from './pages/ProjectBorrowPage';
import { CancellationPage } from './pages/CancellationPage';
import { ActivityLogPage } from './pages/ActivityLogPage';
import { ProtectedRoute } from './components/ProtectedRoute';

export function App() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      
      {/* Pending Approval Screen */}
      <Route
        path="/pending"
        element={
          <ProtectedRoute requireApproved={false}>
            <PendingApprovalPage />
          </ProtectedRoute>
        }
      />

      {/* Protected Routes inside AppShell */}
      <Route
        path="/*"
        element={
          <ProtectedRoute requireApproved={true}>
            <AppShell>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route
                  path="/projects"
                  element={
                    <ProtectedRoute requireApproved={true} requireRoles={['MasterAdmin']}>
                      <ProjectListPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/store/stock"
                  element={
                    <ProtectedRoute requireApproved={true} requireRoles={['MasterAdmin', 'Store Center']}>
                      <StockListPage />
                    </ProtectedRoute>
                  }
                />
                <Route path="/store/store" element={<StorePage />} />
                <Route path="/store/withdraw" element={<WithdrawPage />} />
                <Route path="/store/project-borrow" element={<ProjectBorrowPage />} />
                <Route
                  path="/store/dispatch"
                  element={
                    <ProtectedRoute requireApproved={true} requireRoles={['MasterAdmin', 'Store Center', 'Admin Site', 'Store Site', 'Staff']}>
                      <DispatchPage />
                    </ProtectedRoute>
                  }
                />
                <Route path="/receiving" element={<ReceivingPage />} />
                <Route path="/cancellations" element={<CancellationPage />} />
                
                {/* Admin-only view */}
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute requireApproved={true} requireRoles={['MasterAdmin']}>
                      <AdminPanel />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/activity-logs"
                  element={
                    <ProtectedRoute requireApproved={true} requireRoles={['MasterAdmin']}>
                      <ActivityLogPage />
                    </ProtectedRoute>
                  }
                />
                
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
