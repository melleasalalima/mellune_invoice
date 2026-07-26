/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { UserRole, UserProfile } from "../types";
import { Sparkles, ShieldCheck, Crown, Shield, User, Mail, Lock, LogIn, UserPlus, AlertTriangle, Lightbulb } from "lucide-react";

interface LoginProps {
  onLoginSuccess: (profile: UserProfile, isMock?: boolean) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Credentials Auth States
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Sign in using Google OAuth
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const firebaseUser = result.user;

      if (!firebaseUser || !firebaseUser.email) {
        throw new Error("No secure email associated with this Google Account.");
      }

      const userDocRef = doc(db, "users", firebaseUser.uid);
      const userDocSnap = await getDoc(userDocRef);

      let role = UserRole.USER;
      // Host account fallback to Super Admin
      if (firebaseUser.email === "melleasalalima@gmail.com") {
        role = UserRole.SUPER_ADMIN;
      }

      let profileData: UserProfile;

      if (userDocSnap.exists()) {
        const existingData = userDocSnap.data();
        profileData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || "Beads Merchant",
          role: existingData.role || role,
          createdAt: existingData.createdAt,
          updatedAt: serverTimestamp(),
        };
        // Update user timestamp and display name if changed
        await setDoc(userDocRef, {
          ...existingData,
          displayName: profileData.displayName,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else {
        profileData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || "Beads Merchant",
          role: role,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(userDocRef, profileData);
      }

      onLoginSuccess({
        ...profileData,
        createdAt: new Date(),
        updatedAt: new Date(),
      }, false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to sign in with Google.");
    } finally {
      setLoading(false);
    }
  };

  // Credentials Email/Password Login
  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please key in your email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const firebaseUser = result.user;

      const userDocRef = doc(db, "users", firebaseUser.uid);
      const userDocSnap = await getDoc(userDocRef);

      let role = UserRole.USER;
      // Host account fallback to Super Admin
      if (firebaseUser.email === "melleasalalima@gmail.com") {
        role = UserRole.SUPER_ADMIN;
      }

      let profileData: UserProfile;

      if (userDocSnap.exists()) {
        const existingData = userDocSnap.data();
        profileData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || "",
          displayName: firebaseUser.displayName || existingData.displayName || "Beads Cashier",
          role: existingData.role || role,
          createdAt: existingData.createdAt,
          updatedAt: serverTimestamp(),
        };
        await setDoc(userDocRef, {
          displayName: profileData.displayName,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else {
        profileData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || "",
          displayName: firebaseUser.displayName || "Beads Cashier",
          role: role,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(userDocRef, profileData);
      }

      onLoginSuccess({
        ...profileData,
        createdAt: new Date(),
        updatedAt: new Date(),
      }, false);
    } catch (err: any) {
      console.error(err);
      let friendlyError = err.message || "Authentication credentials rejected.";
      if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        friendlyError = "Incorrect password or registered email. Please try again.";
      } else if (err.code === "auth/invalid-email") {
        friendlyError = "The provided email format is incorrect.";
      }
      setError(friendlyError);
    } finally {
      setLoading(false);
    }
  };

