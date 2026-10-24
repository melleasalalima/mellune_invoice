const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// Helper to safely increment a numeric field
const inc = (n) => admin.firestore.FieldValue.increment(n);

// Normalize a customer identity into a safe key
function getCustomerKey(invoiceData) {
  if (!invoiceData) return null;
  const email = invoiceData.customerEmail && String(invoiceData.customerEmail).trim().toLowerCase();
  const phone = invoiceData.customerPhone && String(invoiceData.customerPhone).replace(/\D/g, '');
  const name = invoiceData.customerName && String(invoiceData.customerName).trim().toLowerCase();
  const base = email || phone || name;
  if (!base) return null;
  return base.replace(/[^a-z0-9]/g, '_');
}

async function updateCustomerTotalAndTopSpender(key, info, spendDelta, invoiceDelta = 0) {
  if (!key || (!spendDelta && !invoiceDelta)) return;
  const custRef = db.doc(`customerTotals/${key}`);
  const topRef = db.doc(`aggregates/topSpender`);

  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(custRef);
      const prior = snap.exists ? (snap.data().totalSpent || 0) : 0;
      const nextTotal = Math.max(0, prior + spendDelta);
      const priorInvoiceCount = snap.exists ? (snap.data().invoiceCount || 0) : 0;
      const payload = {
        totalSpent: nextTotal,
        invoiceCount: Math.max(0, priorInvoiceCount + invoiceDelta),
        displayName: info?.customerName || info?.name || null,
        email: info?.customerEmail || info?.email || null,
        phone: info?.customerPhone || info?.phone || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      t.set(custRef, payload, { merge: true });

      const topSnap = await t.get(topRef);
      const topTotal = topSnap.exists ? (topSnap.data().totalSpent || 0) : 0;
      if (nextTotal > topTotal || (topSnap.exists && topSnap.data().customerKey === key && nextTotal < topTotal)) {
        t.set(topRef, {
          customerKey: key,
          totalSpent: nextTotal,
          displayName: payload.displayName,
          email: payload.email,
          phone: payload.phone,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });
  } catch (err) {
    console.error('Failed to update customer total/topSpender for', key, err);
  }
}

exports.onInvoiceWrite = functions.firestore
  .document("invoices/{invoiceId}")
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    let deltaTotalPaid = 0;
    let deltaInvoiceCount = 0;

    // Invoice created
    if (!before && after) {
      deltaInvoiceCount += 1;
      if (after.paymentStatus === "Paid") {
        deltaTotalPaid += Number(after.totalAmount || 0);
      }
    }

    // Invoice deleted
    if (before && !after) {
      deltaInvoiceCount -= 1;
      if (before.paymentStatus === "Paid") {
        deltaTotalPaid -= Number(before.totalAmount || 0);
      }
    }

    // Invoice updated
    if (before && after) {
      // If payment status changed, adjust accordingly
      const beforePaid = before.paymentStatus === "Paid";
      const afterPaid = after.paymentStatus === "Paid";
      const beforeAmount = Number(before.totalAmount || 0);
      const afterAmount = Number(after.totalAmount || 0);

      if (!beforePaid && afterPaid) {
        deltaTotalPaid += afterAmount;
      } else if (beforePaid && !afterPaid) {
        deltaTotalPaid -= beforeAmount;
      } else if (beforePaid && afterPaid) {
        // If both paid but amount changed, apply delta
        deltaTotalPaid += (afterAmount - beforeAmount);
      }
    }

    // Maintain per-customer totals and topSpender
    try {
      const beforeKey = getCustomerKey(before);
      const afterKey = getCustomerKey(after);
      if (!before && after && afterKey) {
        const paidAmount = after.paymentStatus === 'Paid' ? Number(after.totalAmount || 0) : 0;
        await updateCustomerTotalAndTopSpender(afterKey, after, paidAmount, 1);
      } else if (before && !after && beforeKey) {
        const paidAmount = before.paymentStatus === 'Paid' ? Number(before.totalAmount || 0) : 0;
        await updateCustomerTotalAndTopSpender(beforeKey, before, -paidAmount, -1);
      } else if (before && after) {
        const beforePaidAmount = before.paymentStatus === 'Paid' ? Number(before.totalAmount || 0) : 0;
        const afterPaidAmount = after.paymentStatus === 'Paid' ? Number(after.totalAmount || 0) : 0;
        const paidDelta = afterPaidAmount - beforePaidAmount;

        if (beforeKey === afterKey) {
          if (afterKey && paidDelta) await updateCustomerTotalAndTopSpender(afterKey, after, paidDelta);
        } else {
          if (beforeKey) await updateCustomerTotalAndTopSpender(beforeKey, before, -beforePaidAmount, -1);
          if (afterKey) await updateCustomerTotalAndTopSpender(afterKey, after, afterPaidAmount, 1);
        }
      }
    } catch (err) {
      console.error('Customer totals update failed:', err);
    }

    const aggRef = db.doc("aggregates/shopStats");
    const writes = {};
    if (deltaInvoiceCount !== 0) writes.totalInvoices = inc(deltaInvoiceCount);
    if (deltaTotalPaid !== 0) writes.totalPaidRevenue = inc(deltaTotalPaid);

    if (Object.keys(writes).length > 0) {
      try {
        await aggRef.set(writes, { merge: true });
      } catch (err) {
        console.error("Failed to update aggregates/shopStats:", err);
      }
    }
  });

exports.onCustomerWrite = functions.firestore
  .document("customers/{customerId}")
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    let deltaCustomers = 0;
    if (!before && after) deltaCustomers += 1;
    if (before && !after) deltaCustomers -= 1;

    if (deltaCustomers !== 0) {
      const aggRef = db.doc("aggregates/shopStats");
      try {
        await aggRef.set({ totalCustomers: inc(deltaCustomers) }, { merge: true });
      } catch (err) {
        console.error("Failed to update aggregates/shopStats for customers:", err);
      }
    }
  });
