/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, deleteDoc, updateDoc, query, orderBy, serverTimestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { Invoice, PaymentStatus, ShippingStatus, InvoiceStatus, UserRole, UserProfile } from "../types";
import { calculateMeasuredLineTotal, formatMeasuredQuantity, formatSellingMeasure } from "../lib/units";
import { Search, Trash2, Eye, AlertTriangle, CheckCircle, Clock, XCircle, FileText, Pencil, Save, X } from "lucide-react";

interface InvoiceListProps {
  userProfile: UserProfile;
  onSelectInvoice: (invoiceId: string) => void;
  onEditInvoice: (invoice: Invoice) => void;
}

type DateRangeFilter = "All" | "Today" | "Yesterday" | "Week" | "Month" | "Custom";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const getInvoiceDate = (invoice: Invoice) => invoice.createdAt?.toDate ? invoice.createdAt.toDate() : new Date();

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateInput = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const endOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};

const getDaysUnpaid = (invoice: Invoice) => {
  const due = invoice.totalAmount + (invoice.previousBalance || 0);
  const paid = invoice.amountPaid ?? (invoice.paymentStatus === PaymentStatus.PAID ? due : 0);
  const hasBalance = invoice.paymentStatus !== PaymentStatus.CANCELLED && Math.max(0, due - paid) > 0;

  if (!hasBalance) return 0;
  return Math.max(0, Math.floor((startOfDay(new Date()).getTime() - startOfDay(getInvoiceDate(invoice)).getTime()) / MS_PER_DAY));
};

const getAgingRowClass = (daysUnpaid: number) => {
  if (daysUnpaid >= 30) return "bg-red-100 hover:bg-red-200/80 border-red-200";
  if (daysUnpaid >= 21) return "bg-orange-200 hover:bg-orange-300/80 border-orange-300";
  if (daysUnpaid >= 14) return "bg-orange-100 hover:bg-orange-200/80 border-orange-200";
  if (daysUnpaid >= 7) return "bg-yellow-100 hover:bg-yellow-200/80 border-yellow-200";
  return "";
};

const daysUnpaidRanges = [
  { value: "All", label: "All balances", min: null, max: null },
  { value: "7-13", label: "7-13 days unpaid", min: 7, max: 13 },
  { value: "14-20", label: "14-20 days unpaid", min: 14, max: 20 },
  { value: "21-29", label: "21-29 days unpaid", min: 21, max: 29 },
  { value: "30+", label: "30+ days unpaid", min: 30, max: null },
];

