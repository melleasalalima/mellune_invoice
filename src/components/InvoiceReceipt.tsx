/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Invoice, InvoiceStatus, PaymentMethod, PaymentStatus, ShopSettings } from "../types";
import { calculateMeasuredLineTotal, formatMeasuredQuantity, formatSellingMeasure } from "../lib/units";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { Copy, Check, FileDown, FileText, ArrowLeft, Coins, Landmark, Calendar, Printer, Sparkles, Image as ImageIcon, Share2 } from "lucide-react";

interface InvoiceReceiptProps {
  invoiceId: string;
  onGoBack: () => void;
}

const getPaymentMethods = (settings: ShopSettings): PaymentMethod[] => {
  const methods = settings.paymentMethods || [
    { id: "gcash", label: "GCash", accountNumber: settings.gcashNumber || "", accountName: settings.gcashName || "" },
  ];

  return methods.filter((method) => method.accountNumber || method.accountName || method.qrCodeDataUrl);
};

const DEFAULT_CHAT_TEMPLATE = `✨ *Mellune Co. Invoice* ✨
Invoice #: *{INVOICE_NUM}*
Date: {DATE}
Customer: {CUST_NAME}

📋 Items List:
{ITEM_LIST}

💰TOTAL: *₱{TOTAL}*

DP/Paid: ₱{AMOUNT_PAID}
Total: ₱{TOTAL} 
Previous Balance: ₱{PREVIOUS_BALANCE}
*BALANCE: ₱{BALANCE}*

🏦SECURE PAYMENT CHANNELS:
{PAYMENT_CHANNELS}

🆔 Please send a copy of the receipt or your Reference ID once paid.
🚚 Shipout Daily, Cut-off for next day shipping is 11:00PM

Also, sending link for Checkout. Kindly note po that the checkout link is only open for paid/settled invoices. Once settled, you may checkout and select ₱5. Please send the last 4 digits of the Order ID for reference 😊

🔗: https://www.tiktok.com/view/product/1734472417032439312`;

