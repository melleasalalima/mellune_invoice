/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum UserRole {
  SUPER_ADMIN = "super_admin",
  ADMIN = "admin",
  USER = "user",
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: any; // Firestore Timestamp
  updatedAt: any; // Firestore Timestamp
}

export interface InventoryItem {
  id?: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  supplier?: string;
  price: number;
  quantity: number;
  measurementUnit?: MeasurementUnit;
  sellingUnitQuantity?: number;
  sellingMeasures?: SellingMeasure[];
  purchaseCost?: number;
  purchaseQuantity?: number;
  baseUnitCost?: number;
  markupPercent?: number;
  imageUrl: string; // Base64 or preset URL
  color: string;
  size: string; // e.g., '2mm', '6mm', 'Mixed'
  createdAt: any;
  updatedAt: any;
  lastUpdatedBy?: string;
}

export interface InvoiceItem {
  sku: string;
  name: string;
  price: number;
  originalPrice?: number;
  discountPercent?: number;
  quantity: number;
  measurementUnit?: MeasurementUnit;
  sellingUnitQuantity?: number;
  pricingKey?: string;
  imageUrl: string;
}

export type MeasurementUnit = "pc" | "ml" | "grams";

export interface SellingMeasure {
  quantity: number;
  markupPercent: number;
  price: number;
}

export type StockHistoryAction = "created" | "stock_added" | "stock_removed" | "updated";

export interface StockHistoryEntry {
  id?: string;
  sku: string;
  itemName: string;
  imageUrl: string;
  action: StockHistoryAction;
  previousQuantity: number;
  newQuantity: number;
  quantityChange: number;
  measurementUnit: MeasurementUnit;
  createdBy: string;
  createdAt: any;
}

export enum PaymentStatus {
  UNPAID = "Unpaid",
  PARTIALLY_PAID = "Partially Paid",
  PAID = "Paid",
  CANCELLED = "Cancelled",
}

export enum ShippingStatus {
  PENDING = "Pending",
  SHIPPED = "Shipped",
  DELIVERED = "Delivered",
}

export enum InvoiceStatus {
  DRAFT = "Draft",
  CONFIRMED = "Confirmed",
  PENDING = "Pending",
  SENT = "Sent",
  COMPLETED = "Completed",
  CANCELLED = "Cancelled",
}

export interface Invoice {
  id?: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  customerFacebookName?: string;
  items: InvoiceItem[];
  totalAmount: number;
  amountPaid?: number;
  previousBalance?: number;
  paymentStatus: PaymentStatus;
  paymentMethod: string; // GCash, Bank Transfer, Cash, Card
  createdById: string;
  createdByEmail: string;
  createdAt: any;
  updatedAt: any;
  shippingStatus?: ShippingStatus;
  invoiceStatus?: InvoiceStatus;
  description?: string;
  orderPhotoDataUrl?: string;
}

export interface Customer {
  id?: string;
  name: string;
  email: string;
  phone: string;
  facebookName?: string;
  tier: "Standard" | "VIP" | "Platinum" | "Wholesaler";
  notes?: string;
  createdAt: any;
  updatedAt: any;
}

export interface ShopSettings {
  shopName: string;
  gcashNumber: string;
  gcashName: string;
  bankDetails: string;
  paymentMethods?: PaymentMethod[];
  chatTemplate: string;
  updatedBy: string;
  updatedAt: any;
}

export interface PaymentMethod {
  id: "gcash" | "maya" | "maribank" | "bpi";
  label: string;
  accountNumber: string;
  accountName: string;
  qrCodeDataUrl?: string;
}
