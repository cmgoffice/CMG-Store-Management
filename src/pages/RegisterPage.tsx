import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, User as UserIcon, Briefcase, ShieldCheck, ShieldAlert } from 'lucide-react';

export function RegisterPage() {
  const { registerWithEmail, userProfile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Watch profile to route logged-in users
  useEffect(() => {
    if (userProfile) {
      if (userProfile.status === 'pending') {
        navigate('/pending', { replace: true });
      } else if (userProfile.status === 'approved') {
        navigate('/', { replace: true });
      }
    }
  }, [userProfile, navigate]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !firstName || !lastName || !position) {
      setError('Please fill in all fields.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await registerWithEmail(email, password, firstName, lastName, position);
      await refreshProfile();
    } catch (err: unknown) {
      const authError = err as { code?: string; message?: string };
      console.error('Registration error:', err);
      if (authError.code === 'auth/email-already-in-use') {
        setError('This email address is already registered in the system.');
      } else if (authError.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters long.');
      } else if (authError.code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        setError('Registration failed. Please check details and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0ecfc] p-6 relative overflow-hidden font-sans">
      {/* Decorative Blur Orbs */}
      <div className="absolute top-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-tr from-purple-300 to-indigo-300 opacity-40 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-bl from-pink-300 to-purple-300 opacity-40 blur-[100px] pointer-events-none" />

      {/* Main Registration Card */}
      <div className="w-full max-w-[500px] bg-white/80 backdrop-blur-xl border border-white/60 shadow-2xl rounded-3xl p-8 relative z-10 transition-all duration-300 hover:shadow-purple-200">
        
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-tr from-[#6e42f4] to-[#4f2ed9] rounded-2xl text-white shadow-lg shadow-purple-200 mb-4">
            <ShieldCheck size={26} />
          </div>
          <h1 className="text-2xl font-extrabold text-[#141b2b] tracking-tight">Create Account</h1>
          <p className="text-xs text-[#404752] mt-1.5 font-medium uppercase tracking-wider">
            Register for CMG Store Management
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
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#404752] uppercase mb-1.5 tracking-wider">
                First Name
              </label>
              <div className="relative">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400" size={16} />
                <input
                  type="text"
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={loading}
                  className="w-full h-11 pl-11 pr-4 bg-white/90 border border-slate-200 focus:border-[#6e42f4] focus:ring-2 focus:ring-purple-100 rounded-xl outline-none font-semibold text-sm transition-all text-[#141b2b]"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#404752] uppercase mb-1.5 tracking-wider">
                Last Name
              </label>
              <div className="relative">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400" size={16} />
                <input
                  type="text"
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={loading}
                  className="w-full h-11 pl-11 pr-4 bg-white/90 border border-slate-200 focus:border-[#6e42f4] focus:ring-2 focus:ring-purple-100 rounded-xl outline-none font-semibold text-sm transition-all text-[#141b2b]"
                  required
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#404752] uppercase mb-1.5 tracking-wider">
              Position / Department
            </label>
            <div className="relative">
              <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400" size={16} />
              <input
                type="text"
                placeholder="e.g. Project Engineer, Store Manager"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                disabled={loading}
                className="w-full h-11 pl-11 pr-4 bg-white/90 border border-slate-200 focus:border-[#6e42f4] focus:ring-2 focus:ring-purple-100 rounded-xl outline-none font-semibold text-sm transition-all text-[#141b2b]"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#404752] uppercase mb-1.5 tracking-wider">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400" size={16} />
              <input
                type="email"
                placeholder="work email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="w-full h-11 pl-11 pr-4 bg-white/90 border border-slate-200 focus:border-[#6e42f4] focus:ring-2 focus:ring-purple-100 rounded-xl outline-none font-semibold text-sm transition-all text-[#141b2b]"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#404752] uppercase mb-1.5 tracking-wider">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400" size={16} />
              <input
                type="password"
                placeholder="at least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="w-full h-11 pl-11 pr-4 bg-white/90 border border-slate-200 focus:border-[#6e42f4] focus:ring-2 focus:ring-purple-100 rounded-xl outline-none font-semibold text-sm transition-all text-[#141b2b]"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-gradient-to-r from-[#6e42f4] to-[#4f2ed9] text-white font-bold text-sm rounded-xl shadow-lg shadow-purple-300/40 hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-4"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              'Submit Registration'
            )}
          </button>
        </form>

        {/* Back to Login Redirect */}
        <div className="text-center mt-8">
          <p className="text-xs text-[#404752] font-semibold">
            Already have an account?{' '}
            <Link
              to="/login"
              className="text-[#6e42f4] hover:underline font-bold"
            >
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
