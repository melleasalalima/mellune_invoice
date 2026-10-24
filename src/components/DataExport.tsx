import React, { useMemo, useState } from "react";
import { collection, documentId, getDocsFromServer, limit, orderBy, query, startAfter } from "firebase/firestore";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, LoaderCircle, Users, Package, Receipt, History, ShieldCheck } from "lucide-react";
import { db } from "../lib/firebase";
import { Customer, InventoryItem, Invoice, StockHistoryEntry, UserProfile, UserRole } from "../types";

type ExportKey = "inventory" | "invoices" | "customers" | "stockHistory" | "users";

interface ExportData {
  inventory: InventoryItem[];
  invoices: Invoice[];
  customers: Customer[];
  stockHistory: StockHistoryEntry[];
  users: UserProfile[];
}

interface ExportCardProps {
  exportKey: ExportKey;
  title: string;
  description: string;
  icon: React.ReactNode;
  rows: Record<string, unknown>[];
  dateField?: string;
  statusField?: string;
  statusOptions?: string[];
  isLoaded: boolean;
  isLoading: boolean;
  loadingProgress: number;
  onLoad: (key: ExportKey) => void;
  onDownload: (key: ExportKey, rows: Record<string, unknown>[], title: string) => void;
}

const emptyData: ExportData = { inventory: [], invoices: [], customers: [], stockHistory: [], users: [] };

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") return value.toDate();
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dateText = (value: unknown) => toDate(value)?.toISOString() || "";

const EXCEL_CELL_LIMIT = 32767;

const exportValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date || (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function")) return dateText(value);
  if (typeof value === "string" && value.startsWith("data:image/")) return "[Embedded image omitted from Excel export]";
  const text = typeof value === "string" ? value : Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > EXCEL_CELL_LIMIT ? `${text.slice(0, EXCEL_CELL_LIMIT - 40)}...[truncated for Excel]` : text;
};

const exportRow = (values: Record<string, unknown>) => Object.fromEntries(
  Object.entries(values).map(([key, value]) => [key, exportValue(value)])
);

const baseRows = (data: ExportData) => ({
  inventory: data.inventory.map(({ id, sellingMeasures, ...item }) => exportRow({ ID: id || "", ...item, SellingMeasures: sellingMeasures, CreatedAt: dateText(item.createdAt), UpdatedAt: dateText(item.updatedAt) })),
  invoices: data.invoices.map(({ id, items, ...invoice }) => exportRow({ ID: id || "", ...invoice, Items: items.length, ItemSummary: items.map((item) => `${item.name} x${item.quantity}`).join("; "), CreatedAt: dateText(invoice.createdAt), UpdatedAt: dateText(invoice.updatedAt) })),
  customers: data.customers.map(({ id, ...customer }) => exportRow({ ID: id || "", ...customer, CreatedAt: dateText(customer.createdAt), UpdatedAt: dateText(customer.updatedAt) })),
  stockHistory: data.stockHistory.map(({ id, ...entry }) => exportRow({ ID: id || "", ...entry, CreatedAt: dateText(entry.createdAt) })),
  users: data.users.map(({ uid, ...user }) => exportRow({ UID: uid, ...user, CreatedAt: dateText(user.createdAt), UpdatedAt: dateText(user.updatedAt) })),
});

function ExportCard({ exportKey, title, description, icon, rows, dateField = "CreatedAt", statusField, statusOptions, isLoaded, isLoading, loadingProgress, onLoad, onDownload }: ExportCardProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filteredRows = useMemo(() => rows.filter((row) => {
    const searchable = Object.values(row).join(" ").toLowerCase();
    const rowDate = toDate(row[dateField]);
    const afterFrom = !from || (rowDate && rowDate >= new Date(`${from}T00:00:00`));
    const beforeTo = !to || (rowDate && rowDate <= new Date(`${to}T23:59:59`));
    return searchable.includes(search.toLowerCase()) &&
      (!statusField || status === "all" || String(row[statusField] || "") === status) &&
      Boolean(afterFrom && beforeTo);
  }), [dateField, from, rows, search, status, statusField, to]);

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center">{icon}</div>
          <div>
            <h3 className="font-display font-black text-sm text-slate-900">{title}</h3>
            <p className="text-[11px] text-slate-500 mt-1">{description}</p>
          </div>
        </div>
        <span className="text-[10px] font-mono font-bold text-slate-400 whitespace-nowrap">{isLoaded ? `${filteredRows.length} rows` : isLoading ? `Loading ${loadingProgress}...` : "Not loaded"}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records..." className="sm:col-span-2 lg:col-span-1 h-9 px-3 rounded-lg border border-slate-200 text-xs outline-none focus:border-rose-400" />
        {statusField && statusOptions && <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 px-2 rounded-lg border border-slate-200 text-xs bg-white outline-none focus:border-rose-400"><option value="all">All statuses</option>{statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>}
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" className="h-9 px-2 rounded-lg border border-slate-200 text-xs outline-none focus:border-rose-400" />
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" className="h-9 px-2 rounded-lg border border-slate-200 text-xs outline-none focus:border-rose-400" />
      </div>
      <button onClick={() => isLoaded ? onDownload(exportKey, filteredRows, title) : onLoad(exportKey)} disabled={isLoading || (isLoaded && !filteredRows.length)} className="w-full h-10 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center justify-center gap-2 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        {isLoading ? <LoaderCircle className="w-4 h-4 animate-spin" /> : isLoaded ? <Download className="w-4 h-4" /> : <FileSpreadsheet className="w-4 h-4" />}
        {isLoading ? `Loading ${title}...` : isLoaded ? `Download ${title} (.xlsx)` : `Load ${title} records`}
      </button>
    </section>
  );
}