  // Credentials Email/Password Register
  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !displayName) {
      setError("Please complete all registration credentials inputs.");
      return;
    }
    if (password.length < 6) {
      setError("Secure passwords must contain at least 6 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const firebaseUser = result.user;

      // Sync display name with Google auth user listing values
      try {
        await updateProfile(firebaseUser, { displayName });
      } catch (profileErr) {
        console.error("Non-blocking profile updates warning:", profileErr);
      }

      const userDocRef = doc(db, "users", firebaseUser.uid);
      
      let role = UserRole.USER;
      // Host account fallback to Super Admin
      if (email.toLowerCase().trim() === "melleasalalima@gmail.com") {
        role = UserRole.SUPER_ADMIN;
      }

      const profileData: UserProfile = {
        uid: firebaseUser.uid,
        email: email,
        displayName: displayName,
        role: role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(userDocRef, profileData);

      onLoginSuccess({
        ...profileData,
        createdAt: new Date(),
        updatedAt: new Date(),
      }, false);
    } catch (err: any) {
      console.error(err);
      let friendlyError = err.message || "Credentials registration failed.";
      if (err.code === "auth/email-already-in-use") {
        friendlyError = "This email is already in use. Connect with direct sign in!";
      } else if (err.code === "auth/invalid-email") {
        friendlyError = "The selected email format is invalid.";
      } else if (err.code === "auth/weak-password") {
        friendlyError = "The credentials password is too simple. Use 6+ characters.";
      }
      setError(friendlyError);
    } finally {
      setLoading(false);
    }
  };

  // Development bypass login helper for quick evaluation in standard sandboxes
  const handleDemoSignIn = async (role: UserRole) => {
    setLoading(true);
    setError(null);
    try {
      let dispName = "Jane Beads SuperAdmin";
      let dEmail = "melleasalalima@gmail.com";
      
      if (role === UserRole.ADMIN) {
        dispName = "Melle Admin Cashier";
        dEmail = "admin@beadshop.com";
      } else if (role === UserRole.USER) {
        dispName = "Staff Viewer";
        dEmail = "staff@beadshop.com";
      }

      const dPassword = "beads-demo-auth-123456";

      // 1. Try signing in first
      let firebaseUser;
      try {
        const result = await signInWithEmailAndPassword(auth, dEmail, dPassword);
        firebaseUser = result.user;
      } catch (signInErr: any) {
        // If user not found, create new account
        if (
          signInErr.code === "auth/user-not-found" || 
          signInErr.code === "auth/invalid-credential" ||
          signInErr.code === "auth/invalid-login-credentials"
        ) {
          const result = await createUserWithEmailAndPassword(auth, dEmail, dPassword);
          firebaseUser = result.user;
          // Sync profile display name
          try {
            await updateProfile(firebaseUser, { displayName: dispName });
          } catch (pUpdateErr) {
            console.error("Profile updates ignore:", pUpdateErr);
          }
        } else {
          throw signInErr;
        }
      }

      // 2. Prepare user profile
      const userDocRef = doc(db, "users", firebaseUser.uid);
      const userDocSnap = await getDoc(userDocRef);

      const profileData: UserProfile = {
        uid: firebaseUser.uid,
        email: dEmail,
        displayName: dispName,
        role: role,
        createdAt: userDocSnap.exists() ? userDocSnap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Set/update the profile document in the database
      await setDoc(userDocRef, profileData, { merge: true });

      onLoginSuccess({
        ...profileData,
        createdAt: new Date(),
        updatedAt: new Date(),
      }, false);
    } catch (err: any) {
      console.error("Demo bypass sign-in failed:", err);
      setError(`Demo sign-in failed: ${err.message || String(err)}. Make sure the database and authentication rules are ready.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-orange-50 bead-grid-pattern flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl shadow-xl p-8 relative overflow-hidden">
        
        {/* Decorative background gradients */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#fff1f2] rounded-full blur-2xl opacity-75" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-[#fff7ed] rounded-full blur-2xl opacity-75" />

        <div className="relative flex flex-col items-center">
          {/* Main Logo */}
          <div className="w-16 h-16 bg-gradient-to-tr from-rose-500 to-amber-500 rounded-2xl flex items-center justify-center text-white font-display font-medium text-3xl shadow-md rotate-3 hover:rotate-0 transition-transform duration-300 select-none">
            📿
          </div>
          
          <h1 className="mt-5 font-display text-2xl font-black tracking-tight text-slate-900 text-center">
            Beads Shop Account
          </h1>
          <p className="mt-1.5 text-slate-500 text-xs text-center max-w-xs">
            Sign in to access real-time inventory ledger and print beautiful customer invoice receipts.
          </p>

          {/* Tab Switcher for Credentials Sign In vs Account Creation */}
          <div className="w-full mt-6 bg-slate-100 border border-slate-200 rounded-2xl p-1 flex">
            <button
               type="button"
               onClick={() => { setIsRegisterMode(false); setError(null); }}
               className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                 !isRegisterMode 
                   ? "bg-white text-slate-900 shadow-sm" 
                   : "text-slate-400 hover:text-slate-650"
               }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign in Tab
            </button>
            <button
               type="button"
               onClick={() => { setIsRegisterMode(true); setError(null); }}
               className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                 isRegisterMode 
                   ? "bg-white text-slate-900 shadow-sm" 
                   : "text-slate-400 hover:text-slate-650"
               }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              Register Account
            </button>
          </div>

          {error && (
            <div className="w-full mt-4 bg-rose-50 border border-rose-200 text-rose-700 px-3.5 py-3 rounded-xl flex items-start gap-2.5 text-left">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-rose-800">Sign in error</span>
                <span className="block text-[11px] leading-relaxed text-rose-700 break-words">{error}</span>
              </div>
            </div>
          )}

          {/* Credentials Email/Password Form */}
          <form 
            onSubmit={isRegisterMode ? handleEmailSignUp : handleEmailSignIn} 
            className="w-full mt-5 space-y-4"
          >
            {isRegisterMode && (
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-450 mb-1 tracking-wider">Full Name *</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Melle Salalima"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 outline-none text-slate-800 rounded-xl text-xs focus:bg-white focus:border-[#f43f5e] focus:ring-1 focus:ring-[#f43f5e] transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-455 mb-1 tracking-wider font-mono">Email Address *</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  required
                  placeholder="name@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 outline-none text-slate-800 rounded-xl text-xs focus:bg-white focus:border-[#f43f5e] focus:ring-1 focus:ring-[#f43f5e] transition-all"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-[10px] font-bold uppercase text-slate-455 tracking-wider font-mono">Password *</label>
                {isRegisterMode && <span className="text-[9px] text-[#f43f5e] font-mono">6+ characters required</span>}
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 outline-none text-slate-800 rounded-xl text-xs focus:bg-white focus:border-[#f43f5e] focus:ring-1 focus:ring-[#f43f5e] transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#f43f5e] hover:bg-rose-600 text-white rounded-xl font-bold text-xs shadow-md uppercase tracking-wider cursor-pointer disabled:opacity-50 transition-all duration-150 flex items-center justify-center gap-2"
            >
              {loading ? "Authenticating..." : isRegisterMode ? "Create Credentials Account" : "Sign In with Credentials"}
            </button>
          </form>

          {/* Small friendly warning notice to keep user context synced */}
          <p className="mt-3.5 text-[10px] text-zinc-500 text-left leading-relaxed flex items-start gap-1.5">
            <Lightbulb className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
            <span>
              <span className="font-semibold text-zinc-700">First register?</span> If you register using your custom credentials with <span className="font-mono text-rose-500">melleasalalima@gmail.com</span>, you will immediately unlock bootstrapped Super Admin clearance.
            </span>
          </p>

          <div className="w-full my-6 flex items-center gap-3 select-none">
            <div className="h-px bg-slate-200 flex-1" />
            <span className="text-slate-400 text-[10px] font-mono font-bold uppercase tracking-wider">Or OAuth Connection</span>
            <div className="h-px bg-slate-200 flex-1" />
          </div>

          {/* Unified Google OAuth Trigger */}
          <button
            id="btn-google-signin"
            onClick={handleGoogleSignIn}
            disabled={loading}
            type="button"
            className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-850 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-3 text-xs uppercase tracking-wider disabled:opacity-50 cursor-pointer"
          >
            <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24">
              <path d="M12.24 10.285V13.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.859-3.578-7.859-8s3.53-8 7.859-8c2.46 0 4.105 1.025 5.047 1.926l2.427-2.334C17.955 2.192 15.34 1 12.24 1 6.133 1 1.18 5.927 1.18 12s4.953 11 11.06 11c6.376 0 10.607-4.484 10.607-10.79 0-.727-.08-1.282-.175-1.925H12.24z"/>
            </svg>
            {loading ? "Connecting..." : "Sign in with Google"}
          </button>

          <div className="w-full my-6 flex items-center gap-3 select-none">
            <div className="h-px bg-slate-200 flex-1" />
            <span className="text-slate-400 text-[10px] font-mono font-bold uppercase tracking-wider">Sandbox Controls</span>
            <div className="h-px bg-slate-200 flex-1" />
          </div>

          {/* Simulated Quick Toggles for Sandboxes evaluation comfort */}
          <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left">
            <div className="flex items-center gap-2 mb-2.5">
              <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Developer Demo Switch</span>
            </div>
            
            <p className="text-[11px] text-slate-500 mb-4 leading-normal">
              Toggle live bypass roles to audit the dashboard interface without setting up real backend email/Google setups:
            </p>

            <div className="grid grid-cols-1 gap-2">
              <button
                id="btn-demo-superadmin"
                onClick={() => handleDemoSignIn(UserRole.SUPER_ADMIN)}
                disabled={loading}
                type="button"
                className="w-full py-2 px-3.5 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-950 rounded-xl text-xs font-bold flex items-center justify-between transition-all cursor-pointer"
              >
                <span className="flex items-center gap-1.5 font-bold">
                  <Crown className="w-4 h-4 text-amber-500 shrink-0" />
                  Super Admin
                </span>
                <span className="text-[9.5px] font-mono bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-md font-bold text-orange-900 uppercase">
                  Full Control
                </span>
              </button>

              <button
                id="btn-demo-admin"
                onClick={() => handleDemoSignIn(UserRole.ADMIN)}
                disabled={loading}
                type="button"
                className="w-full py-2 px-3.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-950 rounded-xl text-xs font-bold flex items-center justify-between transition-all cursor-pointer"
              >
                <span className="flex items-center gap-1.5 font-bold">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  Admin
                </span>
                <span className="text-[9.5px] font-mono bg-emerald-100 border border-emerald-250 px-2 py-0.5 rounded-md font-bold text-emerald-800 uppercase">
                  Stock Manager
                </span>
              </button>

              <button
                id="btn-demo-user"
                onClick={() => handleDemoSignIn(UserRole.USER)}
                disabled={loading}
                type="button"
                className="w-full py-2 px-3.5 bg-slate-100 hover:bg-slate-200 border border-slate-350 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-between transition-all cursor-pointer"
              >
                <span className="flex items-center gap-1.5 font-bold">
                  <User className="w-4 h-4 text-slate-500 shrink-0" />
                  Viewer / Cashier
                </span>
                <span className="text-[9.5px] font-mono bg-slate-200 border border-slate-300 px-2 py-0.5 rounded-md font-bold text-slate-650 uppercase">
                  Viewer Mode
                </span>
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

