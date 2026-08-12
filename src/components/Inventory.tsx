/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp, query, orderBy, where, writeBatch, limit } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { InventoryItem, MeasurementUnit, SellingMeasure, StockHistoryEntry, UserRole, UserProfile } from "../types";
import { BEADS_PRESETS, getPresetSvgDataUrl } from "../lib/beadsData";
import { calculateMeasuredLineTotal, formatMeasuredQuantity, formatSellingMeasure, getMeasurementLabel, getMeasurementStep, MEASUREMENT_UNITS } from "../lib/units";
import { Plus, Search, Trash2, Edit3, Image as ImageIcon, Sparkles, Filter, X, ChevronRight, AlertTriangle, Layers, History, WalletCards, Camera } from "lucide-react";
import ImageCropper from "./ImageCropper";

interface InventoryProps {
  userProfile: UserProfile;
}

const DEFAULT_CATEGORIES = [
  "Acrylic Beads",
  "Glass Beads",
  "Clay Beads",
  "Pearl & Shell",
  "Crystal Beads",
  "Seed Beads",
  "Accessories",
];

const MARKUP_OPTIONS = [30, 40, 50, 60, 80, 100];

type SellingMeasureDraft = {
  id: string;
  quantity: number | "";
  markupPercent: number | "";
  price: number | "";
};