export default function InvoiceReceipt({ invoiceId, onGoBack }: InvoiceReceiptProps) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync Invoice Data & Shop Settings
  useEffect(() => {
    setLoading(true);
    setSettingsLoading(true);

    // 1. Sync selected invoice
    const invoiceRef = doc(db, "invoices", invoiceId);
    const unsubInvoice = onSnapshot(invoiceRef, (snap) => {
      if (snap.exists()) {
        setInvoice({ id: snap.id, ...snap.data() } as Invoice);
      }
      setLoading(false);
    });

    // 2. Fetch or fallback global shop settings for receipts branding
    const settingsRef = doc(db, "settings", "shop");
    const unsubSettings = onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        setSettings(snap.data() as ShopSettings);
      } else {
        // High quality default seed config in react state if document not yet written
        setSettings({
          shopName: "Dazzling Beads Shop",
          gcashNumber: "0917-888-2234",
          gcashName: "Melle S.",
          bankDetails: "BDO Savings: 104-555-88982 (Melle Salalima)",
          paymentMethods: [
            { id: "gcash", label: "GCash", accountNumber: "0917-888-2234", accountName: "Melle S." },
          ],
          chatTemplate: DEFAULT_CHAT_TEMPLATE,
          updatedBy: "System",
          updatedAt: new Date(),
        });
      }
      setSettingsLoading(false);
    });

    return () => {
      unsubInvoice();
      unsubSettings();
    };
  }, [invoiceId]);

  // Compiled customized Chat copy template
  const getCompiledScript = () => {
    if (!invoice || !settings) return "";
    
    const dateObj = invoice.createdAt?.toDate ? invoice.createdAt.toDate() : new Date();
    const formattedDate = dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });

    const itemListString = invoice.items
      .map(
        (item) =>
          `- [${item.sku}] ${item.name} (${formatMeasuredQuantity(item.quantity, item.measurementUnit)}) @ ₱${item.price.toFixed(2)} per ${formatSellingMeasure(item.sellingUnitQuantity, item.measurementUnit)} = ₱${calculateMeasuredLineTotal(
            item.price,
            item.quantity,
            item.sellingUnitQuantity
          ).toFixed(2)}`
      )
      .join("\n");
    const paymentChannels = getPaymentMethods(settings)
      .map((method) => `- ${method.label}: ${method.accountNumber || "N/A"}${method.accountName ? ` (${method.accountName})` : ""}`)
      .join("\n");

    let template = settings.chatTemplate || DEFAULT_CHAT_TEMPLATE;
    template = template.replace(/{SHOP_NAME}/g, settings.shopName || "Our Beads Shop");
    template = template.replace(/{INVOICE_NUM}/g, invoice.invoiceNumber);
    template = template.replace(/{CUST_NAME}/g, invoice.customerName);
    template = template.replace(/{DATE}/g, formattedDate);
    template = template.replace(/{ITEM_LIST}/g, itemListString);
    template = template.replace(/{TOTAL}/g, invoice.totalAmount.toFixed(2));
    const paidAmount = invoice.amountPaid ?? (invoice.paymentStatus === PaymentStatus.PAID ? invoice.totalAmount : 0);
    const previousBalance = invoice.previousBalance || 0;
    const amountDue = invoice.totalAmount + previousBalance;
    const balanceAmount = amountDue - paidAmount;
    template = template.replace(/{DOWNPAYMENT}/g, paidAmount.toFixed(2));
    template = template.replace(/{AMOUNT_PAID}/g, paidAmount.toFixed(2));
    template = template.replace(/{PREVIOUS_BALANCE}/g, previousBalance.toFixed(2));
    template = template.replace(/{TOTAL_DUE}/g, amountDue.toFixed(2));
    template = template.replace(/{BALANCE}/g, balanceAmount.toFixed(2));
    template = template.replace(/{GCASH_NUM}/g, settings.gcashNumber || "N/A");
    template = template.replace(/{GCASH_NAME}/g, settings.gcashName || "N/A");
    template = template.replace(/{BANK_DETAILS}/g, settings.bankDetails || "N/A");
    template = template.replace(/{PAYMENT_CHANNELS}/g, paymentChannels || "N/A");

    if (!settings.chatTemplate?.includes("{BALANCE}")) {
      const paymentSummary = `DP / Paid: ₱${paidAmount.toFixed(2)}
Previous Balance: ₱${previousBalance.toFixed(2)}
Total Due: ₱${amountDue.toFixed(2)}
*BALANCE DUE: ₱${balanceAmount.toFixed(2)}*`;
      const paymentChannelsIndex = template.search(/🏦|SECURE PAYMENT CHANNELS/i);

      template = paymentChannelsIndex >= 0
        ? `${template.slice(0, paymentChannelsIndex).trimEnd()}\n\n${paymentSummary}\n\n${template.slice(paymentChannelsIndex)}`
        : `${template.trimEnd()}\n\n${paymentSummary}`;
    }

    return template;
  };

  const handleCopyScript = () => {
    const script = getCompiledScript();
    navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderReceiptImage = async () => {
    const element = document.getElementById("receipt-capture-box");
    if (!element) throw new Error("Invoice receipt could not be found.");
    const desktopWidth = 512;
    const previousStyle = element.getAttribute("style");
    const desktopOverrides = Array.from(
      element.querySelectorAll<HTMLElement>("[data-export-desktop-class]")
    ).map((node) => ({
      node,
      classes: node.dataset.exportDesktopClass?.split(/\s+/).filter(Boolean) || [],
    }));

    await document.fonts?.ready;
    const images = Array.from(element.querySelectorAll("img"));
    await Promise.all(
      images.map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            })
      )
    );

    try {
      element.style.width = `${desktopWidth}px`;
      element.style.minWidth = `${desktopWidth}px`;
      element.style.maxWidth = `${desktopWidth}px`;
      desktopOverrides.forEach(({ node, classes }) => node.classList.add(...classes));

      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

      const elementRect = element.getBoundingClientRect();
      const protectedBlocks = Array.from(element.querySelectorAll<HTMLElement>("[data-pdf-keep]"))
        .map((block) => {
          const rect = block.getBoundingClientRect();
          return {
            topRatio: Math.max(0, (rect.top - elementRect.top) / elementRect.height),
            bottomRatio: Math.min(1, (rect.bottom - elementRect.top) / elementRect.height),
          };
        });

      const imgData = await toPng(element, {
        backgroundColor: "#ffffff",
        width: desktopWidth,
        height: element.scrollHeight,
        pixelRatio: 2,
        cacheBust: true,
        skipAutoScale: true,
        style: {
          width: `${desktopWidth}px`,
          minWidth: `${desktopWidth}px`,
          maxWidth: `${desktopWidth}px`,
        },
      });

      return { imgData, protectedBlocks };
    } finally {
      if (previousStyle === null) element.removeAttribute("style");
      else element.setAttribute("style", previousStyle);
      desktopOverrides.forEach(({ node, classes }) => node.classList.remove(...classes));
    }
  };

  const loadRenderedImage = async () => {
    const { imgData, protectedBlocks } = await renderReceiptImage();
    const image = new Image();
    image.src = imgData;
    await image.decode();
    return { imgData, image, protectedBlocks };
  };

  const getReceiptPageSlices = (
    imageHeight: number,
    maximumSliceHeight: number,
    protectedBlockRatios: Array<{ topRatio: number; bottomRatio: number }>
  ) => {
    const protectedBlocks = protectedBlockRatios.map((block) => ({
      top: Math.round(block.topRatio * imageHeight),
      bottom: Math.round(block.bottomRatio * imageHeight),
    }));

    const slices: Array<{ sourceY: number; sliceHeight: number }> = [];
    let sourceY = 0;
    const breakPadding = 16;

    while (sourceY < imageHeight) {
      let breakAt = Math.min(sourceY + maximumSliceHeight, imageHeight);
      const splitBlock = protectedBlocks.find(
        (block) => block.top > sourceY + breakPadding && block.top < breakAt && block.bottom > breakAt
      );

      if (splitBlock) {
        breakAt = Math.max(sourceY + 1, splitBlock.top - breakPadding);
      }

      slices.push({ sourceY, sliceHeight: breakAt - sourceY });
      sourceY = breakAt;
    }

    return slices;
  };

  // 1. Export every PNG page at a device-independent A4 size (150 DPI).
  const handleDownloadPNG = async () => {
    setRendered(true);
    setError(null);
    try {
      const { image, protectedBlocks } = await loadRenderedImage();
      const baseName = invoice?.invoiceNumber || "Beads_Invoice";
      const a4Width = 1240;
      const a4Height = 1754;
      const margin = 47;
      const footerSpace = 35;
      const contentWidth = a4Width - margin * 2;
      const contentHeight = a4Height - margin * 2 - footerSpace;
      const outputScale = contentWidth / image.width;
      const sourcePageHeight = Math.max(1, Math.floor(contentHeight / outputScale));
      const pageSlices = getReceiptPageSlices(image.height, sourcePageHeight, protectedBlocks);
      const pageCount = pageSlices.length;

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
          const { sourceY, sliceHeight } = pageSlices[pageIndex];
          const canvas = document.createElement("canvas");
          canvas.width = a4Width;
          canvas.height = a4Height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("PNG page rendering is unavailable.");

          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(
            image,
            0,
            sourceY,
            image.width,
            sliceHeight,
            margin,
            margin,
            contentWidth,
            sliceHeight * outputScale
          );

          context.fillStyle = "#78716c";
          context.font = "16px sans-serif";
          context.textAlign = "center";
          context.fillText(`${baseName} · Page ${pageIndex + 1} of ${pageCount}`, canvas.width / 2, canvas.height - 20);

          const link = document.createElement("a");
          link.download = pageCount === 1
            ? `${baseName}.png`
            : `${baseName}-page-${pageIndex + 1}-of-${pageCount}.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();
          await new Promise((resolve) => setTimeout(resolve, 150));
      }
    } catch (err: any) {
      console.error("PNG export error:", err);
      setError(`Error printing PNG. ${err?.message || "Please check image permissions."}`);
    } finally {
      setRendered(false);
    }
  };

  // 2. Export the receipt across as many readable A4 pages as needed.
  const handleDownloadPDF = async () => {
    setRendered(true);
    setError(null);
    try {
      const { image, protectedBlocks } = await loadRenderedImage();
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 8;
      const availableWidth = pageWidth - margin * 2;
      const availableHeight = pageHeight - margin * 2;
      const mmPerPixel = availableWidth / image.width;
      const pageSliceHeight = Math.max(1, Math.floor(availableHeight / mmPerPixel));
      const pageSlices = getReceiptPageSlices(image.height, pageSliceHeight, protectedBlocks);
      const pageCount = pageSlices.length;

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const { sourceY, sliceHeight } = pageSlices[pageIndex];
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = sliceHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF page rendering is unavailable.");

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
          image,
          0,
          sourceY,
          image.width,
          sliceHeight,
          0,
          0,
          image.width,
          sliceHeight
        );

        if (pageIndex > 0) pdf.addPage("a4", "p");
        const renderedHeight = sliceHeight * mmPerPixel;
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, availableWidth, renderedHeight);
        pdf.setFontSize(8);
        pdf.setTextColor(120);
        pdf.text(
          `${invoice?.invoiceNumber || "Invoice"} · Page ${pageIndex + 1} of ${pageCount}`,
          pageWidth / 2,
          pageHeight - 3,
          { align: "center" }
        );
      }

      pdf.save(`${invoice?.invoiceNumber || "Invoice"}.pdf`);
    } catch (err: any) {
      console.error("PDF export error:", err);
      setError(`Error compiling PDF structure. ${err?.message || "Try again or use the invoice screenshot feature."}`);
    } finally {
      setRendered(false);
    }
  };

  const handleSharePhoto = async () => {
    if (!invoice?.orderPhotoDataUrl) return;
    const blob = await (await fetch(invoice.orderPhotoDataUrl)).blob();
    const file = new File([blob], `${invoice.invoiceNumber}-order-photo.jpg`, { type: blob.type || "image/jpeg" });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: `Order photo - ${invoice.invoiceNumber}`, text: `Order photo for ${invoice.customerName}`, files: [file] });
      return;
    }
    const link = document.createElement("a");
    link.href = invoice.orderPhotoDataUrl;
    link.download = file.name;
    link.click();
  };

  if (loading || settingsLoading) {
    return (
      <div className="py-20 text-center text-stone-500 animate-pulse font-mono flex items-center justify-center gap-2">
        <Printer className="w-5 h-5 animate-spin text-amber-500" />
        Processing Receipt layouts...
      </div>
    );
  }

  if (!invoice || !settings) {
    return (
      <div className="text-center py-20 bg-rose-50 border rounded-3xl p-6 text-rose-700">
        <ArrowLeft className="w-5 h-5 mx-auto mb-2 cursor-pointer" onClick={onGoBack} />
        Invoice transaction with ID {invoiceId} was not found or has been deleted.
      </div>
    );
  }

  const invoiceDate = invoice.createdAt?.toDate ? invoice.createdAt.toDate() : new Date();

  return (
    <div className="w-full">
      {error && (
        <div className="mb-6 bg-rose-50 border border-rose-100 p-4 font-mono text-xs text-[#f43f5e] rounded-2xl">
          {error}
        </div>
      )}

      {/* Return triggers */}
      <button
        onClick={onGoBack}
        className="mb-6 py-2 px-4 border border-stone-250 bg-white hover:bg-stone-50 rounded-xl text-xs font-semibold text-stone-700 flex items-center gap-2 cursor-pointer transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Invoice Ledger
      </button>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* Left Column: Core visual card representation for downloads */}
        <div className="xl:col-span-8 flex flex-col items-center">
          
          {/* Printable visual frame wrapping */}
          <div
            id="receipt-capture-box"
            data-export-desktop-class="p-6"
            className="w-full max-w-2xl bg-white border border-stone-300 rounded-3xl shadow-lg p-5 md:p-6 text-stone-800 font-sans relative overflow-hidden"
          >
            {/* Visual beads background details - meet beads theme */}
            <div className="h-2 bg-gradient-to-r from-red-400 via-orange-300 via-yellow-400 via-emerald-300 via-blue-400 to-purple-400 absolute top-0 inset-x-0" />
            
            {/* Stamp Logo & details */}
            <div className="flex justify-between items-start pt-2">
              <div>
                <span className="text-[10px] font-mono font-bold tracking-widest text-stone-400 block uppercase">Official Receipt</span>
                <h1 className="font-display font-black text-lg text-stone-900 tracking-tight mt-0.5">
                  {settings.shopName}
                </h1>
                <p className="text-stone-400 text-[10px] mt-0.5 leading-relaxed">
                  Wholesaler and Retail Beads, Crafts, and Customized Jewelry.
                </p>
              </div>

              {/* Status frame */}
              <div className="text-right">
                <span className="text-stone-400 text-[10px] uppercase font-bold tracking-widest block">Invoice Code</span>
                <span className="font-mono text-sm font-extrabold text-stone-900 block mt-0.5">
                  {invoice.invoiceNumber}
                </span>

                <div className="flex items-center justify-end gap-1 mt-1 whitespace-nowrap">
                  <span
                    className={`inline-block px-1.5 py-0.5 text-[8.5px] uppercase font-extrabold tracking-widest rounded-md ${
                      invoice.paymentStatus === PaymentStatus.PAID
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-250"
                        : invoice.paymentStatus === PaymentStatus.PARTIALLY_PAID
                        ? "bg-blue-50 text-blue-800 border border-blue-250"
                        : invoice.paymentStatus === PaymentStatus.CANCELLED
                        ? "bg-rose-50 text-rose-800 border border-rose-250"
                        : "bg-amber-50 text-amber-805 border border-amber-250"
                    }`}
                  >
                    Pay: {invoice.paymentStatus}
                  </span>

                  <span
                    className={`inline-block px-1.5 py-0.5 text-[8.5px] uppercase font-extrabold tracking-widest rounded-md ${
                      invoice.shippingStatus === "Delivered"
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-250"
                        : invoice.shippingStatus === "Shipped"
                        ? "bg-indigo-50 text-indigo-800 border border-indigo-250"
                        : "bg-amber-50 text-amber-805 border border-amber-250"
                    }`}
                  >
                    Ship: {invoice.shippingStatus || "Pending"}
                  </span>

                  <span
                    className={`inline-block px-1.5 py-0.5 text-[8.5px] uppercase font-extrabold tracking-widest rounded-md ${
                      invoice.invoiceStatus === InvoiceStatus.COMPLETED
                        ? "bg-purple-50 text-purple-800 border border-purple-205"
                        : invoice.invoiceStatus === InvoiceStatus.CANCELLED
                        ? "bg-rose-50 text-rose-800 border border-rose-205"
                        : invoice.invoiceStatus === InvoiceStatus.DRAFT
                        ? "bg-stone-50 text-stone-600 border border-stone-205"
                        : invoice.invoiceStatus === InvoiceStatus.CONFIRMED
                        ? "bg-amber-50 text-amber-805 border border-amber-205"
                        : "bg-indigo-50 text-indigo-805 border border-indigo-205"
                    }`}
                  >
                    Inv: {invoice.invoiceStatus || InvoiceStatus.PENDING}
                  </span>
                </div>
              </div>
            </div>

            {/* Bill Info Grid */}
            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-b border-stone-150 py-3.5">
              <div>
                <span className="block text-[9px] font-mono uppercase tracking-wider text-stone-400">Billed to Customer:</span>
                <span className="font-display font-extrabold text-stone-850 text-sm block mt-0.5">
                  {invoice.customerName}
                </span>
                
                {invoice.customerPhone && (
                  <span className="text-[10.5px] text-stone-550 font-mono block mt-0.5">
                    📱 {invoice.customerPhone}
                  </span>
                )}
                {invoice.customerEmail && (
                  <span className="text-[10.5px] text-stone-550 block">
                    ✉️ {invoice.customerEmail}
                  </span>
                )}
                {invoice.customerFacebookName && (
                  <span className="text-[10.5px] text-blue-600 block">
                    FB / IG: {invoice.customerFacebookName}
                  </span>
                )}
              </div>

              <div className="text-right flex flex-col justify-between h-full">
                <div>
                  <span className="block text-[9px] font-mono uppercase tracking-wider text-stone-400">Transaction Date:</span>
                  <span className="text-stone-705 text-xs font-semibold block mt-1 flex items-center justify-end gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-stone-400" />
                    {invoiceDate.toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                
                <div className="mt-1.5">
                  <span className="block text-[9px] font-mono uppercase tracking-wider text-stone-400">Cashier:</span>
                  <span className="text-stone-500 font-medium text-[10px] block">
                    {invoice.createdByEmail}
                  </span>
                </div>
              </div>
            </div>

            {/* Invoiced Lines Items Table */}
            <div className="mt-4">
              <span className="block text-[9.5px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">Purchased items</span>
              
              <div>
                {invoice.items.map((item, index) => (
                  <div data-pdf-keep key={`${item.sku}-${index}`} className="flex items-center justify-between gap-3 py-1.5 border-b border-stone-100 last:border-b-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* SKU Picture within Visual receipt layout - CRITICAL */}
                      <div className="w-9 h-9 bg-stone-50 border border-stone-200 p-1 rounded-lg shrink-0 flex items-center justify-center">
                        <img
                          src={item.imageUrl}
                          alt={item.sku}
                          crossOrigin="anonymous"
                          referrerPolicy="no-referrer"
                          className="max-h-full max-w-full object-contain filter drop-shadow-xs"
                        />
                      </div>

                      <div className="min-w-0">
                        <h4 className="font-semibold text-stone-850 text-xs truncate">
                          {item.name}
                        </h4>
                        <div className="font-mono text-[9.5px] text-stone-450 mt-0.5 uppercase">
                          SKU ID: {item.sku}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xs font-bold text-stone-850">
                        ₱{calculateMeasuredLineTotal(item.price, item.quantity, item.sellingUnitQuantity).toFixed(2)}
                      </span>
                      <div className="text-[10px] font-mono text-stone-450 mt-0.5">
                        {formatMeasuredQuantity(item.quantity, item.measurementUnit)} @ ₱{item.price.toFixed(2)} per {formatSellingMeasure(item.sellingUnitQuantity, item.measurementUnit)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Calculations summaries */}
            <div data-pdf-keep className="mt-5 pt-3.5 border-t border-dashed border-stone-250 flex flex-col items-end">
              <div className="w-full max-w-xs rounded-2xl border border-stone-200 bg-stone-50 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold uppercase tracking-wider text-stone-500">Invoice Total</span>
                  <span className="font-display text-base font-black text-stone-900">₱{invoice.totalAmount.toFixed(2)}</span>
                </div>
                {(invoice.previousBalance || 0) > 0 && (
                  <div className="mt-2 flex items-center justify-between border-t border-stone-200 pt-2 text-xs">
                    <span className="font-semibold text-stone-500">Previous Balance</span>
                    <span className="font-mono font-bold text-amber-700">+ ₱{(invoice.previousBalance || 0).toFixed(2)}</span>
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between border-t border-stone-200 pt-2 text-xs">
                  <span className="font-semibold text-stone-500">DP / Amount Paid</span>
                  <span className="font-mono font-bold text-emerald-700">
                    − ₱{(invoice.amountPaid ?? (invoice.paymentStatus === PaymentStatus.PAID ? invoice.totalAmount : 0)).toFixed(2)}
                  </span>
                </div>
                <div className={`mt-2 flex items-center justify-between rounded-xl px-3 py-2.5 ${
                  invoice.totalAmount + (invoice.previousBalance || 0) - (invoice.amountPaid ?? (invoice.paymentStatus === PaymentStatus.PAID ? invoice.totalAmount : 0)) > 0
                    ? "bg-amber-50 text-amber-800 ring-1 ring-amber-300"
                    : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                }`}>
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    {invoice.totalAmount + (invoice.previousBalance || 0) - (invoice.amountPaid ?? (invoice.paymentStatus === PaymentStatus.PAID ? invoice.totalAmount : 0)) > 0
                      ? "Balance Due"
                      : "Balance / Credit"}
                  </span>
                  <span className="font-display text-xl font-black">
                    ₱{(invoice.totalAmount + (invoice.previousBalance || 0) - (invoice.amountPaid ?? (invoice.paymentStatus === PaymentStatus.PAID ? invoice.totalAmount : 0))).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Standard payment references branding */}
            <div data-pdf-keep className="mt-5 bg-stone-50 border border-stone-200 rounded-2xl p-3 text-xs select-none">
              <div className="flex items-center gap-1.5 text-stone-700 font-extrabold text-[10px] mb-2 uppercase tracking-wider">
                <Printer className="w-3.5 h-3.5 text-amber-500" />
                Transfer references
              </div>
              
              <div data-export-desktop-class="grid-cols-2" className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-stone-600 font-mono text-[10px] leading-normal">
                {getPaymentMethods(settings).map((method) => (
                  <div key={method.id} className="bg-white border border-stone-200 rounded-xl p-2 flex items-center gap-2">
                    {method.qrCodeDataUrl ? (
                      <img src={method.qrCodeDataUrl} alt={`${method.label} QR code`} crossOrigin="anonymous" className="w-12 h-12 object-contain border border-stone-150 rounded-lg bg-white shrink-0" />
                    ) : (
                      <Coins className="w-4 h-4 text-[#007DFE] shrink-0" />
                    )}
                    <span>
                      <strong className="block text-stone-800 uppercase">{method.label}</strong>
                      {method.accountNumber && <span className="block">{method.accountNumber}</span>}
                      {method.accountName && <span className="block text-stone-450">{method.accountName}</span>}
                    </span>
                  </div>
                ))}
                {settings.bankDetails && (
                  <div data-export-desktop-class="col-span-2" className="sm:col-span-2 flex items-start gap-2">
                    <Landmark className="w-3.5 h-3.5 text-stone-450 mt-0.5 shrink-0" />
                    <span>{settings.bankDetails}</span>
                  </div>
                )}
              </div>
            </div>

            {invoice.description && (
              <div data-pdf-keep className="mt-4 pt-3 border-t border-stone-150 text-left">
                <span className="block text-[8.5px] font-mono uppercase tracking-widest text-stone-400">Invoice Description / Notes</span>
                <p className="text-stone-600 font-medium text-xs mt-1 leading-relaxed bg-stone-50 p-2.5 rounded-xl border border-stone-100">
                  {invoice.description}
                </p>
              </div>
            )}

            {invoice.orderPhotoDataUrl && (
              <div data-pdf-keep className="mt-4 border-t border-stone-150 pt-3">
                <span className="mb-1.5 block text-[8.5px] font-mono uppercase tracking-widest text-stone-400">Packed Order Photo</span>
                <img src={invoice.orderPhotoDataUrl} alt={`Order for ${invoice.customerName}`} className="max-h-64 w-full rounded-xl border border-stone-200 object-contain bg-stone-50" />
              </div>
            )}
            
            <p data-pdf-keep className="text-center font-mono text-[8.5px] text-stone-405 uppercase tracking-widest mt-4">
              ✨ Handmade customized joy • Crafted with love ✨
            </p>
          </div>

          {/* Download Action Triggers */}
          <div className="flex items-center gap-3 mt-6 w-full max-w-2xl justify-center">
            {invoice.orderPhotoDataUrl && (
              <button onClick={handleSharePhoto} className="py-2.5 px-4 bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-colors">
                <Share2 className="w-4 h-4" />
                Share Order Photo
              </button>
            )}
            <button
              onClick={handleDownloadPNG}
              className="py-2.5 px-4 bg-white hover:bg-stone-50 border border-stone-250 text-stone-700 text-xs font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-colors"
            >
              <ImageIcon className="w-4 h-4 text-amber-500" />
              Download PNG Invoice
            </button>
            <button
              onClick={handleDownloadPDF}
              className="py-2.5 px-4 bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-md transition-colors"
            >
              <FileDown className="w-4 h-4 text-amber-400" />
              Download PDF Invoice
            </button>
          </div>
        </div>

        {/* Right Column: copying text scripts area */}
        <div className="xl:col-span-4 flex flex-col gap-6">
          <div className="bg-white border border-stone-250/60 rounded-3xl p-5 md:p-6 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-extrabold text-sm text-stone-800 uppercase tracking-widest flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-500" />
                Copyable Chat Script
              </h3>
              
              <button
                onClick={handleCopyScript}
                className={`py-1.5 px-3 rounded-lg text-[10.5px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  copied
                    ? "bg-emerald-500 text-white"
                    : "bg-orange-50 border border-orange-200 text-orange-950 hover:bg-orange-100"
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Script
                  </>
                )}
              </button>
            </div>

            <p className="text-stone-500 text-xs leading-relaxed mb-4">
              Instantly compile this formatted text outline to send coordinates, totals, SKU models, andGCash transfer options to your customer on WhatsApp / Instagram / Viber chats.
            </p>

            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4">
              <pre className="font-mono text-[11px] leading-relaxed text-stone-700 whitespace-pre-wrap select-all font-medium select-none overflow-x-auto max-h-96">
                {getCompiledScript()}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