export default function DataExport({ userProfile }: { userProfile: UserProfile }) {
  const [data, setData] = useState<ExportData>(emptyData);
  const [error, setError] = useState<string | null>(null);
  const [loadedCollections, setLoadedCollections] = useState<ExportKey[]>([]);
  const [loadingCollections, setLoadingCollections] = useState<ExportKey[]>([]);
  const [loadingProgress, setLoadingProgress] = useState<Partial<Record<ExportKey, number>>>({});
  const isAdmin = userProfile.role === UserRole.ADMIN || userProfile.role === UserRole.SUPER_ADMIN;

  const loadCollection = async (key: ExportKey) => {
    if (loadingCollections.includes(key) || loadedCollections.includes(key)) return;
    if (key === "users" && !isAdmin) return;
    setLoadingCollections((current) => [...current, key]);
    setError(null);
    setLoadingProgress((current) => ({ ...current, [key]: 0 }));
    try {
      const batchSize = 250;
      let pageQuery = query(collection(db, key), orderBy(documentId()), limit(batchSize));
      const records: { id: string; [field: string]: unknown }[] = [];

      while (true) {
        const snapshot = await getDocsFromServer(pageQuery);
        records.push(...snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setLoadingProgress((current) => ({ ...current, [key]: records.length }));
        if (snapshot.size < batchSize) break;
        const lastDocument = snapshot.docs[snapshot.docs.length - 1];
        pageQuery = query(collection(db, key), orderBy(documentId()), startAfter(lastDocument), limit(batchSize));
      }

      setData((current) => ({ ...current, [key]: records }));
      setLoadedCollections((current) => [...current, key]);
    } catch (err: any) {
      setError(`Could not load ${key}: ${err.message || "Check your connection and permissions."}`);
    } finally {
      setLoadingCollections((current) => current.filter((item) => item !== key));
    }
  };

  const rows = useMemo(() => baseRows(data), [data]);

  const download = (key: ExportKey, filteredRows: Record<string, unknown>[], title: string) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filteredRows), title.slice(0, 31));
    if (key === "invoices") {
      const invoiceIds = new Set(filteredRows.map((row) => String(row.ID)));
      const items = data.invoices.filter((invoice) => invoiceIds.has(String(invoice.id))).flatMap((invoice) => invoice.items.map((item) => exportRow({ InvoiceID: invoice.id || "", InvoiceNumber: invoice.invoiceNumber, ...item })));
      if (items.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(items), "Invoice Items");
    }
    const workbookData = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([workbookData], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <h2 className="text-xl font-display font-black text-slate-900 flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-[#f43f5e]" /> Data Export</h2>
        <p className="text-slate-500 text-xs mt-1">Filter each dataset, then download it as an Excel workbook. Invoice downloads also include an item-level sheet.</p>
      </div>
      {error && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{error}</div>}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ExportCard exportKey="inventory" title="Stock Inventory" description="Products, quantities, pricing, and supplier details." icon={<Package className="w-5 h-5" />} rows={rows.inventory} isLoaded={loadedCollections.includes("inventory")} isLoading={loadingCollections.includes("inventory")} loadingProgress={loadingProgress.inventory || 0} onLoad={loadCollection} onDownload={download} />
        <ExportCard exportKey="invoices" title="Invoices" description="Invoice totals, customer details, payment, and shipping status." icon={<Receipt className="w-5 h-5" />} rows={rows.invoices} statusField="paymentStatus" statusOptions={["Unpaid", "Partially Paid", "Paid", "Cancelled"]} isLoaded={loadedCollections.includes("invoices")} isLoading={loadingCollections.includes("invoices")} loadingProgress={loadingProgress.invoices || 0} onLoad={loadCollection} onDownload={download} />
        <ExportCard exportKey="customers" title="Customers" description="Customer contacts, tiers, notes, and account dates." icon={<Users className="w-5 h-5" />} rows={rows.customers} isLoaded={loadedCollections.includes("customers")} isLoading={loadingCollections.includes("customers")} loadingProgress={loadingProgress.customers || 0} onLoad={loadCollection} onDownload={download} />
        <ExportCard exportKey="stockHistory" title="Stock History" description="Every stock addition, removal, creation, and update." icon={<History className="w-5 h-5" />} rows={rows.stockHistory} statusField="action" statusOptions={["created", "stock_added", "stock_removed", "updated"]} isLoaded={loadedCollections.includes("stockHistory")} isLoading={loadingCollections.includes("stockHistory")} loadingProgress={loadingProgress.stockHistory || 0} onLoad={loadCollection} onDownload={download} />
        {isAdmin && <ExportCard exportKey="users" title="Staff Profiles" description="Staff accounts and access roles. Admin access required." icon={<ShieldCheck className="w-5 h-5" />} rows={rows.users} statusField="role" statusOptions={[UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.USER]} isLoaded={loadedCollections.includes("users")} isLoading={loadingCollections.includes("users")} loadingProgress={loadingProgress.users || 0} onLoad={loadCollection} onDownload={download} />}
      </div>
    </div>
  );
}