export default function Inventory({ userProfile }: InventoryProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [lowStockFilter, setLowStockFilter] = useState(false);
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);
  const [categoryFilterQuery, setCategoryFilterQuery] = useState("");

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

  // Modal / Form state for Adding/Editing Item
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [stockHistory, setStockHistory] = useState<StockHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // New Item State Fields
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Acrylic Beads");
  const [supplier, setSupplier] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [quantity, setQuantity] = useState<number | "">("");
  const [stockToAdd, setStockToAdd] = useState<number | "">("");
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>("pc");
  const [sellingUnitQuantity, setSellingUnitQuantity] = useState<number | "">(1);
  const [purchaseCost, setPurchaseCost] = useState<number | "">("");
  const [purchaseQuantity, setPurchaseQuantity] = useState<number | "">("");
  const [markupPercent, setMarkupPercent] = useState<number | "">("");
  const [additionalSellingMeasures, setAdditionalSellingMeasures] = useState<SellingMeasureDraft[]>([]);
  const [showMarkupPresets, setShowMarkupPresets] = useState(false);
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [pendingImageCrop, setPendingImageCrop] = useState("");
  const [showInventorySuggestions, setShowInventorySuggestions] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const categoryOptions = useMemo(() => {
    const categoryMap = new Map<string, string>();

    [...DEFAULT_CATEGORIES, ...items.map((item) => item.category)]
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => {
        const key = value.toLocaleLowerCase();
        if (!categoryMap.has(key)) categoryMap.set(key, value);
      });

    return Array.from(categoryMap.values()).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const supplierOptions = useMemo(() => {
    const supplierMap = new Map<string, string>();
    items
      .map((item) => item.supplier?.trim())
      .filter((value): value is string => Boolean(value))
      .forEach((value) => {
        const key = value.toLocaleLowerCase();
        if (!supplierMap.has(key)) supplierMap.set(key, value);
      });
    return Array.from(supplierMap.values()).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const inventorySuggestions = useMemo(() => {
    const term = name.trim().toLocaleLowerCase();
    if (!term || editingItem) return [];

    return items
      .filter((item) =>
        item.name.toLocaleLowerCase().includes(term) ||
        item.sku.toLocaleLowerCase().includes(term) ||
        item.category.toLocaleLowerCase().includes(term)
      )
      .slice(0, 6);
  }, [editingItem, items, name]);

  const quickCategoryFilters = useMemo(() => {
    const quickFilters = ["All", ...categoryOptions.slice(0, 2)];

    if (selectedCategory !== "All" && !quickFilters.includes(selectedCategory)) {
      if (quickFilters.length < 3) {
        quickFilters.push(selectedCategory);
      } else {
        quickFilters[quickFilters.length - 1] = selectedCategory;
      }
    }

    return Array.from(new Set(quickFilters)).slice(0, 3);
  }, [categoryOptions, selectedCategory]);

  const searchableCategories = useMemo(() => {
    const term = categoryFilterQuery.trim().toLocaleLowerCase();
    return categoryOptions.filter((option) => !term || option.toLocaleLowerCase().includes(term));
  }, [categoryFilterQuery, categoryOptions]);

  const hasWriteAccess = userProfile.role === UserRole.SUPER_ADMIN || userProfile.role === UserRole.ADMIN;
  const baseUnitCost =
    purchaseCost !== "" && purchaseQuantity !== "" && purchaseQuantity > 0
      ? Number(purchaseCost) / Number(purchaseQuantity)
      : null;
  const sellingBaseCost =
    baseUnitCost !== null && sellingUnitQuantity !== "" && sellingUnitQuantity > 0
      ? baseUnitCost * Number(sellingUnitQuantity)
      : null;

  useEffect(() => {
    if (markupPercent !== "" && sellingBaseCost !== null) {
      setPrice(Number((sellingBaseCost * (1 + Number(markupPercent) / 100)).toFixed(2)));
    }
  }, [markupPercent, sellingBaseCost]);

  useEffect(() => {
    if (baseUnitCost === null) return;

    setAdditionalSellingMeasures((measures) =>
      measures.map((measure) => {
        if (measure.quantity === "" || measure.markupPercent === "") return measure;
        const calculatedPrice = baseUnitCost * Number(measure.quantity) * (1 + Number(measure.markupPercent) / 100);
        return { ...measure, price: Number(calculatedPrice.toFixed(2)) };
      })
    );
  }, [baseUnitCost]);

  // Real-time Firestore sync
  useEffect(() => {
    // Limit inventory realtime stream to a reasonable window to reduce reads.
    const q = query(collection(db, "inventory"), orderBy("sku", "asc"), limit(500));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const itemData: InventoryItem[] = [];
        snapshot.forEach((doc) => {
          itemData.push({ id: doc.id, ...doc.data() } as InventoryItem);
        });
        setItems(itemData);
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

  useEffect(() => {
    if (!selectedItem) {
      setStockHistory([]);
      return;
    }

    setHistoryLoading(true);
    const historyQuery = query(
      collection(db, "stockHistory"),
      where("sku", "==", selectedItem.sku)
    );
    const unsubscribe = onSnapshot(
      historyQuery,
      (snapshot) => {
        const entries = snapshot.docs
          .map((historyDoc) => ({ id: historyDoc.id, ...historyDoc.data() } as StockHistoryEntry))
          .sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });
        setStockHistory(entries);
        setHistoryLoading(false);
      },
      (err) => {
        console.error("Failed to load stock history:", err);
        setHistoryLoading(false);
      }
    );

    return () => unsubscribe();
  }, [selectedItem]);

  const generateAutoSku = (catName: string) => {
    const catMap: { [key: string]: string } = {
      "Acrylic Beads": "AC",
      "Glass Beads": "GL",
      "Clay Beads": "CY",
      "Pearl & Shell": "PL",
      "Crystal Beads": "CR",
      "Seed Beads": "SD",
      "Accessories": "AX",
    };
    const prefix = catMap[catName] || catName
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "BD";
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const dateCode = `${yy}${mm}${dd}`;
    const highestSequence = items.reduce((highest, item) => {
      const match = item.sku.match(/^BD-[A-Z0-9]+-\d{6}-(\d+)$/i);
      if (!match) return highest;

      const sequence = Number(match[1]);
      return Number.isFinite(sequence) ? Math.max(highest, sequence) : highest;
    }, 0);
    const nextSequence = String(highestSequence + 1).padStart(4, "0");

    return `BD-${prefix}-${dateCode}-${nextSequence}`;
  };

  const resetForm = () => {
    setSku("");
    setName("");
    setDescription("");
    setCategory("Acrylic Beads");
    setSupplier("");
    setPrice("");
    setQuantity("");
    setStockToAdd("");
    setMeasurementUnit("pc");
    setSellingUnitQuantity(1);
    setPurchaseCost("");
    setPurchaseQuantity("");
    setMarkupPercent("");
    setAdditionalSellingMeasures([]);
    setShowMarkupPresets(false);
    setColor("");
    setSize("");
    setImageUrl("");
    setShowInventorySuggestions(false);
    setEditingItem(null);
    setIsFormOpen(false);
  };

  const handleOpenNew = () => {
    resetForm();
    setIsFormOpen(true);
    setSku(generateAutoSku("Acrylic Beads"));
  };

  const handleOpenEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setSku(item.sku);
    setName(item.name);
    setDescription(item.description);
    setCategory(item.category);
    setSupplier(item.supplier || "");
    setPrice(item.price);
    setQuantity(item.quantity);
    setStockToAdd("");
    setMeasurementUnit(item.measurementUnit || "pc");
    setSellingUnitQuantity(item.sellingUnitQuantity || 1);
    setPurchaseCost(item.purchaseCost ?? "");
    setPurchaseQuantity(item.purchaseQuantity ?? "");
    setMarkupPercent(item.markupPercent ?? "");
    setShowMarkupPresets(false);
    setAdditionalSellingMeasures(
      (item.sellingMeasures || [])
        .filter((measure) => measure.quantity !== (item.sellingUnitQuantity || 1) || measure.price !== item.price)
        .map((measure, index) => ({
          id: `${item.id || item.sku}-${index}`,
          quantity: measure.quantity,
          markupPercent: measure.markupPercent,
          price: measure.price,
        }))
    );
    setColor(item.color || "");
    setSize(item.size || "");
    setImageUrl(item.imageUrl || "");
    setShowInventorySuggestions(false);
    setIsFormOpen(true);
  };

  const handleSelectInventorySuggestion = (item: InventoryItem) => {
    handleOpenEdit(item);
  };

  // Pre-fill fields from default Preset item
  const handleSelectPreset = (preset: typeof BEADS_PRESETS[0]) => {
    setSku(preset.sku);
    setName(preset.name);
    setCategory(preset.category);
    setSupplier("");
    setColor(preset.color);
    setSize(preset.size);
    setPrice(preset.price);
    setStockToAdd("");
    setMeasurementUnit("pc");
    setSellingUnitQuantity(1);
    setPurchaseCost("");
    setPurchaseQuantity("");
    setMarkupPercent("");
    setAdditionalSellingMeasures([]);
    setShowMarkupPresets(false);
    setImageUrl(getPresetSvgDataUrl(preset.svgPath, preset.svgColor));
    setDescription(`Exquisite handpicked ${preset.color} beads. Size ${preset.size}.`);
  };

  // Compress image upload and set state
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      return;
    }

    const file = files[0];
    if (!file.type.startsWith("image/")) {
      showAlert("Invalid File", "Please select a valid image file.");
      e.target.value = "";
      return;
    }

    try {
      const reader = new FileReader();
      const source = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      setPendingImageCrop(source);
    } catch (err) {
      console.error("Image loading error", err);
      showAlert("Upload Error", "Failed to process image file.");
    }

    e.target.value = "";
  };

  const openCameraModal = () => {
    setCameraError(null);
    setIsCameraOpen(true);
  };

  const fallbackToFileInput = () => {
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
      cameraInputRef.current.click();
    }
  };

  const closeCameraModal = () => {
    setIsCameraOpen(false);
    setCameraError(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
  };

  const handleCapturePhoto = () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      setCameraError("Unable to capture image. Please try again.");
      return;
    }

    const squareSize = Math.min(width, height);
    const sx = (width - squareSize) / 2;
    const sy = (height - squareSize) / 2;

    const canvas = document.createElement("canvas");
    const targetSize = 400;
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Unable to capture image. Please try again.");
      return;
    }

    ctx.drawImage(video, sx, sy, squareSize, squareSize, 0, 0, targetSize, targetSize);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    setPendingImageCrop(dataUrl);
    closeCameraModal();
  };

  useEffect(() => {
    if (!isCameraOpen) return;

    let active = true;
    let currentStream: MediaStream | null = null;

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera access is not supported by this browser.");
        return;
      }

      const tryGetCamera = async (constraints: MediaStreamConstraints) => {
        return navigator.mediaDevices.getUserMedia(constraints);
      };

      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        };

        let stream: MediaStream;
        try {
          stream = await tryGetCamera(constraints);
        } catch (firstError) {
          console.warn("Primary camera constraints failed, retrying with default video.", firstError);
          stream = await tryGetCamera({ video: true });
        }

        currentStream = stream;
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        setCameraStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((playErr) => {
            console.warn("Video autoplay failed:", playErr);
          });
        }
      } catch (err: any) {
        console.error("Camera access error", err);
        setCameraError(
          err?.message
            ? `Unable to access the camera: ${err.message}`
            : "Unable to access the camera. Please allow camera permission."
        );
      }
    };

    startCamera();

    return () => {
      active = false;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
      setCameraStream(null);
    };
  }, [isCameraOpen]);

  const addSellingMeasure = () => {
    setAdditionalSellingMeasures((measures) => [
      ...measures,
      {
        id: crypto.randomUUID(),
        quantity: "",
        markupPercent: markupPercent === "" ? "" : markupPercent,
        price: "",
      },
    ]);
  };

  const updateSellingMeasure = (
    id: string,
    field: "quantity" | "markupPercent" | "price",
    value: number | ""
  ) => {
    setAdditionalSellingMeasures((measures) =>
      measures.map((measure) => {
        if (measure.id !== id) return measure;

        const updated = { ...measure, [field]: value };
        if (field === "price" && baseUnitCost !== null && updated.quantity !== "" && value !== "") {
          const measureBaseCost = baseUnitCost * Number(updated.quantity);
          updated.markupPercent = measureBaseCost > 0
            ? Number((((Number(value) / measureBaseCost) - 1) * 100).toFixed(2))
            : 0;
        } else if (baseUnitCost !== null && updated.quantity !== "" && updated.markupPercent !== "") {
          updated.price = Number(
            (baseUnitCost * Number(updated.quantity) * (1 + Number(updated.markupPercent) / 100)).toFixed(2)
          );
        } else if (field !== "price") {
          updated.price = "";
        }
        return updated;
      })
    );
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasWriteAccess) return;

    if (!sku || !name || !category.trim() || price === "" || quantity === "") {
      showAlert("Mandatory Fields", "Please fill in all mandatory fields (SKU, Name, Category, Price, Stock).");
      return;
    }

    const hasPartialCosting = (purchaseCost === "") !== (purchaseQuantity === "");
    if (hasPartialCosting || (purchaseQuantity !== "" && purchaseQuantity <= 0)) {
      showAlert("Costing Details", "Enter both the total purchase cost and quantity received to calculate the base cost.");
      return;
    }
    if (sellingUnitQuantity === "" || sellingUnitQuantity <= 0) {
      showAlert("Selling Measure", "Enter the amount sold per price, such as 1 pc, 10 ml, or 25 g.");
      return;
    }
    const hasInvalidAdditionalMeasure = additionalSellingMeasures.some(
      (measure) =>
        measure.quantity === "" ||
        measure.quantity <= 0 ||
        measure.markupPercent === "" ||
        measure.markupPercent < 0 ||
        measure.price === ""
    );
    if (hasInvalidAdditionalMeasure) {
      showAlert("Selling Measures", "Complete the amount and markup for every added selling measure.");
      return;
    }

    const cleanCategory = category.trim();
    const matchedCategory = categoryOptions.find(
      (option) => option.toLocaleLowerCase() === cleanCategory.toLocaleLowerCase()
    );

    const sellingMeasures: SellingMeasure[] = [
      {
        quantity: Number(sellingUnitQuantity),
        markupPercent: Number(markupPercent || 0),
        price: Number(price),
      },
      ...additionalSellingMeasures.map((measure) => ({
        quantity: Number(measure.quantity),
        markupPercent: Number(measure.markupPercent),
        price: Number(measure.price),
      })),
    ];

    const payload: Omit<InventoryItem, "id"> = {
      sku: sku.trim().toUpperCase(),
      name: name.trim(),
      description: description.trim(),
      category: matchedCategory || cleanCategory,
      ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
      price: Number(price),
      quantity: Number(quantity),
      measurementUnit,
      sellingUnitQuantity: Number(sellingUnitQuantity) || 1,
      sellingMeasures,
      color: color.trim() || "Multi",
      size: size.trim() || "Mixed",
      imageUrl: imageUrl || getPresetSvgDataUrl(BEADS_PRESETS[0].svgPath, BEADS_PRESETS[0].svgColor),
      updatedAt: serverTimestamp(),
      createdAt: editingItem ? editingItem.createdAt : serverTimestamp(),
      lastUpdatedBy: userProfile.email,
      ...(purchaseCost !== "" ? { purchaseCost: Number(purchaseCost) } : {}),
      ...(purchaseQuantity !== "" ? { purchaseQuantity: Number(purchaseQuantity) } : {}),
      ...(baseUnitCost !== null ? { baseUnitCost } : {}),
      ...(markupPercent !== "" ? { markupPercent: Number(markupPercent) } : {}),
    };

    // For document IDs we will use the clean encoded SKU name to prevent duplicates
    const finalDocId = sku.trim().replace(/[^a-zA-Z0-9_\-]/g, "_").toUpperCase();

    try {
      const previousQuantity = editingItem?.quantity || 0;
      const newQuantity = Number(quantity);
      const quantityChange = newQuantity - previousQuantity;
      const action: StockHistoryEntry["action"] = !editingItem
        ? "created"
        : quantityChange > 0
        ? "stock_added"
        : quantityChange < 0
        ? "stock_removed"
        : "updated";

      const batch = writeBatch(db);
      batch.set(doc(db, "inventory", finalDocId), payload);
      batch.set(doc(collection(db, "stockHistory")), {
        sku: payload.sku,
        itemName: payload.name,
        imageUrl: payload.imageUrl,
        action,
        previousQuantity,
        newQuantity,
        quantityChange,
        measurementUnit,
        createdBy: userProfile.email,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      resetForm();
    } catch (err: any) {
      setError(err.message || "Failed to update stock item.");
    }
  };

  const handleDeleteItem = (docId: string | undefined) => {
    if (!docId || !hasWriteAccess) return;
    showConfirm(
      "Confirm Delete",
      "Are you sure you want to permanently delete this SKU from inventory?",
      async () => {
        try {
          await deleteDoc(doc(db, "inventory", docId));
        } catch (err: any) {
          setError(err.message || "Failed to delete item.");
        }
      }
    );
  };

  // Load sample set into Firestore directly to instantly kickstart the web workspace
  const handleLoadSampleInventory = async () => {
    if (!hasWriteAccess) return;
    setLoading(true);
    try {
      const promises = BEADS_PRESETS.map((preset) => {
        const finalDocId = preset.sku.replace(/[^a-zA-Z0-9_\-]/g, "_");
        const payload: Omit<InventoryItem, "id"> = {
          sku: preset.sku,
          name: preset.name,
          category: preset.category,
          price: preset.price,
          quantity: Math.floor(Math.random() * 85) + 15,
          measurementUnit: "pc",
          sellingUnitQuantity: 1,
          color: preset.color,
          size: preset.size,
          description: `Gorgeous hand-selected ${preset.name} beads designed for jewelry and customized beads threading.`,
          imageUrl: getPresetSvgDataUrl(preset.svgPath, preset.svgColor),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastUpdatedBy: userProfile.email,
        };
        return setDoc(doc(db, "inventory", finalDocId), payload);
      });
      await Promise.all(promises);
    } catch (err: any) {
      setError(err.message || "Could not seed inventories.");
    } finally {
      setLoading(false);
    }
  };

  // Client Search & Filter Logic
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.color && item.color.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = selectedCategory === "All" || item.category === selectedCategory;
    const matchesLowStock = !lowStockFilter || item.quantity <= 15;

    return matchesSearch && matchesCategory && matchesLowStock;
  });

  // Bento metrics calculation
  const totalAssetVal = items.reduce(
    (sum, item) => sum + calculateMeasuredLineTotal(item.price, item.quantity, item.sellingUnitQuantity),
    0
  );
  const totalInventorySpend = items.reduce(
    (sum, item) => {
      const unitCost = item.baseUnitCost ??
        (item.purchaseCost != null && item.purchaseQuantity
          ? item.purchaseCost / item.purchaseQuantity
          : null);
      return sum + (unitCost == null ? 0 : unitCost * item.quantity);
    },
    0
  );
  const itemsWithPurchaseCost = items.filter(
    (item) =>
      item.baseUnitCost != null ||
      (item.purchaseCost != null && item.purchaseQuantity != null && item.purchaseQuantity > 0)
  ).length;
  const grossProfitPotential = Math.max(0, totalAssetVal - totalInventorySpend);
  const unitTotals = items.reduce<Record<MeasurementUnit, number>>(
    (totals, item) => {
      totals[item.measurementUnit || "pc"] += item.quantity;
      return totals;
    },
    { pc: 0, ml: 0, g: 0 }
  );
  const stockSummary = (Object.keys(unitTotals) as MeasurementUnit[])
    .filter((unit) => unitTotals[unit] > 0)
    .map((unit) => formatMeasuredQuantity(unitTotals[unit], unit))
    .join(" / ");
  const lowStockCount = items.filter((item) => item.quantity <= 15).length;
  
  const activeStockItems = items.filter((item) => item.quantity > 0);
  const lowestStockItem = activeStockItems.length > 0 
    ? [...activeStockItems].sort((a, b) => a.quantity - b.quantity)[0] 
    : null;

  return (
    <div className="w-full">
      {/* Header and Seeds trigger */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-display font-black text-slate-900 flex items-center gap-2">
            <Layers className="w-5.5 h-5.5 text-[#f43f5e]" />
            Beads Catalog &amp; Stock Inventory
          </h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Store, monitor, search and catalog beads sizes, categories, and stock quantities.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {hasWriteAccess && items.length === 0 && (
            <button
              onClick={handleLoadSampleInventory}
              className="py-2.5 px-4 bg-orange-100 hover:bg-orange-200 text-orange-950 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors duration-150"
            >
              <Sparkles className="w-4 h-4 text-orange-600" />
              Load Sample Beads SKU List
            </button>
          )}

          {hasWriteAccess && (
            <button
              onClick={handleOpenNew}
              className="py-2.5 px-5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition-all duration-150"
            >
              <Plus className="w-4 h-4" />
              Add Bead Stock (SKU)
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-rose-50 border border-rose-100 text-rose-700 p-4 rounded-2xl text-xs font-mono">
          {error}
        </div>
      )}

      {/* Bento Statistics Grid Widgets */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        {/* Widget 1: Purchase spend */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex flex-col justify-between shadow-xs text-amber-950 min-h-32">
          <div className="flex justify-between items-center text-amber-800">
            <span className="text-[10px] font-bold font-mono uppercase tracking-wider">Total Inventory Spend</span>
            <WalletCards className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black font-display text-amber-950 leading-none">
              ₱{totalInventorySpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[11px] text-amber-800 font-medium mt-1.5 leading-tight">
              Current stock valued at base cost for <strong>{itemsWithPurchaseCost}</strong> of <strong>{items.length}</strong> SKUs.
              {itemsWithPurchaseCost < items.length && " Add costing details to complete this total."}
            </p>
          </div>
        </div>

        {/* Widget 2: Assets valuation */}
        <div className="bg-emerald-100/80 border border-emerald-250/50 rounded-2xl p-5 flex flex-col justify-between shadow-xs text-emerald-950 min-h-32">
          <div className="flex justify-between items-center text-emerald-800">
            <span className="text-[10px] font-bold font-mono uppercase tracking-wider">Active Inventory Valuation</span>
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black font-display tracking-tight text-emerald-900 leading-none">
              ₱{totalAssetVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[11px] text-emerald-700 font-medium mt-1.5 leading-tight">
              Currently holding <strong className="font-bold text-emerald-900">{stockSummary || "No stock"}</strong> across <strong className="font-bold text-emerald-900">{items.length}</strong> unique SKUs in catalog.
            </p>
            {totalInventorySpend > 0 && (
              <p className="text-[10px] text-emerald-700 font-mono mt-1">
                Potential gross margin: ₱{grossProfitPotential.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            )}
          </div>
        </div>

        {/* Widget 3: Low Stock Warning / Alerts */}
        <div className="bg-indigo-100/80 border border-indigo-250/50 rounded-2xl p-5 flex flex-col justify-between shadow-xs text-indigo-950 min-h-32 md:col-span-2 xl:col-span-1">
          <div className="flex justify-between items-center text-indigo-805">
            <span className="text-[10px] font-bold font-mono uppercase tracking-wider">Stock Shortage Monitor</span>
            {lowStockCount > 0 ? (
              <span className="bg-[#f43f5e] text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                {lowStockCount} ALERT{lowStockCount > 1 ? "S" : ""}
              </span>
            ) : (
              <span className="bg-emerald-600 text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded-full">
                STABLE
              </span>
            )}
          </div>
          <div className="mt-3">
            {lowestStockItem ? (
              <>
                <h3 className="text-sm font-black font-mono tracking-tight text-indigo-900 flex items-center gap-1.5 truncate leading-none">
                  SKU: {lowestStockItem.sku} <span className="text-[10px] text-rose-600 font-bold bg-white/80 border border-rose-200 px-1.5 py-0.5 rounded-md">({formatMeasuredQuantity(lowestStockItem.quantity, lowestStockItem.measurementUnit)} left)</span>
                </h3>
                <p className="text-[11px] text-indigo-700 font-medium mt-1.5 line-clamp-1 leading-tight">
                  Critically Low Item: <strong className="font-semibold text-indigo-900">{lowestStockItem.name}</strong> • Size {lowestStockItem.size || "Mixed"}
                </p>
              </>
            ) : (
              <>
                <h3 className="text-base font-black font-display tracking-tight text-indigo-900 leading-none">
                  All SKU Stocks Good
                </h3>
                <p className="text-[11px] text-indigo-700 font-medium mt-1.5 leading-tight">
                  Zero items currently are critically depleted below safety thresholds (Qty &le; 15).
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Control Actions / Search bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 mb-6 flex flex-col lg:flex-row items-stretch lg:items-center gap-3 shadow-xs">
        {/* Search Field */}
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by SKU name, ID, color..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 outline-none text-slate-800 rounded-xl text-sm leading-relaxed focus:border-rose-400 focus:bg-white transition-all duration-150"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Compact category filters */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <div className="flex min-w-0 bg-slate-100 border border-slate-200 rounded-xl p-1">
            {quickCategoryFilters.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`max-w-36 px-3 py-1.5 rounded-lg text-xs font-semibold truncate transition-colors duration-150 ${
                  selectedCategory === cat ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
                }`}
                title={cat}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowCategoryFilter((visible) => !visible);
                setCategoryFilterQuery("");
              }}
              className={`h-9 px-3 border rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                showCategoryFilter || !quickCategoryFilters.includes(selectedCategory)
                  ? "bg-slate-900 border-slate-900 text-white"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Categories
              <span className={`min-w-5 px-1 py-0.5 rounded text-[9px] font-mono ${
                showCategoryFilter || !quickCategoryFilters.includes(selectedCategory)
                  ? "bg-white/15 text-white"
                  : "bg-slate-100 text-slate-500"
              }`}>
                {categoryOptions.length}
              </span>
            </button>

            {showCategoryFilter && (
              <div className="absolute right-0 top-full mt-2 z-40 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                <div className="p-2.5 border-b border-slate-100">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search categories..."
                      value={categoryFilterQuery}
                      onChange={(e) => setCategoryFilterQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:bg-white focus:border-slate-400"
                    />
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory("All");
                      setShowCategoryFilter(false);
                    }}
                    className={`w-full px-3 py-2 rounded-lg text-left text-xs font-semibold flex items-center justify-between ${
                      selectedCategory === "All" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    All categories
                    <span className="font-mono text-[9px]">{items.length}</span>
                  </button>
                  {searchableCategories.map((cat) => {
                    const itemCount = items.filter((item) => item.category === cat).length;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setSelectedCategory(cat);
                          setShowCategoryFilter(false);
                          setCategoryFilterQuery("");
                        }}
                        className={`w-full px-3 py-2 rounded-lg text-left text-xs flex items-center justify-between gap-3 ${
                          selectedCategory === cat
                            ? "bg-slate-900 text-white font-semibold"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="truncate">{cat}</span>
                        <span className="font-mono text-[9px] opacity-70">{itemCount}</span>
                      </button>
                    );
                  })}
                  {searchableCategories.length === 0 && (
                    <div className="px-3 py-6 text-center text-xs text-slate-400">No matching categories.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setLowStockFilter(!lowStockFilter)}
            className={`h-9 py-2 px-3 border rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors duration-150 ${
              lowStockFilter
                ? "bg-rose-50 border-rose-300 text-[#f43f5e]"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Low Stock (&le; 15)
          </button>
        </div>
      </div>

      {!hasWriteAccess && (
        <div className="mb-6 bg-slate-100 border border-slate-200 text-slate-700 px-4 py-3 rounded-2xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-slate-550 shrink-0" />
          <span><strong>Viewer/Cashier Privilege:</strong> You can query bead SKU designs for active orders. Editing prices, updating stocks, or editing listings requires an Admin account.</span>
        </div>
      )}

      {/* Grid container of products */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse bg-white border border-slate-100 h-64 rounded-3xl" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-slate-50 border border-dashed border-slate-250 rounded-3xl p-12 text-center text-slate-500">
          <ImageIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium">No SKU items found in the current filter.</p>
          <p className="text-xs mt-1 text-slate-400">Add a bead SKU or clear active search filter bounds.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredItems.map((item) => {
            const isLow = item.quantity <= 15;
            const isOut = item.quantity === 0;

            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedItem(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedItem(item);
                  }
                }}
                className="bg-white border border-slate-200 rounded-3xl shadow-xs overflow-hidden hover:shadow-md hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-400 transition-all duration-200 flex flex-col group relative cursor-pointer"
              >
                {/* SKU Picture layout */}
                <div className="h-44 bg-slate-50 border-b border-slate-100 flex items-center justify-center p-6 relative group overflow-hidden">
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    referrerPolicy="no-referrer"
                    className="max-h-full max-w-full object-contain filter drop-shadow-md group-hover:scale-105 transition-transform duration-200"
                  />
                  
                  {/* Category Badging */}
                  <span className="absolute top-3 left-3 bg-white/90 backdrop-blur-xs border border-slate-100 px-2.5 py-1 text-[10px] font-extrabold text-slate-700 rounded-lg uppercase tracking-wider">
                    {item.category}
                  </span>

                  {/* Stock Badges */}
                  <span
                    className={`absolute top-3 right-3 px-2 py-1 text-[10px] font-bold rounded-lg ${
                      isOut
                        ? "bg-rose-100 border border-rose-200 text-rose-800"
                        : isLow
                        ? "bg-amber-100 border border-amber-200 text-amber-800"
                        : "bg-emerald-100 border border-emerald-250 text-emerald-800"
                    }`}
                  >
                    {isOut ? "Out of Stock" : isLow ? `Only ${formatMeasuredQuantity(item.quantity, item.measurementUnit)} left` : `${formatMeasuredQuantity(item.quantity, item.measurementUnit)} in stock`}
                  </span>
                </div>

                {/* SKU Info */}
                <div className="p-5 flex-1 flex flex-col">
                  <div className="font-mono text-[10px] text-slate-400 tracking-widest font-bold flex items-center gap-1">
                    SKU: {item.sku}
                  </div>
                  {item.supplier && (
                    <div className="mt-1 text-[10px] font-semibold text-slate-500 truncate">
                      Supplier: {item.supplier}
                    </div>
                  )}
                  
                  <h3 className="mt-1.5 font-display font-black text-slate-800 text-sm group-hover:text-[#f43f5e] transition-colors duration-150 line-clamp-1">
                    {item.name}
                  </h3>
                  
                  <p className="mt-1 text-xs text-slate-500 line-clamp-2 flex-1 leading-relaxed">
                    {item.description || "No description provided."}
                  </p>

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {item.size && (
                      <span className="text-[10px] font-mono font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                        📏 {item.size}
                      </span>
                    )}
                    {item.color && (
                      <span className="text-[10px] font-mono font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                        🎨 {item.color}
                      </span>
                    )}
                  </div>

                  {/* Pricing and Modifiers */}
                  <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-slate-400 text-[10px] font-semibold block uppercase">Price per {formatSellingMeasure(item.sellingUnitQuantity, item.measurementUnit)}</span>
                      <span className="font-display font-extrabold text-slate-900 text-base">
                        ₱{item.price.toFixed(2)}
                      </span>
                    </div>

                    {hasWriteAccess && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEdit(item);
                          }}
                          className="p-1.5 text-slate-500 hover:text-slate-900 bg-slate-50 hover:bg-slate-200 rounded-lg border border-slate-200 cursor-pointer transition-colors duration-150"
                          title="Edit stock"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem(item.id);
                          }}
                          className="p-1.5 text-[#f43f5e] hover:text-white hover:bg-[#f43f5e] rounded-lg border border-slate-200 cursor-pointer transition-colors duration-150"
                          title="Delete SKU"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inventory item details modal */}
      {selectedItem && (
        <div
          className="fixed inset-0 z-[70] bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedItem(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-detail-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-2xl"
          >
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                  SKU {selectedItem.sku}
                </span>
                <h3 id="inventory-detail-title" className="font-display font-black text-lg text-slate-900 truncate">
                  {selectedItem.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full shrink-0"
                title="Close details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr]">
              <div className="bg-slate-50 border-b md:border-b-0 md:border-r border-slate-200 p-6">
                <div className="aspect-square bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-center">
                  <img
                    src={selectedItem.imageUrl}
                    alt={selectedItem.name}
                    referrerPolicy="no-referrer"
                    className="max-h-full max-w-full object-contain drop-shadow-md"
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="px-2 py-1 bg-white border border-slate-200 rounded-md text-[10px] font-bold text-slate-700 uppercase">
                    {selectedItem.category}
                  </span>
                  <span className={`px-2 py-1 border rounded-md text-[10px] font-bold ${
                    selectedItem.quantity <= 15
                      ? "bg-amber-50 border-amber-200 text-amber-800"
                      : "bg-emerald-50 border-emerald-200 text-emerald-800"
                  }`}>
                    {formatMeasuredQuantity(selectedItem.quantity, selectedItem.measurementUnit)} in stock
                  </span>
                </div>
              </div>

              <div className="p-5 md:p-6 space-y-6">
                <section>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Item Details</h4>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    {selectedItem.description || "No description provided."}
                  </p>
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div className="col-span-2 border border-slate-200 rounded-lg p-3">
                      <span className="block text-[9px] font-bold uppercase text-slate-400">Supplier</span>
                      <strong className="text-xs text-slate-800">{selectedItem.supplier || "Not specified"}</strong>
                    </div>
                    <div className="border border-slate-200 rounded-lg p-3">
                      <span className="block text-[9px] font-bold uppercase text-slate-400">Color</span>
                      <strong className="text-xs text-slate-800">{selectedItem.color || "N/A"}</strong>
                    </div>
                    <div className="border border-slate-200 rounded-lg p-3">
                      <span className="block text-[9px] font-bold uppercase text-slate-400">Size</span>
                      <strong className="text-xs text-slate-800">{selectedItem.size || "N/A"}</strong>
                    </div>
                  </div>
                </section>

                <section>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Costing</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <span className="block text-[9px] font-bold uppercase text-slate-400">Purchase Cost</span>
                      <strong className="font-mono text-sm text-slate-900">
                        {selectedItem.purchaseCost == null ? "N/A" : `₱${selectedItem.purchaseCost.toFixed(2)}`}
                      </strong>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <span className="block text-[9px] font-bold uppercase text-slate-400">Quantity Received</span>
                      <strong className="font-mono text-sm text-slate-900">
                        {selectedItem.purchaseQuantity == null
                          ? "N/A"
                          : formatMeasuredQuantity(selectedItem.purchaseQuantity, selectedItem.measurementUnit)}
                      </strong>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 col-span-2 sm:col-span-1">
                      <span className="block text-[9px] font-bold uppercase text-slate-400">Base Unit Cost</span>
                      <strong className="font-mono text-sm text-slate-900">
                        {selectedItem.baseUnitCost == null
                          ? "N/A"
                          : `₱${selectedItem.baseUnitCost.toFixed(2)} / ${getMeasurementLabel(selectedItem.measurementUnit)}`}
                      </strong>
                    </div>
                  </div>
                </section>

                <section>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Selling Measures</h4>
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    {(selectedItem.sellingMeasures?.length
                      ? selectedItem.sellingMeasures
                      : [{
                          quantity: selectedItem.sellingUnitQuantity || 1,
                          markupPercent: selectedItem.markupPercent || 0,
                          price: selectedItem.price,
                        }]
                    ).map((measure, index) => (
                      <div
                        key={`${measure.quantity}-${measure.price}-${index}`}
                        className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-3 border-b border-slate-100 last:border-0"
                      >
                        <div>
                          <span className="block text-xs font-bold text-slate-800">
                            {formatSellingMeasure(measure.quantity, selectedItem.measurementUnit)}
                          </span>
                          <span className="text-[9px] text-slate-400">Selling option {index + 1}</span>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500">
                          {measure.markupPercent.toFixed(2).replace(/\.00$/, "")}% markup
                        </span>
                        <strong className="font-mono text-sm text-slate-950">₱{measure.price.toFixed(2)}</strong>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5" />
                      Stock History
                    </h4>
                    <span className="text-[9px] font-mono text-slate-400">{stockHistory.length} entries</span>
                  </div>
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    {historyLoading ? (
                      <div className="px-4 py-5 text-center text-xs text-slate-400">Loading history...</div>
                    ) : stockHistory.length === 0 ? (
                      <div className="px-4 py-5 text-center text-xs text-slate-400">
                        No stock history recorded yet. The next save will create the first entry.
                      </div>
                    ) : (
                      stockHistory.map((entry) => {
                        const entryDate = entry.createdAt?.toDate?.();
                        const actionLabel = entry.action === "created"
                          ? "Item created"
                          : entry.action === "stock_added"
                          ? "Stock added"
                          : entry.action === "stock_removed"
                          ? "Stock reduced"
                          : "Item updated";
                        const changePrefix = entry.quantityChange > 0 ? "+" : "";

                        return (
                          <div key={entry.id} className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-4 py-3 border-b border-slate-100 last:border-0">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              entry.quantityChange > 0
                                ? "bg-emerald-50 text-emerald-600"
                                : entry.quantityChange < 0
                                ? "bg-rose-50 text-rose-600"
                                : "bg-slate-100 text-slate-500"
                            }`}>
                              <History className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0">
                              <strong className="block text-xs text-slate-800">{actionLabel}</strong>
                              <span className="block text-[9px] text-slate-400 truncate">
                                {entry.createdBy} · {entryDate ? entryDate.toLocaleString() : "Just now"}
                              </span>
                            </div>
                            <div className="text-right">
                              <strong className={`block font-mono text-xs ${
                                entry.quantityChange > 0
                                  ? "text-emerald-700"
                                  : entry.quantityChange < 0
                                  ? "text-rose-700"
                                  : "text-slate-600"
                              }`}>
                                {changePrefix}{formatMeasuredQuantity(entry.quantityChange, entry.measurementUnit)}
                              </strong>
                              <span className="block text-[9px] font-mono text-slate-400">
                                {formatMeasuredQuantity(entry.previousQuantity, entry.measurementUnit)} → {formatMeasuredQuantity(entry.newQuantity, entry.measurementUnit)}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                {hasWriteAccess && (
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const item = selectedItem;
                        setSelectedItem(null);
                        handleOpenEdit(item);
                      }}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-2"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit Item
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL FORM SHEET FOR CREATING / EDITING SKU */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-white h-full shadow-xxl overflow-y-auto p-6 md:p-8 flex flex-col relative animate-slide-in">
            {/* Close trigger */}
            <button
              onClick={resetForm}
              className="absolute top-5 right-5 p-2 bg-stone-50 hover:bg-stone-100 text-stone-500 hover:text-stone-800 rounded-full cursor-pointer transition-colors duration-150"
            >
              <X className="w-4.5 h-4.5" />
            </button>

            <h3 className="font-display font-extrabold text-lg text-stone-900 mb-1">
              {editingItem ? "Edit Bead SKU Design" : "Register New Bead SKU"}
            </h3>
            <p className="text-stone-500 text-xs mb-6">
              Create a unique SKU, specify colors, sizes, stock volumes, and assign a picture/preset.
            </p>

            <form onSubmit={handleSaveItem} className="space-y-5 flex-1 flex flex-col justify-between">
              <div className="space-y-4">
                {/* SKU Code Input */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-bold text-stone-700 uppercase">Item SKU code *</label>
                      {!editingItem && (
                        <button
                          type="button"
                          onClick={() => setSku(generateAutoSku(category))}
                          className="text-[10px] text-[#f43f5e] font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                        >
                          <Sparkles className="w-3 h-3" /> Auto SKU
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      required
                      placeholder="e.g. BD-AC-RED-8"
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                      disabled={editingItem !== null}
                      className="w-full px-3 py-2 border border-stone-250 bg-stone-50 rounded-xl text-xs uppercase focus:border-stone-900 outline-none disabled:opacity-60 font-mono"
                    />
                    {!editingItem && (
                      <span className="text-[9px] text-stone-400 mt-1 block font-mono">
                        Format: BD-[CAT]-[YYMMDD]-[0001]
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Category *</label>
                    <input
                      type="text"
                      required
                      list="inventory-category-options"
                      value={category}
                      onChange={(e) => {
                        setCategory(e.target.value);
                      }}
                      onBlur={() => {
                        const cleanCategory = category.trim();
                        const matchedCategory = categoryOptions.find(
                          (option) => option.toLocaleLowerCase() === cleanCategory.toLocaleLowerCase()
                        );
                        const resolvedCategory = matchedCategory || cleanCategory;

                        setCategory(resolvedCategory);
                        if (!editingItem && resolvedCategory && (sku === "" || sku.startsWith("BD-"))) {
                          setSku(generateAutoSku(resolvedCategory));
                        }
                      }}
                      placeholder="Type or select a category"
                      className="w-full px-3 py-2 border border-stone-250 bg-white rounded-xl text-xs outline-none focus:border-stone-900"
                    />
                    <datalist id="inventory-category-options">
                      {categoryOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                    <span className="text-[9px] text-stone-400 mt-1 block">
                      Select a match or type a new category.
                    </span>
                  </div>
                </div>

                {/* Name */}
                <div className="relative">
                  <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Bead Item Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Pastel Pink Heart Acrylic Beads (10mm)"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setShowInventorySuggestions(true);
                    }}
                    onFocus={() => setShowInventorySuggestions(true)}
                    onBlur={() => window.setTimeout(() => setShowInventorySuggestions(false), 120)}
                    autoComplete="off"
                    className="w-full px-3 py-2 border border-stone-250 rounded-xl text-xs focus:border-stone-900 outline-none"
                  />
                  {!editingItem && showInventorySuggestions && inventorySuggestions.length > 0 && (
                    <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto">
                      <div className="px-3 py-2 bg-stone-50 border-b border-stone-200">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-stone-500">
                          Existing inventory matches
                        </span>
                      </div>
                      {inventorySuggestions.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelectInventorySuggestion(item)}
                          className="w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-stone-50 border-b border-stone-100 last:border-0"
                        >
                          <div className="w-11 h-11 bg-stone-50 border border-stone-200 rounded-lg p-1.5 flex items-center justify-center shrink-0">
                            <img
                              src={item.imageUrl}
                              alt=""
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <strong className="block text-xs text-stone-900 truncate">{item.name}</strong>
                            <span className="block text-[9px] font-mono text-stone-400 truncate">
                              {item.sku} · {item.category}
                            </span>
                            <span className="block text-[9px] text-stone-500 mt-0.5">
                              {formatMeasuredQuantity(item.quantity, item.measurementUnit)} stock · ₱{item.price.toFixed(2)}
                            </span>
                          </div>
                          <span className="text-[9px] font-bold text-rose-500 uppercase shrink-0">Select</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Supplier</label>
                  <input
                    type="text"
                    list="inventory-supplier-options"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    onBlur={() => {
                      const cleanSupplier = supplier.trim();
                      const matchedSupplier = supplierOptions.find(
                        (option) => option.toLocaleLowerCase() === cleanSupplier.toLocaleLowerCase()
                      );
                      setSupplier(matchedSupplier || cleanSupplier);
                    }}
                    placeholder="Search or type a new supplier"
                    autoComplete="off"
                    className="w-full px-3 py-2 border border-stone-250 bg-white rounded-xl text-xs outline-none focus:border-stone-900"
                  />
                  <datalist id="inventory-supplier-options">
                    {supplierOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </div>

                {/* Pricing and stock */}
                <div className="border border-stone-200 bg-stone-50/70 rounded-xl p-3.5">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-bold text-stone-700 uppercase">Pricing &amp; Stock</label>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="block text-[9px] font-bold uppercase text-stone-400">Base cost / {getMeasurementLabel(measurementUnit)}</span>
                      <strong className="font-mono text-sm text-stone-900">
                        {baseUnitCost === null ? "—" : `₱${baseUnitCost.toFixed(2)}`}
                      </strong>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold text-stone-600 uppercase mb-1">Purchase Cost (₱)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="e.g. 900.00"
                        value={purchaseCost}
                        onChange={(e) => setPurchaseCost(e.target.value === "" ? "" : Number(e.target.value))}
                        className="w-full px-3 py-2 border border-stone-250 bg-white rounded-xl text-xs focus:border-stone-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-stone-600 uppercase mb-1">Qty Received</label>
                      <input
                        type="number"
                        min={getMeasurementStep(measurementUnit)}
                        step={getMeasurementStep(measurementUnit)}
                        placeholder="e.g. 50"
                        value={purchaseQuantity}
                        onChange={(e) => setPurchaseQuantity(e.target.value === "" ? "" : Number(e.target.value))}
                        className="w-full px-3 py-2 border border-stone-250 bg-white rounded-xl text-xs focus:border-stone-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-stone-600 uppercase mb-1">Unit</label>
                      <select
                        value={measurementUnit}
                        onChange={(e) => {
                          setMeasurementUnit(e.target.value as MeasurementUnit);
                          setSellingUnitQuantity(1);
                        }}
                        className="w-full px-3 py-2 border border-stone-250 bg-white rounded-xl text-xs outline-none focus:border-stone-900"
                      >
                        {MEASUREMENT_UNITS.map((unit) => (
                          <option key={unit.value} value={unit.value}>{unit.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-stone-200 pt-3">
                    <div className={`grid gap-2 ${editingItem ? "grid-cols-1 sm:grid-cols-[1fr_1fr_auto]" : "grid-cols-1"}`}>
                      <div>
                        <label className="block text-[10px] font-bold text-stone-600 uppercase mb-1">Current Stock</label>
                        <div className="relative">
                          <input
                            type="number"
                            required
                            min="0"
                            step={getMeasurementStep(measurementUnit)}
                            placeholder="100"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))}
                            className="w-full px-3 py-2 pr-12 border border-stone-250 bg-white rounded-xl text-xs focus:border-stone-900 outline-none"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold text-stone-400 uppercase">
                            {getMeasurementLabel(measurementUnit)}
                          </span>
                        </div>
                      </div>
                      {editingItem && (
                        <>
                          <div>
                            <label className="block text-[10px] font-bold text-emerald-700 uppercase mb-1">Quantity to Add</label>
                            <input
                              type="number"
                              min={getMeasurementStep(measurementUnit)}
                              step={getMeasurementStep(measurementUnit)}
                              placeholder={`0 ${getMeasurementLabel(measurementUnit)}`}
                              value={stockToAdd}
                              onChange={(e) => setStockToAdd(e.target.value === "" ? "" : Number(e.target.value))}
                              className="w-full px-3 py-2 border border-emerald-200 bg-emerald-50/50 rounded-xl text-xs outline-none focus:border-emerald-500"
                            />
                          </div>
                          <div className="sm:self-end">
                            <button
                              type="button"
                              disabled={stockToAdd === "" || stockToAdd <= 0}
                              onClick={() => {
                                if (stockToAdd === "" || stockToAdd <= 0) return;
                                setQuantity((current) => Number(current || 0) + Number(stockToAdd));
                                setStockToAdd("");
                              }}
                              className="w-full sm:w-auto h-[34px] px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-bold uppercase whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Add Stock
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                    <div>
                      <label className="block text-[10px] font-bold text-stone-600 uppercase mb-1">Selling Measure</label>
                      <div className="flex">
                        <input
                          type="number"
                          required
                          min={getMeasurementStep(measurementUnit)}
                          step={getMeasurementStep(measurementUnit)}
                          value={sellingUnitQuantity}
                          onChange={(e) => setSellingUnitQuantity(e.target.value === "" ? "" : Number(e.target.value))}
                          className="min-w-0 flex-1 px-3 py-2 border border-stone-250 bg-white rounded-l-xl text-xs focus:border-stone-900 outline-none"
                        />
                        <span className="px-3 py-2 border border-l-0 border-stone-250 bg-stone-100 rounded-r-xl text-xs font-bold text-stone-600">
                          {getMeasurementLabel(measurementUnit)}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-stone-600 uppercase mb-1">Custom Markup (%)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="e.g. 45"
                        value={markupPercent}
                        onChange={(e) => {
                          const value = e.target.value === "" ? "" : Number(e.target.value);
                          setMarkupPercent(value);
                          if (value !== "" && sellingBaseCost !== null) {
                            setPrice(Number((sellingBaseCost * (1 + value / 100)).toFixed(2)));
                          }
                        }}
                        className="w-full px-3 py-2 border border-stone-250 bg-white rounded-xl text-xs focus:border-stone-900 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-stone-600 uppercase mb-1">Selling Price (₱)</label>
                      <input
                        type="number"
                        required
                        min="0"
                        step="0.01"
                        placeholder="Enter final price"
                        value={price}
                        onChange={(e) => {
                          const value = e.target.value === "" ? "" : Number(e.target.value);
                          setPrice(value);
                          if (value !== "" && sellingBaseCost !== null && sellingBaseCost > 0) {
                            setMarkupPercent(Number((((Number(value) / sellingBaseCost) - 1) * 100).toFixed(2)));
                          } else {
                            setMarkupPercent("");
                          }
                        }}
                        className="w-full px-3 py-2 border border-stone-250 bg-white rounded-xl text-xs focus:border-stone-900 outline-none"
                      />
                    </div>
                  </div>

                  {additionalSellingMeasures.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <span className="block text-[9px] font-bold uppercase text-stone-400">Additional Selling Measures</span>
                      {additionalSellingMeasures.map((measure, index) => (
                        <div key={measure.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end bg-white border border-stone-200 rounded-xl p-2.5">
                          <div>
                            <label className="block text-[9px] font-bold text-stone-500 uppercase mb-1">Measure {index + 2}</label>
                            <div className="flex">
                              <input
                                type="number"
                                min={getMeasurementStep(measurementUnit)}
                                step={getMeasurementStep(measurementUnit)}
                                value={measure.quantity}
                                onChange={(e) => updateSellingMeasure(
                                  measure.id,
                                  "quantity",
                                  e.target.value === "" ? "" : Number(e.target.value)
                                )}
                                className="min-w-0 flex-1 px-2.5 py-2 border border-stone-250 rounded-l-lg text-xs outline-none focus:border-stone-900"
                              />
                              <span className="px-2.5 py-2 border border-l-0 border-stone-250 bg-stone-100 rounded-r-lg text-[10px] font-bold text-stone-600">
                                {getMeasurementLabel(measurementUnit)}
                              </span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold text-stone-500 uppercase mb-1">Markup (%)</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="%"
                              value={measure.markupPercent}
                              onChange={(e) => updateSellingMeasure(
                                measure.id,
                                "markupPercent",
                                e.target.value === "" ? "" : Number(e.target.value)
                              )}
                              className="w-full px-2.5 py-2 border border-stone-250 rounded-lg text-xs outline-none focus:border-stone-900"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold text-stone-500 uppercase mb-1">Selling Price (₱)</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Price"
                              value={measure.price}
                              onChange={(e) => updateSellingMeasure(
                                measure.id,
                                "price",
                                e.target.value === "" ? "" : Number(e.target.value)
                              )}
                              className="w-full px-2.5 py-2 border border-stone-250 rounded-lg text-xs outline-none focus:border-stone-900"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setAdditionalSellingMeasures((measures) => measures.filter((item) => item.id !== measure.id))}
                            className="p-2 text-rose-500 hover:text-white hover:bg-rose-500 border border-rose-200 rounded-lg transition-colors"
                            title="Remove selling measure"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={addSellingMeasure}
                    className="mt-3 w-full py-2 border border-dashed border-stone-300 hover:border-stone-500 hover:bg-white text-stone-600 rounded-xl text-[10px] font-bold uppercase flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add another selling measure
                  </button>

                  <div className="mt-3 border-t border-stone-200 pt-2.5">
                    <button
                      type="button"
                      onClick={() => setShowMarkupPresets((visible) => !visible)}
                      className="w-full flex items-center justify-between text-[9px] font-bold uppercase text-stone-500 hover:text-stone-800"
                    >
                      <span>Quick markup presets</span>
                      <span>{showMarkupPresets ? "Hide" : "Show"}</span>
                    </button>
                    {showMarkupPresets && (
                      <div className="mt-2">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="block text-[9px] font-bold uppercase text-stone-400">Suggested Selling Prices</span>
                      <span className="text-[9px] font-mono text-stone-500">
                        Cost for {sellingUnitQuantity || 0} {getMeasurementLabel(measurementUnit)}: {sellingBaseCost === null ? "—" : `₱${sellingBaseCost.toFixed(2)}`}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                      {MARKUP_OPTIONS.map((markup) => {
                        const suggestedPrice = sellingBaseCost === null ? null : sellingBaseCost * (1 + markup / 100);
                        const isSelected = markupPercent === markup;

                        return (
                          <button
                            key={markup}
                            type="button"
                            disabled={suggestedPrice === null}
                            onClick={() => {
                              if (suggestedPrice === null) return;
                              setMarkupPercent(markup);
                              setPrice(Number(suggestedPrice.toFixed(2)));
                            }}
                            className={`min-h-12 px-2 py-1.5 border rounded-lg text-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                              isSelected
                                ? "bg-stone-900 border-stone-900 text-white"
                                : "bg-white border-stone-200 text-stone-700 hover:border-stone-400"
                            }`}
                          >
                            <span className="block text-[9px] font-bold">{markup}%</span>
                            <span className="block text-[10px] font-mono mt-0.5">
                              {suggestedPrice === null ? "—" : `₱${suggestedPrice.toFixed(2)}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Item attributes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Color Style</label>
                    <input
                      type="text"
                      placeholder="e.g. Lavender, Rainbow"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="w-full px-3 py-2 border border-stone-250 rounded-xl text-xs focus:border-stone-900 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Bead Size (mm)</label>
                    <input
                      type="text"
                      placeholder="e.g. 4mm, 8mm, Mixed"
                      value={size}
                      onChange={(e) => setSize(e.target.value)}
                      className="w-full px-3 py-2 border border-stone-250 rounded-xl text-xs focus:border-stone-900 outline-none"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Description</label>
                  <textarea
                    rows={2}
                    placeholder="Provide details about beads craft design, batch details, or materials."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-250 rounded-xl text-xs focus:border-stone-900 outline-none resize-none"
                  />
                </div>

                {/* Predefined Bead presets for quick bootstrapping */}
                {!editingItem && (
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      Quick Preset Loader
                    </label>
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                      {BEADS_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleSelectPreset(p)}
                          className="bg-stone-50 hover:bg-stone-105 border border-stone-200 rounded-xl p-2 cursor-pointer text-[10px] text-stone-700 font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5"
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-md inline-block shadow-xs shrink-0"
                            style={{ backgroundColor: p.svgColor }}
                          />
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Image Selection Block */}
                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase mb-1">SKU Picture</label>
                  <div className="grid grid-cols-3 gap-3 items-center">
                    {/* Upload Field */}
                    <label className="col-span-2 border border-dashed border-stone-300 hover:border-stone-400 bg-stone-50 hover:bg-stone-100 rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer text-center group h-24">
                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      <ImageIcon className="w-5.5 h-5.5 text-stone-400 group-hover:text-amber-500 transition-colors mb-1.5" />
                      <span className="text-[10.5px] font-semibold text-stone-700">Drag &amp; Drop or Upload Photo</span>
                      <span className="text-[9px] text-stone-400 mt-0.5">JPEG, PNG cropped to square automatically</span>
                    </label>

                    <button
                      type="button"
                      onClick={openCameraModal}
                      className="flex items-center justify-center gap-2 border border-dashed border-stone-300 rounded-xl p-3 bg-stone-50 text-stone-700 hover:border-stone-400 hover:bg-stone-100 transition-colors duration-150 h-24"
                    >
                      <Camera className="w-4 h-4" />
                      <span className="text-[10.5px] font-semibold">Take Photo</span>
                    </button>
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleImageUpload}
                      className="hidden"
                    />

                    {/* Preview Image */}
                    <div className="border border-stone-200 bg-stone-50 rounded-xl h-24 flex items-center justify-center p-3 text-stone-400 relative">
                      {imageUrl ? (
                        <>
                          <img
                            src={imageUrl}
                            alt="SKU Preview"
                            referrerPolicy="no-referrer"
                            className="max-h-full max-w-full object-contain filter drop-shadow-sm"
                          />
                          <button
                            type="button"
                            onClick={() => setImageUrl("")}
                            className="absolute -top-1.5 -right-1.5 p-1 bg-stone-900 text-white hover:bg-stone-700 rounded-full"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </>
                      ) : (
                        <div className="text-center">
                          <span className="text-[10px] font-mono block">No Photo</span>
                          <span className="text-[9px] text-stone-400">Uses default preset</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="pt-6 border-t border-stone-105 flex items-center justify-end gap-3 mt-8">
                <button
                  type="button"
                  onClick={resetForm}
                  className="py-2.5 px-5 border border-stone-250 text-stone-600 hover:bg-stone-50 rounded-xl text-xs font-medium cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2.5 px-6 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer transition-all duration-150"
                >
                  {editingItem ? "Save Modifications" : "Save Bead Design"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Camera capture modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-[140] bg-slate-950/85 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl overflow-hidden border border-slate-700 bg-slate-950 shadow-2xl">
            <div className="relative bg-black aspect-square">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />
              <button
                type="button"
                onClick={closeCameraModal}
                className="absolute top-4 right-4 bg-slate-900/80 text-white rounded-full p-2 shadow-lg"
              >
                <X className="w-4 h-4" />
              </button>
              {cameraError && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-3 text-xs text-center">
                  {cameraError}
                </div>
              )}
            </div>
            <div className="p-4 bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleCapturePhoto}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-semibold transition-colors"
                >
                  Capture
                </button>
                <button
                  type="button"
                  onClick={closeCameraModal}
                  className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-2xl font-semibold transition-colors"
                >
                  Cancel
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  closeCameraModal();
                  fallbackToFileInput();
                }}
                className="mt-3 w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-semibold transition-colors"
              >
                Use Device Photo Picker
              </button>
              <p className="mt-3 text-center text-[11px] text-slate-400">
                Point your camera at the SKU and press Capture. If the camera fails, use the device photo picker instead.
              </p>
            </div>
          </div>
        </div>
      )}

      {pendingImageCrop && (
        <ImageCropper
          source={pendingImageCrop}
          aspect={1}
          outputWidth={500}
          title="Crop Product Photo"
          onCancel={() => setPendingImageCrop("")}
          onComplete={(croppedImage) => {
            setImageUrl(croppedImage);
            setPendingImageCrop("");
          }}
        />
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