export default function InvoiceList({ userProfile, onSelectInvoice, onEditInvoice }: InvoiceListProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [shippingFilter, setShippingFilter] = useState("All");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("All");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("All");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [daysUnpaidFilter, setDaysUnpaidFilter] = useState("All");
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Dialog confirmation states
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

  const isAdminOrSuper = userProfile.role === UserRole.SUPER_ADMIN || userProfile.role === UserRole.ADMIN;

  const openInvoiceEditor = (invoice: Invoice) => {
    if (!isAdminOrSuper) {
      showAlert("Privilege Restriction", "Only Super Admins and Admins can edit invoice records.");
      return;
    }
    setEditingInvoice({ ...invoice });
  };

  const handleSaveInvoiceEdit = async () => {
    if (!editingInvoice?.id || !isAdminOrSuper) return;
    if (!editingInvoice.customerName.trim()) {
      showAlert("Customer Required", "Please enter a customer name.");
      return;
    }

    setSavingEdit(true);
    try {
      await updateDoc(doc(db, "invoices", editingInvoice.id), {
        customerName: editingInvoice.customerName.trim(),
        customerPhone: editingInvoice.customerPhone?.trim() || "",
        customerEmail: editingInvoice.customerEmail?.trim() || "",
        customerFacebookName: editingInvoice.customerFacebookName?.trim() || "",
        amountPaid: editingInvoice.amountPaid || 0,
        previousBalance: editingInvoice.previousBalance || 0,
        description: editingInvoice.description?.trim() || "",
        shippingStatus: editingInvoice.shippingStatus || ShippingStatus.PENDING,
        paymentStatus: editingInvoice.paymentStatus,
        invoiceStatus: editingInvoice.invoiceStatus || InvoiceStatus.PENDING,
        updatedAt: serverTimestamp(),
      });
      setEditingInvoice(null);
    } catch (err: any) {
      setError(err.message || "Failed to update invoice.");
    } finally {
      setSavingEdit(false);
    }
  };

  // Real-time Firestore Sync
  useEffect(() => {
    const q = query(collection(db, "invoices"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const invoiceData: Invoice[] = [];
        snapshot.forEach((doc) => {
          invoiceData.push({ id: doc.id, ...doc.data() } as Invoice);
        });
        setInvoices(invoiceData);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        try {
          handleFirestoreError(err, OperationType.GET, "invoices");
        } catch (wrappedError: any) {
          setError(wrappedError.message);
        }
      }
    );

    return () => unsubscribe();
  }, []);

  const handleDeleteInvoice = (e: React.MouseEvent, invoiceId: string | undefined) => {
    e.stopPropagation();
    if (!invoiceId) return;

    if (!isAdminOrSuper) {
      showAlert("Privilege Restriction", "Unauthorized. Deletes are restricted to Store Admins.");
      return;
    }

    showConfirm(
      "Confirm Delete",
      "Are you sure you want to permanently delete this invoice record from the database? This cannot be undone.",
      async () => {
        try {
          await deleteDoc(doc(db, "invoices", invoiceId));
        } catch (err: any) {
          setError(err.message || "Failed to delete record.");
        }
      }
    );
  };

  const handleUpdatePaymentStatus = async (e: React.MouseEvent, invoice: Invoice, newStatus: PaymentStatus) => {
    e.stopPropagation();
    if (!invoice.id) return;

    if (!isAdminOrSuper) {
      showAlert("Privilege Restriction", "Only Super Admins and Admins can edit invoice records.");
      return;
    }

    try {
      const nextAmountPaid =
        newStatus === PaymentStatus.UNPAID
          ? 0
          : newStatus === PaymentStatus.PAID
            ? invoice.totalAmount + (invoice.previousBalance || 0)
            : newStatus === PaymentStatus.PARTIALLY_PAID
              ? ((invoice.amountPaid || 0) > 0 && (invoice.amountPaid || 0) < invoice.totalAmount + (invoice.previousBalance || 0)
                  ? invoice.amountPaid
                  : (invoice.totalAmount + (invoice.previousBalance || 0)) / 2)
              : invoice.amountPaid || 0;
      const invoiceRef = doc(db, "invoices", invoice.id);
      await updateDoc(invoiceRef, {
        paymentStatus: newStatus,
        amountPaid: nextAmountPaid,
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      setError(err.message || "Failed to update payment status.");
    }
  };

  const handleUpdatePaymentStatusDirect = async (e: React.ChangeEvent<HTMLSelectElement>, invoice: Invoice, newStatus: PaymentStatus) => {
    e.stopPropagation();
    if (!invoice.id) return;

    if (!isAdminOrSuper) {
      showAlert("Privilege Restriction", "Only Super Admins and Admins can edit invoice records.");
      return;
    }

    try {
      const nextAmountPaid =
        newStatus === PaymentStatus.UNPAID
          ? 0
          : newStatus === PaymentStatus.PAID
            ? invoice.totalAmount + (invoice.previousBalance || 0)
            : newStatus === PaymentStatus.PARTIALLY_PAID
              ? ((invoice.amountPaid || 0) > 0 && (invoice.amountPaid || 0) < invoice.totalAmount + (invoice.previousBalance || 0)
                  ? invoice.amountPaid
                  : (invoice.totalAmount + (invoice.previousBalance || 0)) / 2)
              : invoice.amountPaid || 0;
      const invoiceRef = doc(db, "invoices", invoice.id);
      await updateDoc(invoiceRef, {
        paymentStatus: newStatus,
        amountPaid: nextAmountPaid,
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      setError(err.message || "Failed to update payment status.");
    }
  };

  const handleUpdateShippingStatus = async (e: React.ChangeEvent<HTMLSelectElement>, invoice: Invoice, newStatus: ShippingStatus) => {
    e.stopPropagation();
    if (!invoice.id) return;
    if (!isAdminOrSuper) {
      showAlert("Privilege Restriction", "Only Super Admins and Admins can edit invoice records.");
      return;
    }
    try {
      const invoiceRef = doc(db, "invoices", invoice.id);
      await updateDoc(invoiceRef, {
        shippingStatus: newStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      setError(err.message || "Failed to update shipping status.");
    }
  };

  const handleUpdateInvoiceStatus = async (e: React.ChangeEvent<HTMLSelectElement>, invoice: Invoice, newStatus: InvoiceStatus) => {
    e.stopPropagation();
    if (!invoice.id) return;
    if (!isAdminOrSuper) {
      showAlert("Privilege Restriction", "Only Super Admins and Admins can edit invoice records.");
      return;
    }
    try {
      const invoiceRef = doc(db, "invoices", invoice.id);
      await updateDoc(invoiceRef, {
        invoiceStatus: newStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      setError(err.message || "Failed to update invoice status.");
    }
  };

  const getActiveDateRange = () => {
    const today = new Date();
    if (dateRangeFilter === "Today") {
      return { start: startOfDay(today), end: endOfDay(today) };
    }
    if (dateRangeFilter === "Yesterday") {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
    }
    if (dateRangeFilter === "Week") {
      const start = startOfDay(today);
      start.setDate(today.getDate() - 6);
      return { start, end: endOfDay(today) };
    }
    if (dateRangeFilter === "Month") {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: startOfDay(start), end: endOfDay(today) };
    }
    if (dateRangeFilter === "Custom" && (customStartDate || customEndDate)) {
      return {
        start: customStartDate ? startOfDay(parseDateInput(customStartDate)) : null,
        end: customEndDate ? endOfDay(parseDateInput(customEndDate)) : null,
      };
    }
    return { start: null, end: null };
  };

  // Filter List of Invoices
  const filteredInvoices = invoices.filter((inv) => {
    const invoiceDate = getInvoiceDate(inv);
    const { start, end } = getActiveDateRange();
    const daysUnpaid = getDaysUnpaid(inv);
    const matchesSearch =
      inv.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (inv.createdByEmail && inv.createdByEmail.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === "All" || inv.paymentStatus === statusFilter;
    const matchesShipping = shippingFilter === "All" || (inv.shippingStatus || ShippingStatus.PENDING) === shippingFilter;
    const matchesInvoiceStatus = invoiceStatusFilter === "All" || (inv.invoiceStatus || InvoiceStatus.PENDING) === invoiceStatusFilter;
    const matchesDateRange = (!start || invoiceDate >= start) && (!end || invoiceDate <= end);
    const unpaidRange = daysUnpaidRanges.find((range) => range.value === daysUnpaidFilter);
    const matchesDaysUnpaid =
      !unpaidRange ||
      unpaidRange.value === "All" ||
      ((unpaidRange.min === null || daysUnpaid >= unpaidRange.min) && (unpaidRange.max === null || daysUnpaid <= unpaidRange.max));

    return matchesSearch && matchesStatus && matchesShipping && matchesInvoiceStatus && matchesDateRange && matchesDaysUnpaid;
  });

  const financialSummary = filteredInvoices.reduce(
    (summary, invoice) => {
      if (invoice.paymentStatus === PaymentStatus.CANCELLED) return summary;
      const paid = invoice.amountPaid ?? (invoice.paymentStatus === PaymentStatus.PAID ? invoice.totalAmount + (invoice.previousBalance || 0) : 0);
      const due = invoice.totalAmount + (invoice.previousBalance || 0);
      const balance = Math.max(0, due - paid);

      summary.downpayments += Math.max(0, paid);
      summary.unpaidBalance += balance;
      if (invoice.paymentStatus === PaymentStatus.PAID) {
        if (invoice.shippingStatus === ShippingStatus.DELIVERED || invoice.shippingStatus === ShippingStatus.SHIPPED) {
          summary.paidShipped += invoice.totalAmount;
        } else {
          summary.paidKeep += invoice.totalAmount;
        }
      }
      return summary;
    },
    { paidShipped: 0, paidKeep: 0, unpaidBalance: 0, downpayments: 0 }
  );
  const summaryMax = Math.max(1, ...Object.values(financialSummary).map(Number));

  return (
    <div className="w-full">
      <div className="mb-6">
        <h2 className="text-xl font-display font-black text-slate-900 flex items-center gap-2">
          <FileText className="w-5.5 h-5.5 text-[#f43f5e]" />
          Invoices Directory Ledger
        </h2>
        <p className="text-slate-500 text-xs mt-0.5">
          Historical invoice reports, payments tracing, client logs, and real-time ledger auditing.
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-rose-50 border border-rose-100 p-4 text-xs font-mono rounded-2xl text-rose-700">
          {error}
        </div>
      )}

      {/* Control Actions / Filters */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 md:p-5 mb-6 flex flex-col md:flex-row items-stretch md:items-center gap-4 shadow-xs">
        {/* Search */}
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by customer name, invoice number, cashier..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-205 outline-none text-slate-800 rounded-xl text-xs focus:bg-white focus:border-rose-400 transition-colors"
          />
        </div>

        {/* Status Tab buttons */}
        <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-1 shrink-0">
          {[
            { id: "All", label: "All Invoices" },
            { id: PaymentStatus.PAID, label: "Paid" },
            { id: PaymentStatus.PARTIALLY_PAID, label: "Partial" },
            { id: PaymentStatus.UNPAID, label: "Unpaid" },
            { id: PaymentStatus.CANCELLED, label: "Cancelled" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors duration-150 whitespace-nowrap ${
                statusFilter === tab.id ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid grid-cols-1 gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
            Shipping status
            <select value={shippingFilter} onChange={(e) => setShippingFilter(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-800 outline-none focus:border-rose-400">
              <option value="All">All shipping</option>
              {Object.values(ShippingStatus).map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
            Payment status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-800 outline-none focus:border-rose-400">
              <option value="All">All payments</option>
              {Object.values(PaymentStatus).map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
            Invoice status
            <select value={invoiceStatusFilter} onChange={(e) => setInvoiceStatusFilter(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-800 outline-none focus:border-rose-400">
              <option value="All">All invoice statuses</option>
              {Object.values(InvoiceStatus).map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
            Invoice date
            <select
              value={dateRangeFilter}
              onChange={(e) => {
                const nextFilter = e.target.value as DateRangeFilter;
                setDateRangeFilter(nextFilter);
                if (nextFilter === "Today") {
                  const today = toDateInputValue(new Date());
                  setCustomStartDate(today);
                  setCustomEndDate(today);
                }
                if (nextFilter === "Yesterday") {
                  const yesterdayDate = new Date();
                  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
                  const yesterday = toDateInputValue(yesterdayDate);
                  setCustomStartDate(yesterday);
                  setCustomEndDate(yesterday);
                }
              }}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-800 outline-none focus:border-rose-400"
            >
              <option value="All">All dates</option>
              <option value="Today">Today</option>
              <option value="Yesterday">Yesterday</option>
              <option value="Week">Last 7 days</option>
              <option value="Month">This month</option>
              <option value="Custom">Calendar range</option>
            </select>
          </label>
          <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
            Days unpaid
            <select value={daysUnpaidFilter} onChange={(e) => setDaysUnpaidFilter(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-800 outline-none focus:border-rose-400">
              {daysUnpaidRanges.map((range) => (
                <option key={range.value} value={range.value}>{range.label}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-5">
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
              Calendar start
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => {
                  setCustomStartDate(e.target.value);
                  setDateRangeFilter("Custom");
                }}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-800 outline-none focus:border-rose-400"
              />
            </label>
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
              Calendar end
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => {
                  setCustomEndDate(e.target.value);
                  setDateRangeFilter("Custom");
                }}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-800 outline-none focus:border-rose-400"
              />
            </label>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Filtered Financial Summary</h3>
              <p className="text-[9px] text-slate-400">{filteredInvoices.length} matching invoices</p>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: "Paid · Shipped Out", value: financialSummary.paidShipped, color: "bg-emerald-600" },
              { label: "Paid · Keep", value: financialSummary.paidKeep, color: "bg-violet-700" },
              { label: "Unpaid Balance", value: financialSummary.unpaidBalance, color: "bg-amber-500" },
              { label: "DP / Payments Received", value: financialSummary.downpayments, color: "bg-blue-600" },
            ].map((metric) => (
              <div key={metric.label} className="grid grid-cols-[135px_minmax(0,1fr)_90px] items-center gap-2 text-[10px]">
                <span className="font-semibold text-slate-600">{metric.label}</span>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${metric.color}`} style={{ width: `${Math.max(2, (metric.value / summaryMax) * 100)}%` }} />
                </div>
                <span className="text-right font-mono font-bold text-slate-900">₱{metric.value.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Ledger Table */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 h-64 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-slate-100 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-250 rounded-3xl p-12 text-center text-slate-400">
          <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-800">No invoice transactions logged.</p>
          <p className="text-xs text-slate-400 mt-1">Generate a bead invoice inside the compiler checkout.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-3xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-450 font-mono text-[9px] uppercase font-bold tracking-wider">
                  <th className="py-4 px-6">Invoice #</th>
                  <th className="py-4 px-6">Order Date</th>
                  <th className="py-4 px-6">Customer</th>
                  <th className="py-4 px-4 text-center">Shipping</th>
                  <th className="py-4 px-4 text-center">Payment Status</th>
                  <th className="py-4 px-4 text-center">Days Unpaid</th>
                  <th className="py-4 px-4 text-center">Invoice Status</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {filteredInvoices.map((inv) => {
                  const dateObj = getInvoiceDate(inv);
                  const daysUnpaid = getDaysUnpaid(inv);
                  const agingRowClass = getAgingRowClass(daysUnpaid);
                  const formattedDate = dateObj.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  const isExpanded = expandedInvoiceId === inv.id;

                  return (
                    <React.Fragment key={inv.id}>
                      <tr
                        onClick={() => inv.id && setExpandedInvoiceId(isExpanded ? null : inv.id)}
                        className={`border-slate-100 transition-colors cursor-pointer group ${agingRowClass || (isExpanded ? "bg-slate-50/30" : "hover:bg-slate-50/50")}`}
                      >
                        {/* Inv Number */}
                        <td className="py-4 px-6 font-mono font-bold text-slate-900">
                          <span className="flex items-center gap-1.5">
                            <span>#{inv.invoiceNumber}</span>
                            <span className="text-[10px] text-slate-400 font-normal">
                              ({isExpanded ? "▲ Hide DP" : "▼ Show DP"})
                            </span>
                          </span>
                        </td>

                        {/* Date */}
                        <td className="py-4 px-6 text-slate-500 font-mono text-[11px]">
                          {formattedDate}
                        </td>

                        {/* Customer */}
                        <td className="py-4 px-6">
                          <div className="font-semibold text-slate-800">{inv.customerName}</div>
                          {inv.customerPhone && (
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">📱 {inv.customerPhone}</div>
                          )}
                          {inv.customerFacebookName && (
                            <div className="text-[10px] text-blue-500 mt-0.5">FB/IG: {inv.customerFacebookName}</div>
                          )}
                        </td>

                        {/* Shipping status */}
                        <td className="py-4 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={inv.shippingStatus || ShippingStatus.PENDING}
                            disabled={!isAdminOrSuper}
                            onChange={(e) => handleUpdateShippingStatus(e, inv, e.target.value as ShippingStatus)}
                            className={`px-2 py-1 rounded-xl text-[10px] font-bold outline-none border cursor-pointer transition-colors ${
                              inv.shippingStatus === ShippingStatus.DELIVERED
                                ? "bg-emerald-50 text-emerald-800 border-emerald-250 focus:bg-emerald-100"
                                : inv.shippingStatus === ShippingStatus.SHIPPED
                                ? "bg-blue-50 text-blue-800 border-blue-250 focus:bg-blue-100"
                                : "bg-amber-50 text-amber-850 border-amber-250 focus:bg-amber-100"
                            }`}
                          >
                            <option value={ShippingStatus.PENDING}>Pending</option>
                            <option value={ShippingStatus.SHIPPED}>Shipped</option>
                            <option value={ShippingStatus.DELIVERED}>Delivered</option>
                          </select>
                        </td>

                        {/* Payment Toggle Pill */}
                        <td className="py-4 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-0.5 shrink-0 mx-auto max-w-fit">
                            {[
                              { value: PaymentStatus.UNPAID, icon: Clock, label: "Unpaid", color: "text-amber-600 hover:bg-amber-50" },
                              { value: PaymentStatus.PARTIALLY_PAID, icon: Clock, label: "Partial", color: "text-blue-600 hover:bg-blue-50" },
                              { value: PaymentStatus.PAID, icon: CheckCircle, label: "Paid", color: "text-emerald-700 hover:bg-emerald-50" },
                              { value: PaymentStatus.CANCELLED, icon: XCircle, label: "Void", color: "text-rose-600 hover:bg-rose-50" },
                            ].map((pill) => {
                              const isCurrent = inv.paymentStatus === pill.value;
                              return (
                                <button
                                  key={pill.value}
                                  disabled={!isAdminOrSuper}
                                  onClick={(e) => handleUpdatePaymentStatus(e, inv, pill.value as PaymentStatus)}
                                  className={`px-2 py-0.5 rounded-lg text-[9.5px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                                    isCurrent
                                      ? inv.paymentStatus === PaymentStatus.PAID
                                        ? "bg-emerald-600 text-white"
                                        : inv.paymentStatus === PaymentStatus.PARTIALLY_PAID
                                        ? "bg-blue-600 text-white"
                                        : inv.paymentStatus === PaymentStatus.CANCELLED
                                        ? "bg-[#f43f5e] text-white"
                                        : "bg-amber-500 text-slate-900"
                                      : `text-slate-450 ${pill.color}`
                                  }`}
                                  title={`Set invoice status as ${pill.label}`}
                                >
                                  <pill.icon className="w-3 h-3" />
                                  {pill.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>

                        {/* Days unpaid */}
                        <td className="py-4 px-4 text-center">
                          {daysUnpaid > 0 ? (
                            <span className="inline-flex min-w-16 items-center justify-center rounded-xl border border-current/15 bg-white/70 px-2 py-1 font-mono text-[10px] font-black text-slate-800 shadow-3xs">
                              {daysUnpaid}d
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400">-</span>
                          )}
                        </td>

                        {/* Invoice Status Select dropdown */}
                        <td className="py-4 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={inv.invoiceStatus || InvoiceStatus.PENDING}
                            disabled={!isAdminOrSuper}
                            onChange={(e) => handleUpdateInvoiceStatus(e, inv, e.target.value as InvoiceStatus)}
                            className={`px-2 py-1 rounded-xl text-[10px] font-bold outline-none border cursor-pointer transition-colors ${
                              inv.invoiceStatus === InvoiceStatus.SENT
                                ? "bg-purple-50 text-purple-800 border-purple-250 focus:bg-purple-100"
                                : inv.invoiceStatus === InvoiceStatus.CANCELLED
                                ? "bg-rose-50 text-rose-800 border-rose-250 focus:bg-rose-100"
                                : inv.invoiceStatus === InvoiceStatus.DRAFT
                                ? "bg-stone-50 text-stone-750 border-stone-250 focus:bg-stone-100"
                                : "bg-indigo-50 text-indigo-800 border-indigo-250 focus:bg-indigo-100"
                            }`}
                          >
                            <option value={InvoiceStatus.DRAFT}>Draft</option>
                            <option value={InvoiceStatus.PENDING}>Pending</option>
                            <option value={InvoiceStatus.SENT}>Sent</option>
                            <option value={InvoiceStatus.CANCELLED}>Cancelled</option>
                          </select>
                        </td>

                        {/* Action buttons */}
                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                inv.id && onSelectInvoice(inv.id);
                              }}
                              className="p-1 px-2 border border-slate-200 hover:bg-slate-100 rounded-lg text-[10px] font-bold text-slate-650 inline-flex items-center gap-1 cursor-pointer shadow-3xs"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              View
                            </button>

                            {isAdminOrSuper && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditInvoice(inv);
                                }}
                                className="p-1 px-2 border border-rose-200 hover:bg-rose-50 rounded-lg text-[10px] font-bold text-rose-600 inline-flex items-center gap-1 cursor-pointer"
                                title="Edit invoice details"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Edit
                              </button>
                            )}

                            {isAdminOrSuper && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteInvoice(e, inv.id);
                                }}
                                className="p-1.5 text-[#f43f5e] hover:text-white hover:bg-[#f43f5e] rounded-lg cursor-pointer transition-colors"
                                title="Delete transaction record"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* --- COLLAPSIBLE DETAIL PANEL (DP) --- */}
                      {isExpanded && (
                        <tr className="bg-slate-50/50">
                          <td colSpan={8} className="px-6 py-4 border-b border-slate-200">
                            <div className="bg-white border border-slate-200 rounded-2xl p-5 md:p-6 shadow-xs space-y-6 text-xs text-slate-700">
                              
                              {/* Header info */}
                              <div className="flex items-center justify-between border-b pb-3.5 border-slate-100">
                                <h4 className="font-display font-black text-slate-900 text-sm flex items-center gap-1.5">
                                  <FileText className="w-4.5 h-4.5 text-[#f43f5e]" />
                                  Invoice Detail Panel (DP) — #{inv.invoiceNumber}
                                </h4>
                                <span className="text-[11px] font-mono font-extrabold text-slate-900 bg-slate-105 bg-slate-50 px-3 py-1 rounded-lg border border-slate-200 shadow-3xs">
                                  Grand Total: ₱{inv.totalAmount.toFixed(2)}
                                </span>
                              </div>

                              {/* Core metadata statuses mapping */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50/60 p-4 rounded-xl border border-slate-100/80">
                                <div>
                                  <span className="block text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest">Order Date</span>
                                  <span className="font-bold text-slate-800 block mt-1.5">{formattedDate}</span>
                                </div>
                                <div onClick={(e) => e.stopPropagation()}>
                                  <span className="block text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">Shipping Status</span>
                                  <select
                                    value={inv.shippingStatus || ShippingStatus.PENDING}
                                    disabled={!isAdminOrSuper}
                                    onChange={(e) => handleUpdateShippingStatus(e, inv, e.target.value as ShippingStatus)}
                                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold outline-none border cursor-pointer transition-colors ${
                                      inv.shippingStatus === ShippingStatus.DELIVERED
                                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                        : inv.shippingStatus === ShippingStatus.SHIPPED
                                        ? "bg-blue-50 border-blue-200 text-blue-800"
                                        : "bg-amber-50 border-amber-200 text-amber-800"
                                    }`}
                                  >
                                    <option value={ShippingStatus.PENDING}>Pending</option>
                                    <option value={ShippingStatus.SHIPPED}>Shipped</option>
                                    <option value={ShippingStatus.DELIVERED}>Delivered</option>
                                  </select>
                                </div>
                                <div onClick={(e) => e.stopPropagation()}>
                                  <span className="block text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">Payment Status</span>
                                  <select
                                    value={inv.paymentStatus || PaymentStatus.UNPAID}
                                    disabled={!isAdminOrSuper}
                                    onChange={(e) => handleUpdatePaymentStatusDirect(e, inv, e.target.value as PaymentStatus)}
                                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold outline-none border cursor-pointer transition-colors ${
                                      inv.paymentStatus === PaymentStatus.PAID
                                        ? "bg-emerald-50 border-emerald-250 text-emerald-800"
                                        : inv.paymentStatus === PaymentStatus.PARTIALLY_PAID
                                        ? "bg-blue-50 border-blue-250 text-blue-800"
                                        : inv.paymentStatus === PaymentStatus.CANCELLED
                                        ? "bg-rose-50 border-rose-250 text-rose-800"
                                        : "bg-amber-50 border-amber-250 text-amber-800"
                                    }`}
                                  >
                                    <option value={PaymentStatus.UNPAID}>Unpaid</option>
                                    <option value={PaymentStatus.PARTIALLY_PAID}>Partially Paid</option>
                                    <option value={PaymentStatus.PAID}>Paid</option>
                                    <option value={PaymentStatus.CANCELLED}>Void</option>
                                  </select>
                                </div>
                                <div onClick={(e) => e.stopPropagation()}>
                                  <span className="block text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">Invoice Status</span>
                                  <select
                                    value={inv.invoiceStatus || InvoiceStatus.PENDING}
                                    disabled={!isAdminOrSuper}
                                    onChange={(e) => handleUpdateInvoiceStatus(e, inv, e.target.value as InvoiceStatus)}
                                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold outline-none border cursor-pointer transition-colors ${
                                      inv.invoiceStatus === InvoiceStatus.SENT
                                        ? "bg-purple-50 border-purple-200 text-purple-800"
                                        : inv.invoiceStatus === InvoiceStatus.CANCELLED
                                        ? "bg-rose-50 border-rose-200 text-rose-800"
                                        : inv.invoiceStatus === InvoiceStatus.DRAFT
                                        ? "bg-stone-50 border-stone-200 text-stone-700"
                                        : "bg-indigo-50 border-indigo-200 text-indigo-800"
                                    }`}
                                  >
                                    <option value={InvoiceStatus.DRAFT}>Draft</option>
                                    <option value={InvoiceStatus.PENDING}>Pending</option>
                                    <option value={InvoiceStatus.SENT}>Sent</option>
                                    <option value={InvoiceStatus.CANCELLED}>Cancelled</option>
                                  </select>
                                </div>
                              </div>

                              {/* Items Breakdown inside DP */}
                              <div className="space-y-2">
                                <span className="block text-[9.5px] font-mono font-bold text-slate-400 uppercase tracking-wider">Purchased Beads Breakdown</span>
                                <div className="border border-slate-150 rounded-2xl overflow-hidden shadow-3xs">
                                  <table className="w-full text-left">
                                    <thead>
                                      <tr className="bg-slate-50 text-slate-450 font-mono text-[9px] uppercase font-bold border-b border-slate-150">
                                        <th className="py-2.5 px-4 font-bold">SKU ID</th>
                                        <th className="py-2.5 px-4 font-bold">Description</th>
                                        <th className="py-2.5 px-4 text-right font-bold">Price</th>
                                        <th className="py-2.5 px-4 text-center font-bold">Qty</th>
                                        <th className="py-2.5 px-4 text-right font-bold">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 font-sans">
                                      {inv.items.map((item, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50/40 animate-in fade-in-20 duration-100">
                                          <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{item.sku}</td>
                                          <td className="py-2.5 px-4 text-slate-650 font-medium">{item.name}</td>
                                          <td className="py-2.5 px-4 text-right font-mono text-slate-500">₱{item.price.toFixed(2)} / {formatSellingMeasure(item.sellingUnitQuantity, item.measurementUnit)}</td>
                                          <td className="py-2.5 px-4 text-center font-mono font-medium text-slate-600">{formatMeasuredQuantity(item.quantity, item.measurementUnit)}</td>
                                          <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-950">₱{calculateMeasuredLineTotal(item.price, item.quantity, item.sellingUnitQuantity).toFixed(2)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              {/* Description area */}
                              {inv.description && (
                                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-150 leading-relaxed">
                                  <span className="block text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">Description / Design Specs</span>
                                  <p className="text-slate-605 text-slate-600 font-medium">{inv.description}</p>
                                </div>
                              )}

                              <div className="flex justify-end gap-3 pt-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    inv.id && onSelectInvoice(inv.id);
                                  }}
                                  className="px-4.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                                >
                                  <Eye className="w-3.5 h-3.5 text-rose-450" />
                                  Open Printable Receipt PDF
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingInvoice && isAdminOrSuper && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h3 className="font-display text-base font-black text-slate-900">Edit {editingInvoice.invoiceNumber}</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Admin-only invoice details and status controls.</p>
              </div>
              <button type="button" onClick={() => setEditingInvoice(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Customer name
                <input required value={editingInvoice.customerName} onChange={(e) => setEditingInvoice({ ...editingInvoice, customerName: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium normal-case text-slate-900 outline-none focus:border-rose-400 focus:bg-white" />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Contact phone
                <input value={editingInvoice.customerPhone || ""} onChange={(e) => setEditingInvoice({ ...editingInvoice, customerPhone: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium normal-case text-slate-900 outline-none focus:border-rose-400 focus:bg-white" />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 md:col-span-2">
                Customer email
                <input type="email" value={editingInvoice.customerEmail || ""} onChange={(e) => setEditingInvoice({ ...editingInvoice, customerEmail: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium normal-case text-slate-900 outline-none focus:border-rose-400 focus:bg-white" />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 md:col-span-2">
                FB / IG name
                <input value={editingInvoice.customerFacebookName || ""} onChange={(e) => setEditingInvoice({ ...editingInvoice, customerFacebookName: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium normal-case text-slate-900 outline-none focus:border-rose-400 focus:bg-white" />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Shipping status
                <select value={editingInvoice.shippingStatus || ShippingStatus.PENDING} onChange={(e) => setEditingInvoice({ ...editingInvoice, shippingStatus: e.target.value as ShippingStatus })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-900 outline-none focus:border-rose-400">
                  {Object.values(ShippingStatus).map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Payment status
                <select value={editingInvoice.paymentStatus} onChange={(e) => setEditingInvoice({ ...editingInvoice, paymentStatus: e.target.value as PaymentStatus })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-900 outline-none focus:border-rose-400">
                  {Object.values(PaymentStatus).map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                DP / Amount paid
                <input type="number" min="0" step="0.01" value={editingInvoice.amountPaid || 0} onChange={(e) => setEditingInvoice({ ...editingInvoice, amountPaid: Math.max(0, Number(e.target.value) || 0) })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-900 outline-none focus:border-rose-400" />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Previous balance
                <input type="number" min="0" step="0.01" value={editingInvoice.previousBalance || 0} onChange={(e) => setEditingInvoice({ ...editingInvoice, previousBalance: Math.max(0, Number(e.target.value) || 0) })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-900 outline-none focus:border-rose-400" />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 md:col-span-2">
                Invoice status
                <select value={editingInvoice.invoiceStatus || InvoiceStatus.PENDING} onChange={(e) => setEditingInvoice({ ...editingInvoice, invoiceStatus: e.target.value as InvoiceStatus })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs normal-case text-slate-900 outline-none focus:border-rose-400">
                  {Object.values(InvoiceStatus).map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 md:col-span-2">
                Description / notes
                <textarea rows={4} value={editingInvoice.description || ""} onChange={(e) => setEditingInvoice({ ...editingInvoice, description: e.target.value })} className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium normal-case text-slate-900 outline-none focus:border-rose-400 focus:bg-white" />
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setEditingInvoice(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" disabled={savingEdit} onClick={handleSaveInvoiceEdit} className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-600 disabled:opacity-50">
                <Save className="h-3.5 w-3.5" />
                {savingEdit ? "Saving..." : "Save changes"}
              </button>
            </div>
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
