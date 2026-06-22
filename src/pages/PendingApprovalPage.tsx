import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Clock, LogOut } from 'lucide-react';

export function PendingApprovalPage() {
  const { userProfile, logout } = useAuth();
  const navigate = useNavigate();

  // Watch for state changes to approved
  useEffect(() => {
    if (userProfile && userProfile.status === 'approved') {
      navigate('/', { replace: true });
    }
  }, [userProfile, navigate]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (e) {
      console.error('Failed to log out:', e);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0ecfc] p-6 relative overflow-hidden font-sans">
      {/* Decorative Blur Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-tr from-purple-300 to-indigo-300 opacity-40 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-bl from-pink-300 to-purple-300 opacity-40 blur-[100px] pointer-events-none" />

      {/* Pending Approval Card */}
      <div className="w-full max-w-[480px] bg-white/85 backdrop-blur-2xl border border-white/60 shadow-2xl rounded-3xl p-8 text-center relative z-10">
        
        {/* Animated Icon */}
        <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500/10 text-amber-500 rounded-2xl mb-6 relative">
          <Clock size={32} className="animate-pulse" />
          <div className="absolute inset-0 rounded-2xl border-2 border-amber-500/20 animate-ping pointer-events-none" />
        </div>

        {/* Message */}
        <h1 className="text-2xl font-black text-[#141b2b] mb-3">Pending Registration Approval</h1>
        <p className="text-sm font-semibold text-[#404752] leading-relaxed mb-6">
          Hello, <strong className="text-[#6e42f4]">{userProfile?.firstName} {userProfile?.lastName}</strong>. Your account has been registered successfully. 
          Please wait for a MasterAdmin or System Administrator to approve your request.
        </p>

        {/* Status indicator */}
        <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold px-4 py-2 rounded-full mb-8">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping shrink-0" />
          <span>STATUS: PENDING ADMINISTRATOR REVIEW</span>
        </div>

        {/* Action Button */}
        <button
          onClick={handleLogout}
          className="w-full h-11 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold text-sm rounded-xl shadow-sm active:scale-[0.99] transition-all flex items-center justify-center gap-2.5"
        >
          <LogOut size={16} />
          <span>Log Out and Return</span>
        </button>
      </div>
    </div>
  );
}
