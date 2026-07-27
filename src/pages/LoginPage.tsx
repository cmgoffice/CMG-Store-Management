import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, ShieldAlert, LogIn, Chrome } from 'lucide-react';

export function LoginPage() {
  const { loginWithEmail, loginWithGoogle, userProfile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Get destination route from location state (default to '/')
  const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';

  // Watch user profile status to trigger redirects
  useEffect(() => {
    if (userProfile) {
      if (userProfile.status === 'rejected') {
        setError('Your registration request was rejected by the system administrator.');
      } else if (userProfile.status === 'pending') {
        navigate('/pending', { replace: true });
      } else if (userProfile.status === 'approved') {
        navigate(destination, { replace: true });
      }
    }
  }, [userProfile, navigate, destination]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await loginWithEmail(email, password);
      // Force AuthContext update immediately after successful sign-in
      await refreshProfile();
    } catch (err: unknown) {
      const authError = err as { code?: string; message?: string };
      console.error('Login error:', err);
      if (
        authError.code === 'auth/wrong-password' ||
        authError.code === 'auth/user-not-found' ||
        authError.code === 'auth/invalid-credential' ||
        authError.message === 'user-not-found'
      ) {
        setError('Invalid email or password. Please try again.');
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      await loginWithGoogle();
      // Force AuthContext update immediately after successful sign-in
      await refreshProfile();
    } catch (err: unknown) {
      const authError = err as { code?: string; message?: string };
      console.error('Google login error:', err);
      if (authError.code === 'auth/popup-closed-by-user') {
        setError('Google login window was closed. Please try again.');
      } else if (authError.code === 'auth/unauthorized-domain') {
        setError('This domain is not authorized for Google Sign-In.');
      } else {
        setError('Could not connect to Google Firebase Security.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0ecfc] p-6 relative overflow-hidden font-sans">
      {/* Decorative Blur Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-tr from-purple-300 to-indigo-300 opacity-40 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-bl from-pink-300 to-purple-300 opacity-40 blur-[100px] pointer-events-none" />

      {/* Main Login Card */}
      <div className="w-full max-w-[460px] bg-white/80 backdrop-blur-xl border border-white/60 shadow-2xl rounded-3xl p-8 relative z-10 transition-all duration-300 hover:shadow-purple-200">
        
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-tr from-[#6e42f4] to-[#4f2ed9] rounded-2xl text-white shadow-lg shadow-purple-200 mb-4 animate-bounce">
            <LogIn size={26} />
          </div>
          <h1 className="text-2xl font-extrabold text-[#141b2b] tracking-tight">คลังสินค้า CMG</h1>
          <p className="text-xs text-[#404752] mt-1.5 font-medium uppercase tracking-wider">
            Enterprise Security Portal
          </p>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 text-[#ba1a1a] text-sm p-4 rounded-xl">
            <ShieldAlert className="shrink-0 mt-0.5" size={18} />
            <span className="font-semibold leading-snug">{error}</span>
          </div>
        )}

        {/* Form Container */}
        <form onSubmit={handleEmailLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-[#404752] uppercase mb-2 tracking-wider">
              อีเมล
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400" size={18} />
              <input
                type="email"
                placeholder="กรอกอีเมล..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="w-full h-12 pl-12 pr-4 bg-white/90 border border-slate-200 focus:border-[#6e42f4] focus:ring-2 focus:ring-purple-100 rounded-xl outline-none font-semibold text-sm transition-all text-[#141b2b]"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#404752] uppercase mb-2 tracking-wider">
              รหัสผ่าน
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400" size={18} />
              <input
                type="password"
                placeholder="กรอกรหัสผ่าน..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="w-full h-12 pl-12 pr-4 bg-white/90 border border-slate-200 focus:border-[#6e42f4] focus:ring-2 focus:ring-purple-100 rounded-xl outline-none font-semibold text-sm transition-all text-[#141b2b]"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-gradient-to-r from-[#6e42f4] to-[#4f2ed9] text-white font-bold text-sm rounded-xl shadow-lg shadow-purple-300/40 hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              'เข้าสู่ระบบด้วยรหัสผ่าน'
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="relative flex py-5 items-center my-2">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="flex-shrink mx-4 text-xs font-bold text-[#8d879b] uppercase tracking-wider">
            หรือ
          </span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>

        {/* Google Authentication Button */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full h-12 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold text-sm rounded-xl shadow-sm active:scale-[0.99] transition-all flex items-center justify-center gap-3"
        >
          <Chrome className="text-red-500" size={18} />
          <span>ดำเนินการต่อด้วย Google</span>
        </button>

        {/* Register Redirect Link */}
        <div className="text-center mt-8">
          <p className="text-xs text-[#404752] font-semibold">
            ยังไม่มีบัญชีผู้ใช้?{' '}
            <Link
              to="/register"
              className="text-[#6e42f4] hover:underline font-bold"
            >
              สมัครใช้งาน
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
