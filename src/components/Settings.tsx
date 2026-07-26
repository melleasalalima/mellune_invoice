/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { doc, getDoc, setDoc, serverTimestamp, collection, query, orderBy, onSnapshot, updateDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { PaymentMethod, ShopSettings, UserRole, UserProfile } from "../types";
import { Settings as SettingsIcon, Save, Sparkles, Coins, Landmark, FileText, UserPlus, ShieldAlert, CheckCircle, RefreshCw, QrCode, Download, Upload, X } from "lucide-react";
import ImageCropper from "./ImageCropper";

interface SettingsProps {
  userProfile: UserProfile;
}

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { id: "gcash", label: "GCash", accountNumber: "", accountName: "" },
  { id: "maya", label: "Maya", accountNumber: "", accountName: "" },
  { id: "maribank", label: "Maribank", accountNumber: "", accountName: "" },
  { id: "bpi", label: "BPI", accountNumber: "", accountName: "" },
];

const mergePaymentMethods = (methods?: PaymentMethod[], gcashNumber = "", gcashName = ""): PaymentMethod[] => {
  const saved = methods || [];
  return DEFAULT_PAYMENT_METHODS.map((method) => {
    const existing = saved.find((item) => item.id === method.id);
    if (existing) return { ...method, ...existing };
    if (method.id === "gcash") return { ...method, accountNumber: gcashNumber, accountName: gcashName };
    return method;
  });
};

const DEFAULT_CHAT_TEMPLATE = `✨ *Mellune Co. Invoice* ✨
Invoice #: *{INVOICE_NUM}*
Date: {DATE}
Customer: {CUST_NAME}

📋 Items List:
{ITEM_LIST}

💰TOTAL: *₱{TOTAL}*

DP / Paid: ₱{AMOUNT_PAID}
Total: ₱{TOTAL}
Previous Balance: ₱{PREVIOUS_BALANCE}
*BALANCE: ₱{BALANCE}*

🏦SECURE PAYMENT CHANNELS:
{PAYMENT_CHANNELS}

🆔 Please send a copy of the receipt or your Reference ID once paid.
🚚 Shipout Daily, Cut-off for next day shipping is 11:00PM

Also po, sending CO link po. Kindly note po that the checkout link is only open for paid/settled invoices. Once settled na po, you may checkout sa ₱5 po, then paki-send po ng last 4 digits ng Order ID for reference 😊

🔗: https://www.tiktok.com/view/product/1734472417032439312`;

