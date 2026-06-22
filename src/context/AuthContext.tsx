import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp,
  onSnapshot,
  collection,
  addDoc,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { UserProfile } from '../types/models';

const APP_NAME = 'CMG-Store-Management';

function setSessionExpiry() {
  const expiryTime = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
  localStorage.setItem('session_expiry', expiryTime.toString());
}

async function logActivity(action: 'REGISTER' | 'LOGIN', email: string, details?: Record<string, unknown>) {
  try {
    const logsCol = collection(db, APP_NAME, 'root', 'activityLogs');
    await addDoc(logsCol, {
      action,
      email,
      timestamp: serverTimestamp(),
      details: details || {},
    });
  } catch (e) {
    // Silent catch as per specifications
    console.error('Failed to log activity:', e);
  }
}

interface AuthContextValue {
  firebaseUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  loginWithEmail: (email: string, password: string) => Promise<UserProfile>;
  loginWithGoogle: () => Promise<UserProfile>;
  registerWithEmail: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    position: string
  ) => Promise<UserProfile>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Setup profile listener
  useEffect(() => {
    let unsubscribeProfile = () => {};

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);

      if (user && user.email) {
        const userDocRef = doc(db, APP_NAME, 'root', 'users', user.email.toLowerCase());
        
        // Use real-time listener on user profile doc
        unsubscribeProfile = onSnapshot(
          userDocRef,
          (docSnap) => {
            if (docSnap.exists()) {
              setUserProfile(docSnap.data() as UserProfile);
            } else {
              setUserProfile(null);
            }
            setLoading(false);
          },
          (error) => {
            // Silent error as per specifications
            console.error('Failed to fetch profile in onSnapshot:', error);
            setUserProfile(null);
            setLoading(false);
          }
        );
      } else {
        setUserProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      unsubscribeProfile();
    };
  }, []);

  const loginWithEmail = async (email: string, password: string): Promise<UserProfile> => {
    const emailLower = email.toLowerCase();
    const credential = await signInWithEmailAndPassword(auth, emailLower, password);
    setSessionExpiry();

    const userDocRef = doc(db, APP_NAME, 'root', 'users', emailLower);
    const userDoc = await getDoc(userDocRef);
    if (!userDoc.exists()) {
      throw new Error('user-not-found');
    }

    const profile = userDoc.data() as UserProfile;
    
    // Non-blocking log
    logActivity('LOGIN', emailLower, { uid: credential.user.uid }).catch(() => {});

    return profile;
  };

  const loginWithGoogle = async (): Promise<UserProfile> => {
    const provider = new GoogleAuthProvider();
    const credential = await signInWithPopup(auth, provider);
    setSessionExpiry();

    const user = credential.user;
    const emailLower = user.email!.toLowerCase();
    const userDocRef = doc(db, APP_NAME, 'root', 'users', emailLower);
    const configDocRef = doc(db, APP_NAME, 'root', 'appMeta', 'config');

    // Run transaction to check if they are the first user and safely set profile
    const profile = await runTransaction(db, async (transaction) => {
      const userDoc = await transaction.get(userDocRef);
      
      // If user profile already exists, just return it
      if (userDoc.exists()) {
        return userDoc.data() as UserProfile;
      }

      // Read config doc to check for first user
      const configDoc = await transaction.get(configDocRef);
      let isFirst = false;

      if (!configDoc.exists() || !configDoc.data()?.firstUserRegistered) {
        isFirst = true;
        transaction.set(configDocRef, {
          firstUserRegistered: true,
          totalUsers: 1,
          createdAt: serverTimestamp(),
        }, { merge: true });
      } else {
        const total = (configDoc.data()?.totalUsers || 0) + 1;
        transaction.update(configDocRef, { totalUsers: total });
      }

      const displayName = user.displayName || '';
      const parts = displayName.split(' ');
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ') || '';

      const newProfile: UserProfile = {
        uid: user.uid,
        email: emailLower,
        firstName,
        lastName,
        position: 'Staff',
        role: isFirst ? ['MasterAdmin'] : ['Staff'],
        status: isFirst ? 'approved' : 'pending',
        assignedProjects: [],
        createdAt: Timestamp.now(), // Fallback to Timestamp.now() inside transactions
        photoURL: user.photoURL || undefined,
        isFirstUser: isFirst,
      };

      transaction.set(userDocRef, newProfile);
      return newProfile;
    });

    // Non-blocking log
    logActivity('LOGIN', emailLower, { uid: user.uid, method: 'google' }).catch(() => {});

    return profile;
  };

  const registerWithEmail = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    position: string
  ): Promise<UserProfile> => {
    const emailLower = email.toLowerCase();
    const credential = await createUserWithEmailAndPassword(auth, emailLower, password);
    setSessionExpiry();

    const user = credential.user;
    const userDocRef = doc(db, APP_NAME, 'root', 'users', emailLower);
    const configDocRef = doc(db, APP_NAME, 'root', 'appMeta', 'config');

    const profile = await runTransaction(db, async (transaction) => {
      const configDoc = await transaction.get(configDocRef);
      let isFirst = false;

      if (!configDoc.exists() || !configDoc.data()?.firstUserRegistered) {
        isFirst = true;
        transaction.set(configDocRef, {
          firstUserRegistered: true,
          totalUsers: 1,
          createdAt: serverTimestamp(),
        }, { merge: true });
      } else {
        const total = (configDoc.data()?.totalUsers || 0) + 1;
        transaction.update(configDocRef, { totalUsers: total });
      }

      const newProfile: UserProfile = {
        uid: user.uid,
        email: emailLower,
        firstName,
        lastName,
        position,
        role: isFirst ? ['MasterAdmin'] : ['Staff'],
        status: isFirst ? 'approved' : 'pending',
        assignedProjects: [],
        createdAt: Timestamp.now(),
        isFirstUser: isFirst,
      };

      transaction.set(userDocRef, newProfile);
      return newProfile;
    });

    // Non-blocking logs
    logActivity('REGISTER', emailLower, { uid: user.uid }).catch(() => {});
    logActivity('LOGIN', emailLower, { uid: user.uid }).catch(() => {});

    return profile;
  };

  const logout = async () => {
    localStorage.removeItem('session_expiry');
    await signOut(auth);
  };

  const refreshProfile = async () => {
    if (firebaseUser && firebaseUser.email) {
      try {
        const userDocRef = doc(db, APP_NAME, 'root', 'users', firebaseUser.email.toLowerCase());
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          setUserProfile(userDoc.data() as UserProfile);
        }
      } catch (error) {
        // Silent error as per specifications
        console.error('Failed to manually refresh user profile:', error);
      }
    }
  };

  const updateProfile = async (data: Partial<UserProfile>) => {
    if (firebaseUser && firebaseUser.email) {
      const userDocRef = doc(db, APP_NAME, 'root', 'users', firebaseUser.email.toLowerCase());
      await setDoc(userDocRef, data, { merge: true });
    }
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userProfile,
        loading,
        loginWithEmail,
        loginWithGoogle,
        registerWithEmail,
        logout,
        refreshProfile,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
