/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./lib/firebase";
import { Invoice, UserProfile, UserRole } from "./types";
import Login from "./components/Login";
import Inventory from "./components/Inventory";
import Invoicing from "./components/Invoicing";
import InvoiceList from "./components/InvoiceList";
import InvoiceReceipt from "./components/InvoiceReceipt";
import Settings from "./components/Settings";
import Customers from "./components/Customers";
import { 
  Store, 
  Layers, 
  PlusCircle, 
  FileText, 
  Settings as SettingsIcon, 
  LogOut, 
  Briefcase, 
  Crown, 
  ShieldCheck, 
  User, 
  Sparkles,
  HelpCircle,
  Users
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

type ActiveTab = "inventory" | "create-invoice" | "invoice-list" | "settings" | "customers";

export default function App() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [canSimulateRoles, setCanSimulateRoles] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>("inventory");
  
  // Stored active invoice ID for detailed receipts views
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);

  // Auth synchronization
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          let profile: UserProfile;
          if (userDoc.exists()) {
            profile = {
              uid: firebaseUser.uid,
              ...userDoc.data()
            } as UserProfile;
          } else {
            // Self bootstrapping Super Admin fallback
            const defaultRole = firebaseUser.email === "melleasalalima@gmail.com" 
              ? UserRole.SUPER_ADMIN 
              : UserRole.USER;

            profile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || "",
              displayName: firebaseUser.displayName || "Beads Cashier",
              role: defaultRole,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          }

          const userCanSimulateRoles = profile.role === UserRole.SUPER_ADMIN;
          setCanSimulateRoles(userCanSimulateRoles);

          // Apply saved local simulation roles only for authenticated Super Admin access.
          const savedRole = localStorage.getItem("beads_simulated_role");
          if (userCanSimulateRoles && savedRole && (savedRole === "super_admin" || savedRole === "admin" || savedRole === "user")) {
            profile.role = savedRole as UserRole;
            profile.displayName = `Simulated ${savedRole.charAt(0).toUpperCase() + savedRole.slice(1)}`;
          } else if (!userCanSimulateRoles) {
            localStorage.removeItem("beads_simulated_role");
            localStorage.removeItem("beads_simulated_profile");
          }

          setUserProfile(profile);
        } catch (err) {
          console.error("Auth sync error:", err);
        }
      } else {
        setUserProfile(null);
        setCanSimulateRoles(false);
        // Clean any simulated statuses to prevent unauthenticated DB queries on logouts
        localStorage.removeItem("beads_simulated_role");
        localStorage.removeItem("beads_simulated_profile");
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLoginSuccess = (profile: UserProfile, isMock = false) => {
    setCanSimulateRoles(profile.role === UserRole.SUPER_ADMIN);
    setUserProfile(profile);
  };

  const handleLogout = async () => {
    localStorage.removeItem("beads_simulated_role");
    localStorage.removeItem("beads_simulated_profile");
    setCanSimulateRoles(false);
    setUserProfile(null);
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Signout error", e);
    }
  };

  // Triggered when a new invoice is generated to redirect cashiers to print receipts
  const handleInvoiceCreated = (invoiceId: string) => {
    setEditingInvoice(null);
    setActiveInvoiceId(invoiceId);
    setActiveTab("invoice-list");
  };

  const handleEditInvoice = (invoice: Invoice) => {
    setEditingInvoice(invoice);
    setActiveInvoiceId(null);
    setActiveTab("create-invoice");
  };

  const handleManualSwitchRole = (newRole: UserRole) => {
    if (!userProfile) return;
    const modifiedProfile: UserProfile = {
      ...userProfile,
      role: newRole,
      displayName: `Simulated ${newRole.charAt(0).toUpperCase() + newRole.slice(1)}`
    };
    setUserProfile(modifiedProfile);
    localStorage.setItem("beads_simulated_role", newRole);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-orange-50 bead-grid-pattern flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 font-mono text-xs text-stone-550 uppercase tracking-widest animate-pulse">
          Opening Beads shop system...
        </p>
      </div>
    );
  }

  // Login View Wrapper
  if (!userProfile) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] text-slate-900 flex flex-col antialiased">
      
      {/* 1. Header Toolbar Dashboard */}
      <header className="bg-white border-b border-slate-200 py-3.5 px-6 shrink-0 sticky top-0 z-40 shadow-xs">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-rose-500 rounded-xl flex items-center justify-center text-white font-display font-black text-sm shadow-sm">
              B
            </div>
            <div>
              <h1 className="font-display font-black text-sm tracking-tight text-slate-900 flex items-center gap-1">
                Beads Shop Portal
              </h1>
              <span className="text-[10px] text-slate-400 font-semibold font-mono uppercase tracking-wider block mt-0.5">
                Billing &amp; Stock Ledger
              </span>
            </div>
          </div>

          {/* User badge + testing bypass menu */}
          <div className="flex items-center gap-3.5">
            <div className="text-right hidden sm:block">
              <span className="font-semibold text-xs text-slate-800 block">{userProfile.displayName}</span>
              <span className="text-[9.5px] font-mono text-slate-500 uppercase tracking-widest font-extrabold flex items-center justify-end gap-1 mt-0.5">
                {userProfile.role === UserRole.SUPER_ADMIN ? (
                  <Crown className="w-3 h-3 text-amber-500 shrink-0" />
                ) : userProfile.role === UserRole.ADMIN ? (
                  <ShieldCheck className="w-3 h-3 text-emerald-500 shrink-0" />
                ) : (
                  <User className="w-3 h-3 text-slate-450 shrink-0" />
                )}
                {userProfile.role}
              </span>
            </div>

            {/* Simulated Live Role Switcher (extremely helpful for evaluating full layout) */}
            {canSimulateRoles && (
              <div className="bg-slate-100 border border-slate-200 rounded-xl p-1 flex items-center gap-0.5">
                <span className="text-[9px] font-bold text-slate-500 px-2 select-none hidden md:inline">Simulate Role:</span>
                {(["super_admin", "admin", "user"] as UserRole[]).map((role) => (
                  <button
                    key={role}
                    onClick={() => handleManualSwitchRole(role)}
                    className={`px-2 py-1 text-[9px] font-bold rounded-lg cursor-pointer transition-all ${
                      userProfile.role === role 
                        ? "bg-white text-slate-900 shadow-xs scale-105" 
                        : "text-slate-400 hover:text-slate-800"
                    }`}
                    title={`Test application features under ${role} privileges`}
                  >
                    {role === "super_admin" ? "S.Admin" : role === "admin" ? "Admin" : "Cashier"}
                  </button>
                ))}
              </div>
            )}

            {/* Logout Trigger */}
            <button
              onClick={handleLogout}
              className="p-1.5 hover:bg-slate-100 border border-slate-200 text-slate-450 hover:text-slate-900 rounded-xl transition-all cursor-pointer"
              title="Sign out of system"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* 2. Main Tabbed Layout structure */}
      <div className="flex-1 flex flex-col md:flex-row w-full p-4 md:p-6 gap-6 items-stretch">
        
        {/* Navigation Sidebar */}
        <aside className="w-full md:w-56 shrink-0 flex flex-row md:flex-col gap-1.5 bg-[#18181b] border border-zinc-850 text-white rounded-3xl p-4 md:h-fit self-start overflow-x-auto select-none shadow-sm">
          <button
            onClick={() => { setActiveTab("inventory"); setActiveInvoiceId(null); }}
            className={`w-full py-2.5 px-4 rounded-xl text-left text-xs font-bold font-display flex items-center gap-2.5 cursor-pointer leading-none transition-all ${
              activeTab === "inventory" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <Layers className="w-4 h-4 shrink-0" />
            Stock Inventory
          </button>

          <button
            onClick={() => { setActiveTab("create-invoice"); setActiveInvoiceId(null); }}
            className={`w-full py-2.5 px-4 rounded-xl text-left text-xs font-bold font-display flex items-center gap-2.5 cursor-pointer leading-none transition-all ${
              activeTab === "create-invoice" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <PlusCircle className="w-4 h-4 shrink-0" />
            Create Invoice
          </button>

          <button
            onClick={() => { setActiveTab("invoice-list"); }}
            className={`w-full py-2.5 px-4 rounded-xl text-left text-xs font-bold font-display flex items-center gap-2.5 cursor-pointer leading-none transition-all ${
              activeTab === "invoice-list" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <FileText className="w-4 h-4 shrink-0" />
            Invoices Ledger
          </button>

          <button
            onClick={() => { setActiveTab("customers"); setActiveInvoiceId(null); }}
            className={`w-full py-2.5 px-4 rounded-xl text-left text-xs font-bold font-display flex items-center gap-2.5 cursor-pointer leading-none transition-all ${
              activeTab === "customers" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            Customers &amp; Leaders
          </button>

          <button
            onClick={() => { setActiveTab("settings"); setActiveInvoiceId(null); }}
            className={`w-full py-2.5 px-4 rounded-xl text-left text-xs font-bold font-display flex items-center gap-2.5 cursor-pointer leading-none transition-all ${
              activeTab === "settings" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <SettingsIcon className="w-4 h-4 shrink-0" />
            Shop Settings
          </button>
        </aside>

        {/* Dynamic Tab Panel Render block */}
        <main className="flex-1 min-w-0 bg-transparent">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab + (activeInvoiceId || "")}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              {activeTab === "inventory" && (
                <Inventory userProfile={userProfile} />
              )}
              
              {activeTab === "create-invoice" && (
                <Invoicing 
                  userProfile={userProfile} 
                  onInvoiceCreated={handleInvoiceCreated} 
                  editingInvoice={editingInvoice}
                  onCancelEdit={() => {
                    setEditingInvoice(null);
                    setActiveTab("invoice-list");
                  }}
                />
              )}
              
              {activeTab === "invoice-list" && (
                activeInvoiceId ? (
                  <InvoiceReceipt 
                    invoiceId={activeInvoiceId} 
                    onGoBack={() => setActiveInvoiceId(null)} 
                  />
                ) : (
                  <InvoiceList 
                    userProfile={userProfile} 
                    onSelectInvoice={(id) => setActiveInvoiceId(id)} 
                    onEditInvoice={handleEditInvoice}
                  />
                )
              )}
              
              {activeTab === "settings" && (
                <Settings userProfile={userProfile} />
              )}

              {activeTab === "customers" && (
                <Customers userProfile={userProfile} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Decorative footer details */}
      <footer className="bg-white border-t border-slate-200 py-4 px-6 shrink-0 select-none text-center text-[10.5px] font-mono text-slate-400">
        <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <span>📅 Shop local time: 2026-06-15</span>
          <span className="uppercase tracking-widest font-semibold flex items-center gap-1.5 text-[9.5px]">
            <Sparkles className="w-3.5 h-3.5 text-[#f43f5e]" />
            Dazzling Beads Shop Workspace • Secure cloud synced
          </span>
        </div>
      </footer>
    </div>
  );
}
