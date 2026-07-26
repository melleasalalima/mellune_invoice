/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { collection, onSnapshot, doc, setDoc, query, orderBy, serverTimestamp, getDocs } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { Customer, InventoryItem, Invoice, InvoiceItem, PaymentStatus, UserProfile, UserRole, ShippingStatus, InvoiceStatus } from "../types";
import { calculateMeasuredLineTotal, formatMeasuredQuantity, formatSellingMeasure, getMeasurementLabel, getSellingUnitQuantity } from "../lib/units";
import { Plus, Search, Trash2, User, Phone, Mail, Check, AlertTriangle, Layers, ChevronDown, Camera, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import ImageCropper from "./ImageCropper";

interface InvoicingProps {
  userProfile: UserProfile;
  onInvoiceCreated: (invoiceId: string) => void;
  editingInvoice?: Invoice | null;
  onCancelEdit?: () => void;
}

export default function Invoicing({ userProfile, onInvoiceCreated, editingInvoice, onCancelEdit }: InvoicingProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Customer State
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerFacebookName, setCustomerFacebookName] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showCustDropdown, setShowCustDropdown] = useState(false);

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

  // Transaction Lines
  const [addedItems, setAddedItems] = useState<InvoiceItem[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("GCash");
  const [amountPaid, setAmountPaid] = useState(0);
  const [previousBalance, setPreviousBalance] = useState(0);
  const [shippingStatus, setShippingStatus] = useState<ShippingStatus>(ShippingStatus.PENDING);
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus>(InvoiceStatus.CONFIRMED);
  const [description, setDescription] = useState("");
  const [orderPhotoDataUrl, setOrderPhotoDataUrl] = useState("");
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [pendingPhotoCrop, setPendingPhotoCrop] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const isEditing = Boolean(editingInvoice?.id);
  const canEditInvoices = userProfile.role === UserRole.SUPER_ADMIN || userProfile.role === UserRole.ADMIN;
  const originalQuantityBySku = (editingInvoice?.items || []).reduce<Record<string, number>>((totals, item) => {
    totals[item.sku] = (totals[item.sku] || 0) + item.quantity;
    return totals;
  }, {});

  // Catalog Picker Search
  const [productQuery, setProductQuery] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("all");
  const [catalogStock, setCatalogStock] = useState<"all" | "available" | "low">("all");
  const [selectedSellingMeasure, setSelectedSellingMeasure] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!editingInvoice) return;
    if (!canEditInvoices) {
      showAlert("Privilege Restriction", "Only Super Admins and Admins can edit existing invoices.");
      onCancelEdit?.();
      return;
    }

    setCustomerName(editingInvoice.customerName);
    setCustomerPhone(editingInvoice.customerPhone || "");
    setCustomerEmail(editingInvoice.customerEmail || "");
    setCustomerFacebookName(editingInvoice.customerFacebookName || "");
    setAddedItems(editingInvoice.items.map((item) => ({
      ...item,
      pricingKey: item.pricingKey || createLineId(item.sku),
    })));
    setSelectedPaymentMethod(editingInvoice.paymentMethod || "GCash");
    setAmountPaid(
      editingInvoice.amountPaid ??
      (editingInvoice.paymentStatus === PaymentStatus.PAID ? editingInvoice.totalAmount : 0)
    );
    setPreviousBalance(editingInvoice.previousBalance || 0);
    setShippingStatus(editingInvoice.shippingStatus || ShippingStatus.PENDING);
    setInvoiceStatus(editingInvoice.invoiceStatus || InvoiceStatus.PENDING);
    setDescription(editingInvoice.description || "");
    setOrderPhotoDataUrl(editingInvoice.orderPhotoDataUrl || "");
  }, [editingInvoice?.id]);

  // Sync Customers directory
  useEffect(() => {
    const q = query(collection(db, "customers"), orderBy("name", "asc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Customer[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as Customer);
        });
        setCustomers(list);
      },
      (err) => {
        console.error("Non-blocking fail loading customers list in checkout:", err);
      }
    );
    return () => unsubscribe();
  }, []);

  // Sync products
  useEffect(() => {
    const q = query(collection(db, "inventory"), orderBy("sku", "asc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const itemData: InventoryItem[] = [];
        snapshot.forEach((doc) => {
          itemData.push({ id: doc.id, ...doc.data() } as InventoryItem);
        });
        setInventory(itemData);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        try {
          handleFirestoreError(err, OperationType.GET, "inventory");
        } catch (wrappedError: any) {
          setError(wrappedError.message);
        }
      }
    );

    return () => unsubscribe();
  }, []);

  const getItemSellingMeasures = (item: InventoryItem) =>
    item.sellingMeasures?.length
      ? item.sellingMeasures
      : [{
          quantity: getSellingUnitQuantity(item.sellingUnitQuantity),
          markupPercent: item.markupPercent || 0,
          price: item.price,
        }];

  const createLineId = (sku: string) =>
    `${sku}:${typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

  const handleAddItemToInvoice = (catalogItem: InventoryItem) => {
    if (catalogItem.quantity <= 0) {
      showAlert("Out of Stock", "This item is currently out of stock!");
      return;
    }

    const measures = getItemSellingMeasures(catalogItem);
    const selectedIndex = selectedSellingMeasure[catalogItem.sku] || 0;
    const selectedMeasure = measures[selectedIndex] || measures[0];
    const sellingIncrement = getSellingUnitQuantity(selectedMeasure.quantity);
    const quantityAlreadySelected = addedItems
      .filter((item) => item.sku === catalogItem.sku)
      .reduce((total, item) => total + item.quantity, 0);
    const availableQuantity = catalogItem.quantity + (originalQuantityBySku[catalogItem.sku] || 0);
    if (quantityAlreadySelected + sellingIncrement > availableQuantity) {
      showAlert("Stock Bounds", `Cannot add more. Only ${formatMeasuredQuantity(availableQuantity, catalogItem.measurementUnit)} is available for this invoice.`);
      return;
    }
    setAddedItems((items) => [
        ...items,
        {
          sku: catalogItem.sku,
          name: catalogItem.name,
          price: selectedMeasure.price,
          originalPrice: selectedMeasure.price,
          discountPercent: 0,
          quantity: sellingIncrement,
          measurementUnit: catalogItem.measurementUnit || "pc",
          sellingUnitQuantity: sellingIncrement,
          pricingKey: createLineId(catalogItem.sku),
          imageUrl: catalogItem.imageUrl,
        },
      ]);
  };

  const handleUpdateLineQty = (pricingKey: string, sku: string, newQty: number) => {
    const originalItem = inventory.find((i) => i.sku === sku);
    if (!originalItem) return;

    const normalizedQty = Math.round(newQty * 1000) / 1000;

    if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
      handleRemoveLine(pricingKey);
      return;
    }

    const quantityOnOtherLines = addedItems
      .filter((item) => item.sku === sku && item.pricingKey !== pricingKey)
      .reduce((total, item) => total + item.quantity, 0);

    const availableQuantity = originalItem.quantity + (originalQuantityBySku[sku] || 0);
    if (normalizedQty + quantityOnOtherLines > availableQuantity) {
      showAlert("Insufficient Stock", `Only ${formatMeasuredQuantity(availableQuantity, originalItem.measurementUnit)} of ${originalItem.name} is available for this invoice.`);
      return;
    }

    setAddedItems(
      addedItems.map((i) => (i.pricingKey === pricingKey ? { ...i, quantity: normalizedQty } : i))
    );
  };

  const handleRemoveLine = (pricingKey: string) => {
    setAddedItems(addedItems.filter((i) => i.pricingKey !== pricingKey));
  };

  const handleLineDiscount = (pricingKey: string, discount: number) => {
    const value = Math.min(100, Math.max(0, Number.isFinite(discount) ? discount : 0));
    setAddedItems((items) => items.map((item) => {
      if (item.pricingKey !== pricingKey) return item;
      const originalPrice = item.originalPrice ?? item.price;
      return { ...item, originalPrice, discountPercent: value, price: Math.round(originalPrice * (1 - value / 100) * 100) / 100 };
    }));
  };

  const handleLinePrice = (pricingKey: string, price: number) => {
    const value = Math.max(0, Number.isFinite(price) ? price : 0);
    setAddedItems((items) => items.map((item) => {
      if (item.pricingKey !== pricingKey) return item;
      const originalPrice = item.originalPrice ?? item.price;
      const discountPercent = originalPrice > 0 ? Math.max(0, Math.min(100, Math.round((1 - value / originalPrice) * 10000) / 100)) : 0;
      return { ...item, originalPrice, price: value, discountPercent };
    }));
  };

  const handleOrderPhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showAlert("Unsupported File", "Please select or take an image.");
      return;
    }

    setPhotoProcessing(true);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image processing is unavailable.");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setPendingPhotoCrop(canvas.toDataURL("image/jpeg", 0.9));
      } catch (photoError: any) {
        showAlert("Photo Error", photoError?.message || "The photo could not be processed.");
      } finally {
        URL.revokeObjectURL(image.src);
        setPhotoProcessing(false);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(image.src);
      setPhotoProcessing(false);
      showAlert("Photo Error", "This image format could not be opened. Please try a JPG or PNG photo.");
    };
    image.src = URL.createObjectURL(file);
  };

  const handlePhotoInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleOrderPhoto(event.target.files?.[0]);
    event.target.value = "";
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  };

  const openCamera = async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      showAlert(
        "Camera Unavailable",
        "Live camera access requires HTTPS or localhost. You can still use Choose Gallery to attach a photo."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
        }
      });
    } catch (cameraAccessError: any) {
      const message =
        cameraAccessError?.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in your browser settings and try again."
          : cameraAccessError?.name === "NotFoundError"
          ? "No camera was found on this device."
          : "The camera could not be started. Make sure no other app is using it.";
      setCameraError(message);
      showAlert("Camera Error", message);
    }
  };

  const captureCameraPhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("The camera is still loading. Please wait a moment and try again.");
      return;
    }

    const scale = Math.min(1, 1200 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("The photo could not be captured in this browser.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPendingPhotoCrop(canvas.toDataURL("image/jpeg", 0.9));
    stopCamera();
  };

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const totalAmount = addedItems.reduce(
    (acc, curr) => acc + calculateMeasuredLineTotal(curr.price, curr.quantity, curr.sellingUnitQuantity),
    0
  );
  const normalizedAmountPaid = Math.max(0, Number.isFinite(amountPaid) ? amountPaid : 0);
  const normalizedPreviousBalance = Math.max(0, Number.isFinite(previousBalance) ? previousBalance : 0);
  const amountDue = totalAmount + normalizedPreviousBalance;
  const balanceAmount = amountDue - normalizedAmountPaid;
  const calculatedPaymentStatus =
    normalizedAmountPaid <= 0
      ? PaymentStatus.UNPAID
      : normalizedAmountPaid < amountDue
        ? PaymentStatus.PARTIALLY_PAID
        : PaymentStatus.PAID;

  const handleGenerateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customerName.trim()) {
      showAlert("Required Field", "Customer Name is required.");
      return;
    }

    if (addedItems.length === 0) {
      showAlert("Empty Basket", "Invoice list must contain at least one bead item.");
      return;
    }

    setLoading(true);
    try {
      if (isEditing && !canEditInvoices) {
        showAlert("Privilege Restriction", "Only Super Admins and Admins can edit existing invoices.");
        return;
      }

      let invoiceNum = editingInvoice?.invoiceNumber;
      if (!invoiceNum) {
        const invoiceSnapshot = await getDocs(collection(db, "invoices"));
        const seqIndex = invoiceSnapshot.size + 1001;
        invoiceNum = `INV-${seqIndex}`;
      }

      const generatedDocId = editingInvoice?.id || `inv_${Date.now()}`;
      const normalizedCustomerId = customerEmail.trim()
        ? `cust_${customerEmail.trim().toLowerCase().replace(/[^a-z0-9]/g, "")}`
        : customerPhone.trim()
        ? `cust_${customerPhone.replace(/\D/g, "")}`
        : `cust_${customerName.trim().toLowerCase().replace(/[^a-z0-9]/g, "")}`;

      // Persist a customer record whenever a new invoice is created with a name.
      await setDoc(
        doc(db, "customers", normalizedCustomerId),
        {
          name: customerName.trim(),
          email: customerEmail.trim(),
          phone: customerPhone.trim(),
          facebookName: customerFacebookName.trim(),
          tier: "Standard",
          notes: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // 2. Format details
      const newInvoice: Omit<Invoice, "id"> = {
        invoiceNumber: invoiceNum,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || "",
        customerEmail: customerEmail.trim() || "",
        customerFacebookName: customerFacebookName.trim() || "",
        items: addedItems,
        totalAmount: totalAmount,
        amountPaid: normalizedAmountPaid,
        previousBalance: normalizedPreviousBalance,
        paymentStatus: editingInvoice?.paymentStatus === PaymentStatus.CANCELLED
          ? PaymentStatus.CANCELLED
          : calculatedPaymentStatus,
        paymentMethod: selectedPaymentMethod,
        createdById: editingInvoice?.createdById || userProfile.uid,
        createdByEmail: editingInvoice?.createdByEmail || userProfile.email,
        createdAt: editingInvoice?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
        shippingStatus: shippingStatus,
        invoiceStatus: invoiceStatus,
        description: description.trim() || `Order compiled of ${addedItems.length} styles of handmade beads.`,
        ...(orderPhotoDataUrl ? { orderPhotoDataUrl } : {}),
      };

      // 3. Write invoice
      await setDoc(doc(db, "invoices", generatedDocId), newInvoice);

      // 4. Update the remaining stock quantity for each SKU in background
      const quantityBySku = addedItems.reduce<Record<string, number>>((totals, lineItem) => {
        totals[lineItem.sku] = (totals[lineItem.sku] || 0) + lineItem.quantity;
        return totals;
      }, {});

      const affectedSkus = Array.from(new Set([
        ...Object.keys(originalQuantityBySku),
        ...Object.keys(quantityBySku),
      ]));
      const updatePromises = affectedSkus.map(async (sku) => {
        const correspondingInventoryItem = inventory.find((i) => i.sku === sku);
        if (correspondingInventoryItem && correspondingInventoryItem.id) {
          const invRef = doc(db, "inventory", correspondingInventoryItem.id);
          const originalSoldQuantity = originalQuantityBySku[sku] || 0;
          const revisedSoldQuantity = quantityBySku[sku] || 0;
          const newStockQty = correspondingInventoryItem.quantity + originalSoldQuantity - revisedSoldQuantity;
          if (newStockQty < 0) {
            throw new Error(`Insufficient stock for ${correspondingInventoryItem.name}.`);
          }
          await setDoc(invRef, {
            ...correspondingInventoryItem,
            quantity: newStockQty,
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }
      });
      await Promise.all(updatePromises);

      // 5. Navigate / callbacks
      onInvoiceCreated(generatedDocId);

    } catch (err: any) {
      console.error(err);
      try {
        handleFirestoreError(err, OperationType.WRITE, "invoices");
      } catch (wrappedError: any) {
        setError(wrappedError.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Filter searchable list of catalogs
  const catalogCategories = Array.from<string>(
    new Set<string>(inventory.map((item) => item.category).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const filteredCatalog = inventory.filter((item) => {
    const matchesQuery = !productQuery || (
      item.name.toLowerCase().includes(productQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(productQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(productQuery.toLowerCase())
    );
    const matchesCategory = catalogCategory === "all" || item.category === catalogCategory;
    const matchesStock =
      catalogStock === "all" ||
      (catalogStock === "available" && item.quantity > 0) ||
      (catalogStock === "low" && item.quantity > 0 && item.quantity <= 15);

    return matchesQuery && matchesCategory && matchesStock;
  });

  return (
    <>
      <div className="w-full">
      <div className="mb-6">
        <h2 className="text-xl font-display font-black text-slate-900 flex items-center gap-2">
          <Layers className="w-5.5 h-5.5 text-[#f43f5e]" />
          {isEditing ? `Edit ${editingInvoice?.invoiceNumber}` : "Create Bead Invoice"}
        </h2>
        <p className="text-slate-500 text-xs mt-0.5">
          {isEditing
            ? "Revise invoice items, quantities, prices, customer details, and statuses."
            : "Draft order forms, add items, compute totals, and immediately print receipt PDFs."}
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-rose-50 border border-rose-100 p-4 text-xs font-mono rounded-2xl text-rose-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 xl:gap-5 items-start">
        {/* Right Column: catalog selection list & SKU details */}
        <div className="order-2 lg:col-span-5 bg-white border border-slate-200 rounded-3xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-black text-xs text-slate-805 uppercase tracking-wider flex items-center gap-2">
              📿 Beads Catalog Selector
            </h3>
            <span className="text-[10px] font-mono text-slate-500 font-bold bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
              {filteredCatalog.length} of {inventory.length}
            </span>
          </div>

          {/* Catalog Search input */}
          <div className="relative mb-3">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search catalog... e.g. red seed, Acrylic Star"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-205 outline-none text-slate-800 rounded-xl text-xs leading-relaxed focus:bg-white focus:border-rose-400 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 mb-5">
            <select
              value={catalogCategory}
              onChange={(event) => setCatalogCategory(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold text-slate-700 outline-none transition-colors focus:border-rose-400 focus:bg-white"
              aria-label="Filter catalog by category"
            >
              <option value="all">All categories</option>
              {catalogCategories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <select
              value={catalogStock}
              onChange={(event) => setCatalogStock(event.target.value as "all" | "available" | "low")}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold text-slate-700 outline-none transition-colors focus:border-rose-400 focus:bg-white"
              aria-label="Filter catalog by stock"
            >
              <option value="all">All stock</option>
              <option value="available">Available only</option>
              <option value="low">Low stock</option>
            </select>
          </div>

          {/* Interactive catalog items scrollbox */}
          <div className="h-[432px] overflow-y-auto space-y-2.5 pr-1.5 custom-scrollbar">
            {loading ? (
              [1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse bg-slate-50 rounded-xl" />
              ))
            ) : filteredCatalog.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                No bead inventory matching search query. <br /> Check active terms or register new SKU stock in inventory.
              </div>
            ) : (
              filteredCatalog.map((p) => {
                const isOutOfStock = p.quantity === 0;
                const measures = getItemSellingMeasures(p);
                const selectedIndex = selectedSellingMeasure[p.sku] || 0;
                const activeMeasure = measures[selectedIndex] || measures[0];
                const isAdded = addedItems.some((line) =>
                  line.sku === p.sku &&
                  getSellingUnitQuantity(line.sellingUnitQuantity) === getSellingUnitQuantity(activeMeasure.quantity) &&
                  (line.originalPrice ?? line.price) === activeMeasure.price
                );
                const selectedCount = addedItems.filter((line) => line.sku === p.sku).length;

                return (
                  <motion.div
                    key={p.id}
                    onClick={() => !isOutOfStock && handleAddItemToInvoice(p)}
                    whileTap={isOutOfStock ? undefined : { scale: 0.992 }}
                    transition={{ duration: 0.12 }}
                    className={`border rounded-2xl p-2.5 flex items-center justify-between transition-colors duration-150 relative cursor-pointer ${
                      isOutOfStock
                        ? "bg-slate-50 opacity-55 border-slate-200 cursor-not-allowed select-none"
                        : selectedCount > 0
                          ? "bg-rose-50/35 border-rose-200 hover:bg-rose-50/70 hover:border-rose-300"
                          : "bg-white border-slate-200 hover:bg-slate-50 hover:border-rose-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* SKU Picture inside Creator - CRITICAL REQUIREMENT */}
                      <div className="w-12 h-12 bg-slate-50 border border-slate-200 rounded-xl p-1.5 flex items-center justify-center shrink-0">
                        <img
                          src={p.imageUrl}
                          alt={p.sku}
                          referrerPolicy="no-referrer"
                          className="max-h-full max-w-full object-contain filter drop-shadow-2xs"
                        />
                      </div>
                      
                      <div>
                        <div className="font-mono text-[9px] text-slate-400 font-semibold uppercase tracking-wider">
                          SKU: {p.sku} • {p.size || "Standard"}
                        </div>
                        <h4 className="font-display font-bold text-slate-800 text-xs mt-0.5">
                          {p.name}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] font-bold text-slate-900">₱{activeMeasure.price.toFixed(2)} / {formatSellingMeasure(activeMeasure.quantity, p.measurementUnit)}</span>
                          <span className={`text-[9.5px] font-mono ${p.quantity <= 15 ? "text-rose-500 font-bold" : "text-slate-450"}`}>
                            ({p.quantity <= 0 ? "Out of Stock" : `${formatMeasuredQuantity(p.quantity, p.measurementUnit)} left`})
                          </span>
                        </div>
                        {measures.length > 1 && (
                          <select
                            value={selectedIndex}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              setSelectedSellingMeasure((current) => ({
                                ...current,
                                [p.sku]: Number(e.target.value),
                              }));
                            }}
                            className="mt-1.5 max-w-48 px-2 py-1 border border-slate-200 bg-white rounded-lg text-[9.5px] font-mono text-slate-700 outline-none"
                            aria-label={`Selling measure for ${p.name}`}
                          >
                            {measures.map((measure, index) => (
                              <option key={`${measure.quantity}-${measure.price}-${index}`} value={index}>
                                {formatSellingMeasure(measure.quantity, p.measurementUnit)} - ₱{measure.price.toFixed(2)}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 pr-1">
                      {isOutOfStock ? (
                        <span className="text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-lg">
                          Sold Out
                        </span>
                      ) : isAdded ? (
                        <span className="py-1 px-2.5 bg-rose-500 text-white border border-rose-500 shadow-sm shadow-rose-200 rounded-lg flex items-center gap-1.5 text-[9.5px] font-bold">
                          <Plus className="w-3 h-3" />
                          Add another
                          <span className="min-w-4 h-4 px-1 rounded-full bg-white/20 flex items-center justify-center font-mono">
                            {selectedCount}
                          </span>
                        </span>
                      ) : (
                        <span className="py-1 px-2.5 text-[9.5px] font-bold text-slate-750 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors">
                          + Add
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

        {/* Left Column: Checkout Invoice Form Sheet */}
        <div className="order-1 lg:col-span-7 flex flex-col gap-6">
          {/* Customer parameters form */}
          <form onSubmit={handleGenerateInvoice} className="bg-[#18181b] text-zinc-100 border border-zinc-800 rounded-3xl p-5 md:p-6 shadow-md">
            <h3 className="font-display font-black text-xs text-rose-400 uppercase tracking-widest mb-4 flex items-center gap-2 select-none">
              📋 Invoice Checkout details
            </h3>

            <div className="space-y-4">
              {/* Cust Name */}
              <div className="relative">
                <div className="flex justify-between items-center mb-1 select-none">
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 tracking-wider">Customer Name *</label>
                  {customers.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowCustDropdown(!showCustDropdown)}
                      className="text-[10px] text-rose-400 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      Browse Customers <ChevronDown className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    type="text"
                    required
                    placeholder="Jane Doe"
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      setShowCustDropdown(true);
                    }}
                    onFocus={() => setShowCustDropdown(true)}
                    className="w-full pl-9 pr-3 py-2 bg-zinc-800 border border-zinc-700 text-white rounded-xl text-xs outline-none focus:border-rose-450 transition-colors"
                  />
                </div>

                {/* Autocomplete Dropdown list */}
                {showCustDropdown && customers.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl max-h-44 overflow-y-auto z-[90] divide-y divide-zinc-800">
                    <div className="flex justify-between items-center px-3 py-1.5 bg-zinc-950 text-slate-400 text-[10px] uppercase font-bold select-none sticky top-0">
                      <span>Matching Customers</span>
                      <button 
                        type="button" 
                        onClick={() => setShowCustDropdown(false)}
                        className="text-slate-400 hover:text-white"
                      >
                        Close
                      </button>
                    </div>
                    {customers
                      .filter(cust => !customerName || cust.name.toLowerCase().includes(customerName.toLowerCase()))
                      .map(cust => (
                        <div 
                          key={cust.id} 
                          onClick={() => {
                            setCustomerName(cust.name);
                            setCustomerPhone(cust.phone || "");
                            setCustomerEmail(cust.email || "");
                            setCustomerFacebookName(cust.facebookName || "");
                            setShowCustDropdown(false);
                          }}
                          className="px-3.5 py-2 hover:bg-zinc-800/80 cursor-pointer text-left transition-colors"
                        >
                          <div className="font-bold text-zinc-100 text-xs flex items-center justify-between">
                            <span>{cust.name}</span>
                            <span className="text-[9px] bg-zinc-800 border border-zinc-700 text-rose-400 px-1.5 py-0.2 rounded font-mono">
                              {cust.tier}
                            </span>
                          </div>
                          <div className="text-[10px] text-zinc-400 font-mono mt-0.5 flex gap-2">
                            {cust.phone && <span>📞 {cust.phone}</span>}
                            {cust.email && <span>✉️ {cust.email}</span>}
                          </div>
                        </div>
                      ))}
                    {customers.filter(cust => !customerName || cust.name.toLowerCase().includes(customerName.toLowerCase())).length === 0 && (
                      <div className="px-3.5 py-3 text-zinc-500 text-center text-[11px] font-mono">
                        No matches. Type name to draft.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Phone & Email */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1 tracking-wider">Contact Phone</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                    <input
                      type="tel"
                      placeholder="0917-XXX-XXXX"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full pl-8.5 pr-3 py-2 bg-zinc-800 border border-zinc-700 text-white rounded-xl text-xs outline-none focus:border-rose-450 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1 tracking-wider">Email (Optional)</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                    <input
                      type="email"
                      placeholder="jane@gmail.com"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className="w-full pl-8.5 pr-3 py-2 bg-zinc-800 border border-zinc-700 text-white rounded-xl text-xs outline-none focus:border-rose-450 transition-colors"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1 tracking-wider">FB / IG Name (Optional)</label>
                <input
                  type="text"
                  placeholder="Customer's Facebook or Instagram name"
                  value={customerFacebookName}
                  onChange={(e) => setCustomerFacebookName(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white rounded-xl text-xs outline-none focus:border-rose-450 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <label className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                  Previous Balance
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={previousBalance}
                    onChange={(e) => setPreviousBalance(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-bold text-white outline-none focus:border-rose-500"
                  />
                </label>
                <label className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                  Downpayment / Paid
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountPaid}
                    onChange={(e) => setAmountPaid(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-bold text-white outline-none focus:border-rose-500"
                  />
                </label>
                <div className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-500">Total Due</span>
                  <span className="mt-1 block text-xs font-bold text-white">₱{amountDue.toFixed(2)}</span>
                </div>
                <div className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-500">Balance</span>
                  <span className={`mt-1 block text-xs font-bold ${balanceAmount > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                    ₱{balanceAmount.toFixed(2)}
                  </span>
                </div>
                <div className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-500">Payment</span>
                  <span className="mt-1 block text-[10px] font-bold text-rose-300">{calculatedPaymentStatus}</span>
                </div>
              </div>

              {/* Shipping Status Selection */}
              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1 tracking-wider">Shipping Status</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: ShippingStatus.PENDING, label: "Pending" },
                    { value: ShippingStatus.SHIPPED, label: "Shipped" },
                    { value: ShippingStatus.DELIVERED, label: "Delivered" }
                  ].map((statusOpt) => (
                    <button
                      key={statusOpt.value}
                      type="button"
                      onClick={() => setShippingStatus(statusOpt.value)}
                      className={`py-1.5 px-2 border rounded-xl text-[10px] font-bold text-center cursor-pointer transition-all ${
                        shippingStatus === statusOpt.value
                          ? "bg-rose-500 border-rose-600 text-white shadow-xs"
                          : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white"
                      }`}
                    >
                      {statusOpt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Invoice Status Selection */}
              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1 tracking-wider">Invoice Status</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { value: InvoiceStatus.DRAFT, label: "Draft" },
                    { value: InvoiceStatus.CONFIRMED, label: "Confirm" },
                    { value: InvoiceStatus.COMPLETED, label: "Done" },
                    { value: InvoiceStatus.CANCELLED, label: "Void" }
                  ].map((statusOpt) => (
                    <button
                      key={statusOpt.value}
                      type="button"
                      onClick={() => setInvoiceStatus(statusOpt.value)}
                      className={`py-1.5 px-1 border rounded-xl text-[10px] font-bold text-center cursor-pointer transition-all ${
                        invoiceStatus === statusOpt.value
                          ? "bg-rose-500 border-rose-600 text-white shadow-xs"
                          : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white"
                      }`}
                    >
                      {statusOpt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description Input */}
              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1 tracking-wider">Description / Custom Notes</label>
                <textarea
                  placeholder="Additional order specifics, custom bracelet patterns, beads sizing notes or packaging options..."
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white rounded-xl text-xs outline-none focus:border-rose-450 transition-colors resize-none placeholder-zinc-500 leading-normal"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1 tracking-wider">Customer Order Photo</label>
                {orderPhotoDataUrl ? (
                  <div className="relative overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900">
                    <img src={orderPhotoDataUrl} alt="Customer order" className="h-48 w-full object-contain" />
                    <button type="button" onClick={() => setOrderPhotoDataUrl("")} className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white" title="Remove photo">
                      <X className="h-4 w-4" />
                    </button>
                    <div className="grid grid-cols-2 gap-2 border-t border-zinc-700 p-2">
                      <button type="button" onClick={openCamera} className="rounded-lg bg-zinc-800 px-2 py-2 text-[10px] font-bold text-white hover:bg-zinc-700">Retake</button>
                      <button type="button" onClick={() => galleryInputRef.current?.click()} className="rounded-lg bg-zinc-800 px-2 py-2 text-[10px] font-bold text-white hover:bg-zinc-700">Replace</button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-600 bg-zinc-800/60 p-3">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="rounded-xl bg-rose-500/15 p-2.5 text-rose-400"><Camera className="h-5 w-5" /></div>
                      <div>
                        <p className="text-xs font-bold text-white">Add an order photo</p>
                        <p className="text-[9px] text-zinc-500">Take a new photo or select one already saved.</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" disabled={photoProcessing} onClick={openCamera} className="rounded-xl bg-rose-500 px-3 py-2.5 text-[10px] font-bold text-white hover:bg-rose-400 disabled:opacity-50">
                        {photoProcessing ? "Processing..." : "Open Camera"}
                      </button>
                      <button type="button" disabled={photoProcessing} onClick={() => galleryInputRef.current?.click()} className="rounded-xl border border-zinc-600 bg-zinc-800 px-3 py-2.5 text-[10px] font-bold text-zinc-200 hover:bg-zinc-700 disabled:opacity-50">
                        Choose Gallery
                      </button>
                    </div>
                  </div>
                )}
                <input ref={galleryInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoInputChange} />
                <p className="mt-1 text-[9px] text-zinc-500">Compressed and attached to the customer invoice.</p>
              </div>
            </div>

            {/* Added lines items review list */}
            <div className="mt-6 pt-5 border-t border-zinc-800">
              <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-2 tracking-wider">Selected Bead lines ({addedItems.length})</label>
              
              {addedItems.length === 0 ? (
                <div className="text-center py-6 text-xs text-zinc-500 font-mono">
                  No line items selected yet. Tap products on the left catalog to start.
                </div>
              ) : (
                <motion.div layout className="max-h-80 overflow-y-auto space-y-2 pr-1">
                  <AnimatePresence initial={false}>
                  {addedItems.map((line, index) => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, x: 24, scale: 0.97 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: 20, scale: 0.96 }}
                      transition={{ type: "spring", stiffness: 420, damping: 32 }}
                      key={line.pricingKey || `${line.sku}-${line.sellingUnitQuantity}`}
                      className="rounded-2xl border border-zinc-700/70 bg-gradient-to-br from-zinc-800/90 to-zinc-900/75 p-3 text-xs shadow-lg shadow-black/10 hover:border-zinc-600 transition-colors"
                    >
                      <div className="flex items-start gap-2.5">
                        {/* Selected SKU Image indicator - CRITICAL */}
                        <img
                          src={line.imageUrl}
                          alt={line.sku}
                          referrerPolicy="no-referrer"
                          className="w-8 h-8 rounded-md bg-zinc-700 p-0.5 object-contain shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-white truncate text-xs">{line.name}</p>
                            <span className="shrink-0 rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-rose-300">
                              Line {index + 1}
                            </span>
                          </div>
                          <span className="text-[9px] text-zinc-500 font-mono">
                            Measured in {getMeasurementLabel(line.measurementUnit)}
                          </span>
                          <p className="text-[10px] text-zinc-400 font-mono">
                            ₱{line.price.toFixed(2)} / {formatSellingMeasure(line.sellingUnitQuantity, line.measurementUnit)}
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="text-[8px] uppercase text-zinc-500">
                              Discount %
                              <input type="number" min="0" max="100" step="0.01" value={line.discountPercent ?? 0} onChange={(e) => handleLineDiscount(line.pricingKey || line.sku, Number(e.target.value))} className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[10px] text-white outline-none focus:border-rose-500" />
                            </label>
                            <label className="text-[8px] uppercase text-zinc-500">
                              Final unit price
                              <input type="number" min="0" step="0.01" value={line.price} onChange={(e) => handleLinePrice(line.pricingKey || line.sku, Number(e.target.value))} className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[10px] text-white outline-none focus:border-rose-500" />
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* Quantity Controls */}
                      <div className="mt-3 flex items-center justify-between border-t border-zinc-700/70 pt-2.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Quantity</span>
                        <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleUpdateLineQty(line.pricingKey || line.sku, line.sku, line.quantity - getSellingUnitQuantity(line.sellingUnitQuantity))}
                          className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-sm"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={getSellingUnitQuantity(line.sellingUnitQuantity)}
                          max={
                            (inventory.find((item) => item.sku === line.sku)?.quantity || 0) +
                            (originalQuantityBySku[line.sku] || 0)
                          }
                          step={getSellingUnitQuantity(line.sellingUnitQuantity)}
                          value={line.quantity}
                          onChange={(e) => handleUpdateLineQty(line.pricingKey || line.sku, line.sku, Number(e.target.value))}
                          className="w-16 px-1 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-center font-mono font-bold text-xs text-rose-400 outline-none focus:border-rose-500"
                          aria-label={`Quantity in ${getMeasurementLabel(line.measurementUnit)}`}
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdateLineQty(line.pricingKey || line.sku, line.sku, line.quantity + getSellingUnitQuantity(line.sellingUnitQuantity))}
                          className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-sm"
                        >
                          +
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRemoveLine(line.pricingKey || line.sku)}
                          className="p-1 text-[#f43f5e] hover:text-rose-500 ml-1.5"
                          title="Remove line"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  </AnimatePresence>
                </motion.div>
              )}
            </div>

            {/* Total checkouts and triggers */}
            <div className="mt-6 pt-5 border-t border-zinc-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest block">Checkout Total</span>
                <span className="text-2xl font-display font-extrabold text-white">
                  ₱{totalAmount.toFixed(2)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isEditing && (
                  <button
                    type="button"
                    onClick={onCancelEdit}
                    className="py-3 px-4 border border-zinc-700 hover:bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={loading || addedItems.length === 0}
                  className="py-3 px-5 bg-rose-500 hover:bg-rose-400 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer disabled:opacity-50 transition-all duration-150"
                >
                  {loading ? "Saving Order..." : isEditing ? "Save Invoice Changes" : "Draft Invoice receipt"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>

    {pendingPhotoCrop && (
      <ImageCropper
        source={pendingPhotoCrop}
        aspect={4 / 3}
        outputWidth={1200}
        title="Crop Order Photo"
        onCancel={() => {
          setPendingPhotoCrop("");
          setPhotoProcessing(false);
        }}
        onComplete={(croppedPhoto) => {
          setOrderPhotoDataUrl(croppedPhoto);
          setPendingPhotoCrop("");
          setPhotoProcessing(false);
        }}
      />
    )}

    {/* Custom Alert/Confirm Dialog Modal */}
    {cameraOpen && (
      <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
        <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-black text-white">Take Order Photo</h3>
              <p className="text-[10px] text-zinc-500">Position the customer order inside the frame.</p>
            </div>
            <button type="button" onClick={stopCamera} className="rounded-full bg-zinc-800 p-2 text-zinc-300 hover:text-white" aria-label="Close camera">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="relative aspect-[4/3] bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-5 rounded-2xl border border-white/30" />
          </div>
          {cameraError && <p className="px-4 pt-3 text-xs text-rose-400">{cameraError}</p>}
          <div className="grid grid-cols-2 gap-3 p-4">
            <button type="button" onClick={stopCamera} className="rounded-xl border border-zinc-700 px-4 py-3 text-xs font-bold text-zinc-300 hover:bg-zinc-800">Cancel</button>
            <button type="button" onClick={captureCameraPhoto} className="flex items-center justify-center gap-2 rounded-xl bg-rose-500 px-4 py-3 text-xs font-bold text-white hover:bg-rose-400">
              <Camera className="h-4 w-4" />
              Capture Photo
            </button>
          </div>
        </div>
      </div>
    )}

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
    </>
  );
}
