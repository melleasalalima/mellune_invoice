const admin = require("firebase-admin");

const PAGE_SIZE = 250;
const WRITE_BATCH_SIZE = 400;

function getCustomerKey(invoice) {
  if (!invoice) return null;
  const email = invoice.customerEmail && String(invoice.customerEmail).trim().toLowerCase();
  const phone = invoice.customerPhone && String(invoice.customerPhone).replace(/\D/g, "");
  const name = invoice.customerName && String(invoice.customerName).trim().toLowerCase();
  const identity = email || phone || name;
  return identity ? identity.replace(/[^a-z0-9]/g, "_") : null;
}

async function main() {
  if (!process.argv.includes("--apply")) {
    console.log("No Firestore reads or writes performed.");
    console.log("To rebuild lifetime customer aggregates, authenticate with Firebase Admin credentials and run:");
    console.log("  node backfill-customer-totals.js --apply");
    console.log("This reads every invoice document once, so run only when the Firestore daily read quota has reset.");
    return;
  }

  admin.initializeApp();
  const db = admin.firestore();
  const invoiceCollection = db.collection("invoices");
  const totals = new Map();
  let lastDocument = null;
  let invoiceCount = 0;
  let totalPaidRevenue = 0;

  while (true) {
    let pageQuery = invoiceCollection.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastDocument) pageQuery = pageQuery.startAfter(lastDocument);
    const page = await pageQuery.get();
    if (page.empty) break;

    for (const invoiceDoc of page.docs) {
      const invoice = invoiceDoc.data();
      const key = getCustomerKey(invoice);
      invoiceCount += 1;
      const paidAmount = invoice.paymentStatus === "Paid" ? Number(invoice.totalAmount || 0) : 0;
      totalPaidRevenue += paidAmount;

      if (!key) continue;
      const current = totals.get(key) || {
        totalSpent: 0,
        invoiceCount: 0,
        displayName: null,
        email: null,
        phone: null,
      };
      current.totalSpent += paidAmount;
      current.invoiceCount += 1;
      current.displayName = invoice.customerName || current.displayName;
      current.email = invoice.customerEmail || current.email;
      current.phone = invoice.customerPhone || current.phone;
      totals.set(key, current);
    }

    lastDocument = page.docs[page.docs.length - 1];
    console.log(`Read ${invoiceCount} invoices; aggregated ${totals.size} customer identities.`);
    if (page.size < PAGE_SIZE) break;
  }

  const totalEntries = Array.from(totals.entries());
  for (let index = 0; index < totalEntries.length; index += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    for (const [key, value] of totalEntries.slice(index, index + WRITE_BATCH_SIZE)) {
      batch.set(db.doc(`customerTotals/${key}`), {
        ...value,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  const topCustomer = totalEntries
    .map(([customerKey, value]) => ({ customerKey, ...value }))
    .sort((left, right) => right.totalSpent - left.totalSpent)[0];
  const summaryBatch = db.batch();
  summaryBatch.set(db.doc("aggregates/shopStats"), {
    totalInvoices: invoiceCount,
    totalPaidRevenue,
  }, { merge: true });
  if (topCustomer) {
    summaryBatch.set(db.doc("aggregates/topSpender"), {
      customerKey: topCustomer.customerKey,
      displayName: topCustomer.displayName,
      totalSpent: topCustomer.totalSpent,
      email: topCustomer.email,
      phone: topCustomer.phone,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await summaryBatch.commit();

  console.log(`Backfill complete: ${invoiceCount} invoices, ${totals.size} customer totals, ${totalPaidRevenue.toFixed(2)} paid revenue.`);
}

main().catch((error) => {
  console.error("Customer aggregate backfill failed:", error);
  process.exitCode = 1;
});
