/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp, query, orderBy, getDocs } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { Customer, Invoice, UserProfile, UserRole, PaymentStatus } from "../types";
import { 
  Users, 
  Plus, 
  Search, 
  Edit3, 
  Trash2, 
  UserPlus, 
  Phone, 
  Mail, 
  Award, 
  TrendingUp, 
  FileText, 
  Tag, 
  Bookmark, 
  Calendar, 
  DollarSign, 
  UserCheck, 
  X, 
  Check, 
  ChevronRight,
  Sparkles,
  ArrowUpDown,
  AlertTriangle
} from "lucide-react";

interface CustomersProps {
  userProfile: UserProfile;
}

export default function Customers({ userProfile }: CustomersProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTier, setSelectedTier] = useState<string>("All");
  const [sortBy, setSortBy] = useState<"spend" | "orders" | "name">("spend");

  // Form states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [facebookName, setFacebookName] = useState("");
  const [tier, setTier] = useState<"Standard" | "VIP" | "Platinum" | "Wholesaler">("Standard");
  const [notes, setNotes] = useState("");

  // Customer Detail Panel
  const [selectedCustomerDetail, setSelectedCustomerDetail] = useState<Customer | null>(null);

  // Dialog confirmation states (to avoid native blocked alerts/confirms in iframe sandboxes)
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm?: () => void;
    isConfirm: boolean;
  } | null>(null);

  const showAlert = (title: string, message: string) => {
    setDialog({ isOpen: true, title, message, isConfirm: false });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setDialog({ isOpen: true, title, message, onConfirm, isConfirm: true });
  };

  const hasWriteAccess = userProfile.role === UserRole.SUPER_ADMIN || userProfile.role === UserRole.ADMIN;

  // Sync Customers & Invoices
  useEffect(() => {
    setLoading(true);
    
    // Subscribe to Customers
    const qCustomers = query(collection(db, "customers"), orderBy("name", "asc"));
    const unsubCustomers = onSnapshot(
      qCustomers,
      (snapshot) => {
        const customerList: Customer[] = [];
        snapshot.forEach((doc) => {
          customerList.push({ id: doc.id, ...doc.data() } as Customer);
        });
        setCustomers(customerList);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        try {
          handleFirestoreError(err, OperationType.GET, "customers");
        } catch (wrappedError: any) {
          setError(wrappedError.message);
        }
      }
    );

    // Subscribe to Invoices
    const qInvoices = query(collection(db, "invoices"), orderBy("createdAt", "desc"));
    const unsubInvoices = onSnapshot(
      qInvoices,
      (snapshot) => {
        const invoiceList: Invoice[] = [];
        snapshot.forEach((doc) => {
          invoiceList.push({ id: doc.id, ...doc.data() } as Invoice);
        });
        setInvoices(invoiceList);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.GET, "invoices");
        } catch (wrappedError: any) {
          console.error("Non-blocking invoices load warning:", wrappedError.message);
        }
      }
    );

    return () => {
      unsubCustomers();
      unsubInvoices();
    };
  }, []);

  // Helper function to link customer and calculate dynamic spend metrics
  const getCustomerMetrics = (cust: Customer) => {
    // Match customer invoices by phone, email, or exact name
    const customerInvoices = invoices.filter((inv) => {
      const matchEmail = cust.email && inv.customerEmail && cust.email.toLowerCase().trim() === inv.customerEmail.toLowerCase().trim();
      const matchPhone = cust.phone && inv.customerPhone && cust.phone.replace(/\D/g, '') === inv.customerPhone.replace(/\D/g, '');
      const matchName = cust.name && inv.customerName && cust.name.toLowerCase().trim() === inv.customerName.toLowerCase().trim();
      return matchEmail || matchPhone || matchName;
    });

    const paidInvoices = customerInvoices.filter((inv) => inv.paymentStatus === PaymentStatus.PAID);
    const totalSpent = paidInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const invoiceCount = customerInvoices.length;
    const avgSpent = invoiceCount > 0 ? totalSpent / invoiceCount : 0;

    return {
      totalSpent,
      invoiceCount,
      avgSpent,
      history: customerInvoices,
      paidInvoiceCount: paidInvoices.length,
    };
  };

  const resetForm = () => {
    setEditingCustomer(null);
    setName("");
    setEmail("");
    setPhone("");
    setFacebookName("");
    setTier("Standard");
    setNotes("");
  };

  const handleOpenNew = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const handleOpenEdit = (cust: Customer) => {
    setEditingCustomer(cust);
    setName(cust.name);
    setEmail(cust.email || "");
    setPhone(cust.phone || "");
    setFacebookName(cust.facebookName || "");
    setTier(cust.tier || "Standard");
    setNotes(cust.notes || "");
    setIsFormOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showAlert("Required Field", "Customer Name is required.");
      return;
    }

    setLoading(true);
    setError(null);

    const docId = editingCustomer?.id || `cust_${Date.now()}`;
    const payload = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      facebookName: facebookName.trim(),
      tier: tier,
      notes: notes.trim(),
      createdAt: editingCustomer?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, "customers", docId), payload);
      setIsFormOpen(false);
      resetForm();
    } catch (err: any) {
      console.error(err);
      try {
        handleFirestoreError(err, OperationType.WRITE, `customers/${docId}`);
      } catch (wrappedError: any) {
        setError(wrappedError.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCustomer = (cust: Customer) => {
    if (!cust.id) return;
    showConfirm(
      "Remove Customer",
      `Are you absolutely sure you want to delete ${cust.name}? This will remove them from the directory.`,
      async () => {
        setLoading(true);
        try {
          await deleteDoc(doc(db, "customers", cust.id!));
          if (selectedCustomerDetail?.id === cust.id) {
            setSelectedCustomerDetail(null);
          }
        } catch (err: any) {
          console.error(err);
          try {
            handleFirestoreError(err, OperationType.DELETE, `customers/${cust.id}`);
          } catch (wrappedError: any) {
            setError(wrappedError.message);
          }
        } finally {
          setLoading(false);
        }
      }
    );
  };

  // Compile Customer Records combined with dynamic spending
  const compiledCustomers = customers.map((c) => {
    const metrics = getCustomerMetrics(c);
    return {
      ...c,
      metrics
    };
  });

  // Global Aggregate Stats
  const totalPaidRevenue = invoices.filter(i => i.paymentStatus === PaymentStatus.PAID).reduce((sum, i) => sum + i.totalAmount, 0);
  const totalCustomersCount = compiledCustomers.length;
  
  // Find highest spender
  const topSpenderObj = compiledCustomers.length > 0 
    ? [...compiledCustomers].sort((a, b) => b.metrics.totalSpent - a.metrics.totalSpent)[0] 
    : null;

  // Filter and Sort compiled list
  const filteredCustomers = compiledCustomers
    .filter((c) => {
      const matchSearch = 
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.phone.includes(searchQuery) ||
        (c.notes && c.notes.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchTier = selectedTier === "All" || c.tier === selectedTier;

      return matchSearch && matchTier;
    })
    .sort((a, b) => {
      if (sortBy === "spend") {
        return b.metrics.totalSpent - a.metrics.totalSpent;
      }
      if (sortBy === "orders") {
        return b.metrics.invoiceCount - a.metrics.invoiceCount;
      }
      return a.name.localeCompare(b.name);
    });

  const getTierClass = (ctier: string) => {
    switch (ctier) {
      case "VIP":
        return "bg-amber-100 text-amber-800 border-amber-250 font-bold";
      case "Platinum":
        return "bg-rose-100 text-rose-800 border-rose-250 font-bold";
      case "Wholesaler":
        return "bg-emerald-100 text-emerald-800 border-emerald-250 font-bold";
      default:
        return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  return (
    <div className="w-full">
      {/* Page Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-black text-slate-905 flex items-center gap-2">
            <Users className="w-5.5 h-5.5 text-[#f43f5e]" />
            Customer Directory &amp; Spend Leaders
          </h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Identify your VIP purchasers, register repeat beads clients, and drill down into their purchase histories.
          </p>
        </div>

        {hasWriteAccess && (
          <button
            onClick={handleOpenNew}
            className="py-2.5 px-5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition-all duration-155 cursor-pointer self-start sm:self-center"
          >
            <UserPlus className="w-4 h-4" />
            Add Customer
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-rose-50 border border-rose-200 p-4 text-xs font-mono rounded-2xl text-rose-700">
          ⚠️ {error}
        </div>
      )}

      {/* Aggregate Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 bg-rose-50 border border-rose-100 rounded-2xl flex items-center justify-center text-rose-600 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-mono text-slate-400 font-extrabold uppercase tracking-wider block">Total Members</span>
            <span className="text-2xl font-display font-black text-slate-900 leading-none block mt-1">{totalCustomersCount}</span>
            <span className="text-[10px] text-slate-450 block mt-1">leads registered in portal</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-50 border border-amber-100 rounded-2xl flex items-center justify-center text-amber-600 shrink-0">
            <Award className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-mono text-amber-650 font-extrabold uppercase tracking-wider block">Top Spender 👑</span>
            <span className="text-sm font-bold text-slate-900 truncate mt-1 block">
              {topSpenderObj ? topSpenderObj.name : "N/A"}
            </span>
            <span className="text-[11px] text-amber-700 font-bold font-mono mt-0.5 block">
              ₱{topSpenderObj ? topSpenderObj.metrics.totalSpent.toFixed(2) : "0.00"}
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600 shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-mono text-slate-400 font-extrabold uppercase tracking-wider block">Avg Customer Spend</span>
            <span className="text-2xl font-display font-black text-slate-900 leading-none block mt-1">
              ₱{totalCustomersCount > 0 ? (totalPaidRevenue / totalCustomersCount).toFixed(2) : "0.00"}
            </span>
            <span className="text-[10px] text-slate-450 block mt-1">lifetime average per head</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center text-slate-600 shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-mono text-slate-400 font-extrabold uppercase tracking-wider block">Loyalty VIP / Plat Ratio</span>
            <span className="text-2xl font-display font-black text-slate-900 leading-none block mt-1">
              {customers.filter(c => c.tier === "VIP" || c.tier === "Platinum").length}
              <span className="text-xs font-semibold text-slate-400 font-mono"> / {totalCustomersCount}</span>
            </span>
            <span className="text-[10px] text-slate-450 block mt-1">exclusive client tiers</span>
          </div>
        </div>
      </div>

      {/* Main List & Controls Container */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-xs overflow-hidden">
        
        {/* Directory Controls Filter Bar */}
        <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex flex-col md:flex-row items-center justify-between gap-4">
          
          {/* Left search */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search clients by name, phone, notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 outline-none text-slate-800 rounded-xl text-xs leading-relaxed focus:border-rose-450 transition-colors"
            />
          </div>

          {/* Right tier controls and sort triggers */}
          <div className="w-full md:w-auto flex flex-wrap items-center gap-2.5 justify-end">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Tier:</span>
              <select
                value={selectedTier}
                onChange={(e) => setSelectedTier(e.target.value)}
                className="bg-white border border-slate-200 px-3 py-1.5 text-stone-800 font-medium rounded-xl text-xs outline-none focus:border-rose-450"
              >
                <option value="All">All Tiers</option>
                <option value="Standard">Standard</option>
                <option value="VIP">VIP</option>
                <option value="Platinum">Platinum</option>
                <option value="Wholesaler">Wholesaler</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Rank:</span>
              <div className="bg-white border border-slate-200 p-1 rounded-xl flex items-center">
                <button
                  onClick={() => setSortBy("spend")}
                  className={`px-3 py-1 text-[10.5px] font-bold rounded-lg transition-all cursor-pointer ${
                    sortBy === "spend" ? "bg-slate-900 text-white" : "text-slate-400 hover:text-slate-700"
                  }`}
                  title="Rank by highest accumulated spend"
                >
                  Spend 💰
                </button>
                <button
                  onClick={() => setSortBy("orders")}
                  className={`px-3 py-1 text-[10.5px] font-bold rounded-lg transition-all cursor-pointer ${
                    sortBy === "orders" ? "bg-slate-900 text-white" : "text-slate-400 hover:text-slate-700"
                  }`}
                  title="Rank by number of paid invoices"
                >
                  Orders 📦
                </button>
                <button
                  onClick={() => setSortBy("name")}
                  className={`px-3 py-1 text-[10.5px] font-bold rounded-lg transition-all cursor-pointer ${
                    sortBy === "name" ? "bg-slate-900 text-white" : "text-slate-400 hover:text-slate-700"
                  }`}
                  title="Sort alphabetically by client name"
                >
                  Name
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="overflow-x-auto">
          {filteredCustomers.length === 0 ? (
            <div className="text-center py-20 text-slate-400 text-xs">
              No clients found matching the selected parameters. <br /> Create first Customer record now!
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-150 text-[10px] font-bold text-slate-450 uppercase font-mono tracking-widest">
                  <th className="py-3 px-6">Client Details</th>
                  <th className="py-3 px-6">Loyalty Class</th>
                  <th className="py-3 px-6">Orders Count</th>
                  <th className="py-3 px-6 text-right">Accumulated Spend</th>
                  <th className="py-3 px-6 text-right">Avg Order Price</th>
                  <th className="py-3 px-6 text-center">History</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredCustomers.map((cust, idx) => (
                  <tr key={cust.id} className="hover:bg-slate-50/85 transition-colors">
                    {/* Basic details */}
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-rose-450 to-orange-400 flex items-center justify-center text-white font-bold font-display select-none">
                          {cust.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                            {cust.name}
                            {idx === 0 && sortBy === "spend" && (
                              <span className="text-[10px] bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.2 rounded-md font-mono font-bold uppercase tracking-wider animate-bounce">
                                #1 Buyer 👑
                              </span>
                            )}
                          </div>
                          
                          <div className="flex flex-col gap-0.5 mt-1 font-mono text-[10px] text-slate-450 font-semibold">
                            {cust.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" /> {cust.phone}</span>}
                            {cust.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3 shrink-0" /> {cust.email}</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Tier Badge */}
                    <td className="py-4 px-6 shrink-0">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 border rounded-lg text-[10.5px] uppercase font-mono ${getTierClass(cust.tier)}`}>
                        <Tag className="w-3 h-3" />
                        {cust.tier}
                      </span>
                    </td>

                    {/* Total orders */}
                    <td className="py-4 px-6 font-mono font-bold text-slate-700">
                      {cust.metrics.invoiceCount} invoices
                    </td>

                    {/* Total Spend */}
                    <td className="py-4 px-6 text-right font-mono font-extrabold text-slate-900 text-sm">
                      ₱{cust.metrics.totalSpent.toFixed(2)}
                    </td>

                    {/* Average item spend */}
                    <td className="py-4 px-6 text-right font-mono text-slate-500 font-semibold">
                      ₱{cust.metrics.avgSpent.toFixed(2)}
                    </td>

                    {/* Drill down history trigger */}
                    <td className="py-4 px-6 text-center">
                      <button
                        onClick={() => setSelectedCustomerDetail(cust)}
                        type="button"
                        className="py-1 px-2.5 bg-slate-100 hover:bg-slate-205 border border-slate-200 text-slate-700 text-[10.5px] font-semibold rounded-lg flex items-center justify-center gap-1 mx-auto cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-450" />
                        Ledger
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-6 text-right">
                      {hasWriteAccess ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenEdit(cust)}
                            className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all cursor-pointer"
                            title="Edit customer variables"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteCustomer(cust)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                            title="Remove customer from records"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-zinc-400 italic">No access</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail Slide/Sheet modal: Invoice Purchase History */}
      {selectedCustomerDetail && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-end z-[100] p-0 md:p-4">
          <div className="w-full max-w-xl h-full md:h-[95vh] bg-white rounded-none md:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-slide-in relative border border-slate-200">
            {/* Header */}
            <div className="p-5 border-b border-slate-150 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white font-black text-lg select-none">
                  {selectedCustomerDetail.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-display font-black text-slate-900 text-base">{selectedCustomerDetail.name}</h3>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.2 rounded-md text-[9.5px] uppercase font-mono font-bold shrink-0 mt-0.5 border ${getTierClass(selectedCustomerDetail.tier)}`}>
                    {selectedCustomerDetail.tier} Member
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedCustomerDetail(null)}
                className="p-1.5 hover:bg-slate-200 rounded-xl border border-slate-250 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Metrics Breakdown */}
            <div className="p-5 border-b border-slate-100 bg-slate-50/50">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-white border border-slate-200 p-3 rounded-2xl">
                  <span className="text-[9.5px] font-mono text-slate-400 font-extrabold uppercase tracking-wide">Lifetime Spent</span>
                  <p className="text-base font-bold text-slate-900 mt-1">
                    ₱{getCustomerMetrics(selectedCustomerDetail).totalSpent.toFixed(2)}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 p-3 rounded-2xl">
                  <span className="text-[9.5px] font-mono text-slate-400 font-extrabold uppercase tracking-wide">Orders Count</span>
                  <p className="text-base font-bold text-slate-900 mt-1">
                    {getCustomerMetrics(selectedCustomerDetail).invoiceCount} Paid
                  </p>
                </div>
                <div className="bg-white border border-slate-200 p-3 rounded-2xl">
                  <span className="text-[9.5px] font-mono text-slate-400 font-extrabold uppercase tracking-wide">Avg Ticket Size</span>
                  <p className="text-base font-bold text-slate-900 mt-1">
                    ₱{getCustomerMetrics(selectedCustomerDetail).avgSpent.toFixed(2)}
                  </p>
                </div>
              </div>

              {selectedCustomerDetail.notes && (
                <div className="bg-rose-50/40 border border-rose-100 p-3 rounded-2xl mt-4">
                  <span className="text-[9.5px] font-bold text-[#f43f5e] uppercase tracking-wide font-mono block mb-1">
                    📖 Client Preferences &amp; Notes:
                  </span>
                  <p className="text-slate-650 leading-relaxed text-[11.5px] whitespace-pre-line font-medium">
                    "{selectedCustomerDetail.notes}"
                  </p>
                </div>
              )}
            </div>

            {/* Ledger Transactions items list */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <h4 className="font-display font-extrabold text-[11px] text-slate-450 uppercase tracking-widest font-mono">
                📜 Customer Receipts History ({getCustomerMetrics(selectedCustomerDetail).history.length})
              </h4>

              {getCustomerMetrics(selectedCustomerDetail).history.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs font-mono">
                  There are no paid orders linked directly to this customer email/phone yet.
                </div>
              ) : (
                getCustomerMetrics(selectedCustomerDetail).history.map((inv) => (
                  <div 
                    key={inv.id} 
                    className="border border-slate-205 rounded-2xl p-4 hover:border-slate-350 transition-all text-xs"
                  >
                    <div className="flex justify-between items-start mb-2.5">
                      <div>
                        <span className="font-mono font-bold text-slate-900 text-sm block">Invoice #{inv.invoiceNumber}</span>
                        <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">
                          Paid on {new Date(inv.createdAt?.seconds * 1000 || Date.now()).toLocaleDateString("en-US", { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <span className="text-sm font-extrabold text-slate-900 font-mono">
                        ₱{inv.totalAmount.toFixed(2)}
                      </span>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-2.5 text-[11px] border border-slate-100 flex flex-wrap gap-1.5">
                      {inv.items.map((line, idx) => (
                        <span key={idx} className="bg-white border border-slate-200 px-2.5 py-1 rounded-lg font-medium text-slate-700">
                          {line.quantity}x {line.name} (₱{line.price.toFixed(2)})
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Form Modal Dialog */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center z-[110] p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl relative">
            <button
              onClick={() => setIsFormOpen(false)}
              className="p-1.5 hover:bg-slate-100 rounded-xl border border-slate-200 text-zinc-400 hover:text-slate-800 absolute top-5 right-5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="font-display font-black text-slate-900 text-base mb-1">
              {editingCustomer ? "Edit Customer Details" : "Register Loyalty Customer"}
            </h3>
            <p className="text-slate-500 text-[11px] mb-5">
              Set up repeat buyer contact attributes to dynamically map them in checkout invoicing automatically.
            </p>

            <form onSubmit={handleSaveCustomer} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-455 uppercase tracking-wider mb-1">Customer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Maria Clara"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:bg-white focus:border-rose-455 transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-455 uppercase tracking-wider mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="clara@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:bg-white focus:border-rose-455 transition-all font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-455 uppercase tracking-wider mb-1">Contact Phone</label>
                  <input
                    type="tel"
                    placeholder="0917-XXX-XXXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:bg-white focus:border-rose-455 transition-all font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-455 uppercase tracking-wider mb-1">FB / IG Name</label>
                <input
                  type="text"
                  placeholder="Facebook or Instagram profile name"
                  value={facebookName}
                  onChange={(e) => setFacebookName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:bg-white focus:border-rose-455 transition-all"
                />
                <p className="mt-1 text-[9px] text-slate-400">Automatically attached when this customer is selected during checkout.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-455 uppercase tracking-wider mb-1">Loyalty Tier Status</label>
                <div className="grid grid-cols-4 gap-2">
                  {["Standard", "VIP", "Platinum", "Wholesaler"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTier(t as any)}
                      className={`py-2 px-1 border rounded-xl text-[10.5px] font-bold cursor-pointer transition-all ${
                        tier === t
                          ? "bg-slate-900 border-slate-950 text-white shadow-xs"
                          : "bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-455 uppercase tracking-wider mb-1">Preferences &amp; Custom Notes</label>
                <textarea
                  placeholder="Notes about specific bead styles, bulk preferences, or custom requests..."
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:bg-white focus:border-rose-455 transition-all resize-none"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3.5">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3 bg-[#f43f5e] hover:bg-rose-600 text-white font-bold text-xs rounded-xl uppercase tracking-wider shadow-md transition-colors cursor-pointer"
                >
                  {loading ? "Saving..." : "Save Record"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Alert/Confirm Dialog Modal */}
      {dialog && dialog.isOpen && (
        <div className="fixed inset-0 bg-slate-950/55 backdrop-blur-xs flex items-center justify-center z-[130] p-4 select-none">
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${dialog.isConfirm ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-600'}`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="font-display font-black text-slate-900 text-sm">{dialog.title}</h3>
            </div>
            <p className="text-slate-600 text-xs leading-relaxed mb-6 font-medium">
              {dialog.message}
            </p>
            <div className="flex gap-3">
              {dialog.isConfirm ? (
                <>
                  <button
                    onClick={() => setDialog(null)}
                    type="button"
                    className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-[11px] rounded-xl uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (dialog.onConfirm) dialog.onConfirm();
                      setDialog(null);
                    }}
                    type="button"
                    className="flex-1 py-2.5 bg-[#f43f5e] hover:bg-rose-600 text-white font-bold text-[11px] rounded-xl uppercase tracking-wider shadow-md transition-colors cursor-pointer"
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setDialog(null)}
                  type="button"
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] rounded-xl uppercase tracking-wider transition-colors cursor-pointer"
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
