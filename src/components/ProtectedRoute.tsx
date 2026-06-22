import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import { UserRole } from '../types/models';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireApproved?: boolean;
  requireRoles?: UserRole[];
}

export function ProtectedRoute({
  children,
  requireApproved = true,
  requireRoles,
}: ProtectedRouteProps) {
  const { firebaseUser, userProfile, loading, logout } = useAuth();
  const { activeRole } = useRole();
  const location = useLocation();

  // Handle auto-logout of rejected users
  useEffect(() => {
    if (userProfile && userProfile.status === 'rejected') {
      logout().catch((err) => console.error('Failed to logout rejected user:', err));
    }
  }, [userProfile, logout]);

  // 1. Loading state -> show spinner
  if (loading) {
    return <LoadingSpinner label="Checking security credentials..." />;
  }

  // 2. No Firebase User -> redirect to login
  if (!firebaseUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 3. Firebase User exists but User Profile is still loading in Firestore -> show spinner
  if (!userProfile) {
    return <LoadingSpinner label="Retrieving user profile..." />;
  }

  // 4. status === 'pending' -> redirect to /pending
  if (userProfile.status === 'pending' && requireApproved) {
    return <Navigate to="/pending" replace />;
  }

  // 5. status === 'rejected' -> redirect to /login
  if (userProfile.status === 'rejected') {
    return <Navigate to="/login" replace />;
  }

  // 6. requireRoles check
  if (requireRoles && requireRoles.length > 0) {
    if (!requireRoles.includes(activeRole)) {
      // Not authorized -> redirect to default route
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
}

function LoadingSpinner({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#f7f5ff',
        color: '#4f2ed9',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        style={{
          width: '42px',
          height: '42px',
          border: '4px solid rgba(79, 46, 217, 0.12)',
          borderTop: '4px solid #4f2ed9',
          borderRadius: '50%',
          animation: 'spin-security 1s linear infinite',
          marginBottom: '16px',
        }}
      />
      <style>{`
        @keyframes spin-security {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <span style={{ fontWeight: 600, fontSize: '13px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </span>
    </div>
  );
}