export default function Settings({ userProfile }: SettingsProps) {
  const [pendingQrCrop, setPendingQrCrop] = useState<{ id: PaymentMethod["id"]; source: string } | null>(null);
  const [shopName, setShopName] = useState("");
  const [gcashNumber, setGcashNumber] = useState("");
  const [gcashName, setGcashName] = useState("");
  const [bankDetails, setBankDetails] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(DEFAULT_PAYMENT_METHODS);
  const [chatTemplate, setChatTemplate] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Staff Profiles state for Super Admin moderation
  const [staffList, setStaffList] = useState<UserProfile[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);

  const isSuperAdmin = userProfile.role === UserRole.SUPER_ADMIN;
  const isWritable = userProfile.role === UserRole.SUPER_ADMIN || userProfile.role === UserRole.ADMIN;

  // 1. Sync Shop settings
  useEffect(() => {
    const settingsRef = doc(db, "settings", "shop");
    const unsubscribe = onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as ShopSettings;
        setShopName(data.shopName || "");
        setGcashNumber(data.gcashNumber || "");
        setGcashName(data.gcashName || "");
        setBankDetails(data.bankDetails || "");
        setPaymentMethods(mergePaymentMethods(data.paymentMethods, data.gcashNumber, data.gcashName));
        setChatTemplate(data.chatTemplate || "");
      } else {
        // Fallback default templates
        setShopName("Dazzling Beads Shop");
        setGcashNumber("0917-888-2234");
        setGcashName("Melle S.");
        setBankDetails("BDO Savings: 104-555-88982 (Melle Salalima)");
        setPaymentMethods(mergePaymentMethods(undefined, "0917-888-2234", "Melle S."));
        setChatTemplate(DEFAULT_CHAT_TEMPLATE);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const updatePaymentMethod = (id: PaymentMethod["id"], changes: Partial<PaymentMethod>) => {
    setPaymentMethods((current) => current.map((method) => method.id === id ? { ...method, ...changes } : method));
  };

  const handleQrUpload = (id: PaymentMethod["id"], file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please upload a PNG, JPG, or other image file for the QR code.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setPendingQrCrop({ id, source: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const downloadQrCode = (method: PaymentMethod) => {
    if (!method.qrCodeDataUrl) return;
    const link = document.createElement("a");
    link.href = method.qrCodeDataUrl;
    link.download = `${method.label.toLowerCase()}-qr-code.png`;
    link.click();
  };

  // 2. Super Admin Staff registry read
  useEffect(() => {
    if (!isSuperAdmin) return;
    setLoadingStaff(true);
    const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const users: UserProfile[] = [];
        snapshot.forEach((doc) => {
          users.push({ uid: doc.id, ...doc.data() } as UserProfile);
        });
        setStaffList(users);
        setLoadingStaff(false);
      },
      (err) => {
        setLoadingStaff(false);
        console.error("Failed to read user roster in live server, fallback bypass active", err);
      }
    );

    return () => unsubscribe();
  }, [isSuperAdmin]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isWritable) return;

    setSaving(true);
    setSuccess(false);
    setError(null);

    const payload: ShopSettings = {
      shopName: shopName.trim() || "My Beads Shop",
      gcashNumber: gcashNumber.trim(),
      gcashName: gcashName.trim(),
      bankDetails: bankDetails.trim(),
      paymentMethods: paymentMethods.map((method) => ({
        id: method.id,
        label: method.label,
        accountNumber: method.accountNumber.trim(),
        accountName: method.accountName.trim(),
        ...(method.qrCodeDataUrl ? { qrCodeDataUrl: method.qrCodeDataUrl } : {}),
      })),
      chatTemplate: chatTemplate,
      updatedBy: userProfile.email,
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, "settings", "shop"), payload);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    } catch (err: any) {
      try {
        handleFirestoreError(err, OperationType.WRITE, "settings/shop");
      } catch (wrappedError: any) {
        setError(wrappedError.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePromoteDemoteRole = async (targetUid: string, targetCurrentRole: UserRole, newRole: UserRole) => {
    setError(null);
    if (!isSuperAdmin) {
      setError("Unauthorized: Employee management is restricted of the Super Admin.");
      return;
    }

    if (targetUid === userProfile.uid) {
      setError("Self Locking Warning: You cannot modify your own Super Admin access role!");
      return;
    }

    try {
      const userRef = doc(db, "users", targetUid);
      await updateDoc(userRef, {
        role: newRole,
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      setError(`Role adjustment failed: ${err.message || err}`);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <h2 className="text-xl font-display font-black text-slate-900 flex items-center gap-2">
          <SettingsIcon className="w-5.5 h-5.5 text-[#f43f5e]" />
          Settings &amp; Staff Workspace
        </h2>
        <p className="text-slate-500 text-xs mt-0.5">
          Customize billing templates, coordinate GCash bank references, and moderate staff profiles values.
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-rose-50 border border-rose-100 p-4 font-mono text-xs text-rose-700 rounded-2xl">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column: Business settings form */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-5 md:p-6 shadow-xs">
          <h3 className="font-display font-black text-slate-800 text-xs uppercase tracking-wider mb-6 flex items-center gap-2">
            🎨 Billing &amp; Copyable Template Details
          </h3>

          {loading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-10 bg-slate-50 rounded-xl" />
              <div className="h-24 bg-slate-50 rounded-xl" />
            </div>
          ) : (
            <form onSubmit={handleSaveSettings} className="space-y-4">
              
              {/* Business Name */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Beads Shop Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dazzling Pearl Beads Shop"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  disabled={!isWritable}
                  className="w-full px-3.5 py-2 border border-slate-205 bg-slate-50 outline-none text-slate-850 rounded-xl text-xs focus:border-rose-450 focus:bg-white disabled:opacity-50"
                />
              </div>

              {/* GCash Inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">GCash Account Number</label>
                  <div className="relative">
                    <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="e.g. 0917-555-8822"
                      value={gcashNumber}
                      onChange={(e) => setGcashNumber(e.target.value)}
                      disabled={!isWritable}
                      className="w-full pl-9 pr-3.5 py-2 border border-slate-205 bg-slate-50 outline-none text-slate-850 rounded-xl text-xs focus:border-rose-450 focus:bg-white disabled:opacity-50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">GCash Receiver Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Melle S."
                    value={gcashName}
                    onChange={(e) => setGcashName(e.target.value)}
                    disabled={!isWritable}
                    className="w-full px-3.5 py-2 border border-slate-205 bg-slate-50 outline-none text-slate-850 rounded-xl text-xs focus:border-rose-450 focus:bg-white disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Bank Details */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Bank Transfer Info</label>
                <div className="relative">
                  <Landmark className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <textarea
                    rows={2}
                    placeholder="e.g. BDO Savings: 104-555-882 (Melle Salalima)"
                    value={bankDetails}
                    onChange={(e) => setBankDetails(e.target.value)}
                    disabled={!isWritable}
                    className="w-full pl-9 pr-3.5 py-2 border border-slate-205 bg-slate-50 outline-none text-slate-850 rounded-xl text-xs focus:border-rose-450 focus:bg-white resize-none disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Payment Channels + QR Codes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase">Payment Channels &amp; QR Codes</label>
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">Upload PNG/JPG</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {paymentMethods.map((method) => (
                    <div key={method.id} className="border border-slate-200 bg-slate-50 rounded-2xl p-3">
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                          <QrCode className="w-4 h-4 text-rose-500" />
                          {method.label}
                        </span>
                        {method.qrCodeDataUrl && (
                          <button
                            type="button"
                            onClick={() => updatePaymentMethod(method.id, { qrCodeDataUrl: "" })}
                            disabled={!isWritable}
                            className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer disabled:opacity-50"
                            title={`Remove ${method.label} QR code`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder={`${method.label} account number`}
                          value={method.accountNumber}
                          onChange={(e) => updatePaymentMethod(method.id, { accountNumber: e.target.value })}
                          disabled={!isWritable}
                          className="w-full px-3 py-2 border border-slate-205 bg-white outline-none text-slate-850 rounded-xl text-xs focus:border-rose-450 disabled:opacity-50"
                        />
                        <input
                          type="text"
                          placeholder={`${method.label} account name`}
                          value={method.accountName}
                          onChange={(e) => updatePaymentMethod(method.id, { accountName: e.target.value })}
                          disabled={!isWritable}
                          className="w-full px-3 py-2 border border-slate-205 bg-white outline-none text-slate-850 rounded-xl text-xs focus:border-rose-450 disabled:opacity-50"
                        />

                        <div className="flex items-stretch gap-2">
                          <label className={`flex-1 min-h-24 border border-dashed rounded-xl bg-white flex items-center justify-center text-center overflow-hidden ${isWritable ? "cursor-pointer hover:border-rose-300" : "opacity-60"}`}>
                            {method.qrCodeDataUrl ? (
                              <img src={method.qrCodeDataUrl} alt={`${method.label} QR code`} className="max-h-24 max-w-full object-contain p-2" />
                            ) : (
                              <span className="text-[10px] font-bold text-slate-400 flex flex-col items-center gap-1">
                                <Upload className="w-4 h-4" />
                                Add QR
                              </span>
                            )}
                            <input
                              type="file"
                              accept="image/*"
                              disabled={!isWritable}
                              onChange={(e) => handleQrUpload(method.id, e.target.files?.[0])}
                              className="hidden"
                            />
                          </label>

                          <button
                            type="button"
                            onClick={() => downloadQrCode(method)}
                            disabled={!method.qrCodeDataUrl}
                            className="w-10 border border-slate-200 bg-white rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title={`Download ${method.label} QR code`}
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Chat script template block editor */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase">Custom Chat message script template</label>
                  <span className="text-[9px] text-[#f43f5e] font-bold uppercase tracking-wide">Macro Tags Enabled</span>
                </div>
                
                <textarea
                  rows={16}
                  placeholder="Draft your script guidelines"
                  value={chatTemplate}
                  onChange={(e) => setChatTemplate(e.target.value)}
                  disabled={!isWritable}
                  className="w-full px-3.5 py-2 border border-slate-205 bg-slate-50 rounded-xl font-mono text-[10.5px] leading-relaxed select-all focus:border-rose-450 focus:bg-white resize-y outline-none disabled:opacity-50"
                />
                
                <div className="mt-2 bg-slate-50 border border-slate-200 p-3 rounded-xl">
                  <span className="text-[9.5px] text-slate-450 font-bold uppercase">Insertable shortcode macros:</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5 select-all">
                    {["{SHOP_NAME}", "{CUST_NAME}", "{INVOICE_NUM}", "{DATE}", "{ITEM_LIST}", "{TOTAL}", "{PREVIOUS_BALANCE}", "{TOTAL_DUE}", "{DOWNPAYMENT}", "{AMOUNT_PAID}", "{BALANCE}", "{PAYMENT_CHANNELS}", "{GCASH_NUM}", "{GCASH_NAME}", "{BANK_DETAILS}"].map((m) => (
                      <code key={m} className="bg-slate-100 border border-slate-200 text-[9px] px-1.5 py-0.5 rounded-md font-bold text-slate-700">
                        {m}
                      </code>
                    ))}
                  </div>
                </div>
              </div>

              {/* Save trigger buttons */}
              {isWritable && (
                <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                  {success && (
                    <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                      <CheckCircle className="w-4 h-4" />
                      Settings updated in Firebase successfully!
                    </span>
                  )}
                  
                  <button
                    type="submit"
                    disabled={saving}
                    className="ml-auto py-2.5 px-6 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-50 transition-all duration-150"
                  >
                    <Save className="w-4 h-4 text-rose-400" />
                    {saving ? "Updating..." : "Save shop guidelines"}
                  </button>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Right Column: Super Admin staff list role supervisor */}
        {isSuperAdmin && (
          <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-3xl p-5 md:p-6 shadow-2ns">
            <h3 className="font-display font-black text-slate-800 text-xs uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <ShieldAlert className="w-4.5 h-4.5 text-rose-500" />
              Staff Security &amp; Access Controls
            </h3>
            <p className="text-slate-500 text-[11px] leading-normal mb-5">
              Super Admin Control Center. Dynamically edit system roles (Viewer vs Coordinator Admins) for the beads shop workspace.
            </p>

            {loadingStaff ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-12 bg-slate-200 rounded-xl" />
                <div className="h-12 bg-slate-200 rounded-xl" />
              </div>
            ) : staffList.length <= 1 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center text-xs text-slate-400 leading-relaxed font-mono">
                No secondary employees have logged on yet. When a person logs on using their Google auth, their name will register here for promotion!
              </div>
            ) : (
              <div className="space-y-3.5 max-h-96 overflow-y-auto pr-1">
                {staffList.map((staff) => {
                  if (staff.uid === userProfile.uid) return null; // skip editing self to avoid lockouts

                  return (
                    <div key={staff.uid} className="bg-white border border-slate-200 p-3.5 rounded-2xl flex flex-col gap-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-semibold text-slate-800 text-xs">{staff.displayName}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">{staff.email}</div>
                        </div>

                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider bg-orange-50 text-orange-900 px-2.5 py-0.5 rounded-md border border-orange-200">
                          {staff.role}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                        <span className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider">Configure access role:</span>
                        
                        <div className="flex items-center gap-1 animate-fadeIn">
                          <button
                            onClick={() => handlePromoteDemoteRole(staff.uid, staff.role, UserRole.USER)}
                            className={`py-1 px-2 border rounded-md text-[10px] font-bold cursor-pointer transition-colors ${
                              staff.role === UserRole.USER
                                ? "bg-slate-900 border-slate-900 text-white"
                                : "bg-slate-50 hover:bg-slate-200 text-slate-700"
                            }`}
                          >
                            Cashier
                          </button>
                          
                          <button
                            onClick={() => handlePromoteDemoteRole(staff.uid, staff.role, UserRole.ADMIN)}
                            className={`py-1 px-2 border rounded-md text-[10px] font-bold cursor-pointer transition-colors ${
                              staff.role === UserRole.ADMIN
                                ? "bg-slate-900 border-slate-900 text-white"
                                : "bg-slate-50 hover:bg-slate-200 text-slate-700"
                            }`}
                          >
                            Admin Stock
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {pendingQrCrop && (
        <ImageCropper
          source={pendingQrCrop.source}
          aspect={1}
          outputWidth={800}
          title="Crop Payment QR Code"
          onCancel={() => setPendingQrCrop(null)}
          onComplete={(croppedQr) => {
            updatePaymentMethod(pendingQrCrop.id, { qrCodeDataUrl: croppedQr });
            setPendingQrCrop(null);
          }}
        />
      )}
    </div>
  );
}
