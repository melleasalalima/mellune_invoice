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

async function updateCustomerTotalAndTopSpender(key, info, delta) {
  if (!key || !delta) return;
  const custRef = db.doc(`aggregates/customerTotals/${key}`);
  const topRef = db.doc(`aggregates/topSpender`);

  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(custRef);
      const prior = snap.exists ? (snap.data().totalSpent || 0) : 0;
      const nextTotal = prior + delta;
      const payload = {
        totalSpent: nextTotal,
        displayName: info?.customerName || info?.name || null,
        email: info?.customerEmail || info?.email || null,
        phone: info?.customerPhone || info?.phone || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      t.set(custRef, payload, { merge: true });

      const topSnap = await t.get(topRef);
      const topTotal = topSnap.exists ? (topSnap.data().totalSpent || 0) : 0;
      if (nextTotal > topTotal) {
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
      if (after.paymentStatus === "PAID") {
        deltaTotalPaid += Number(after.totalAmount || 0);
      }
    }

    // Invoice deleted
    if (before && !after) {
      deltaInvoiceCount -= 1;
      if (before.paymentStatus === "PAID") {
        deltaTotalPaid -= Number(before.totalAmount || 0);
      }
    }

    // Invoice updated
    if (before && after) {
      // If payment status changed, adjust accordingly
      const beforePaid = before.paymentStatus === "PAID";
      const afterPaid = after.paymentStatus === "PAID";
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
      // Handle creation
      if (!before && after) {
        if (after.paymentStatus === 'PAID' && afterKey) {
          await updateCustomerTotalAndTopSpender(afterKey, after, Number(after.totalAmount || 0));
        }
      }
      // Handle deletion
      if (before && !after) {
        if (before.paymentStatus === 'PAID' && beforeKey) {
          await updateCustomerTotalAndTopSpender(beforeKey, before, -Number(before.totalAmount || 0));
        }
      }
      // Handle update
      if (before && after) {
        const beforePaid = before.paymentStatus === 'PAID';
        const afterPaid = after.paymentStatus === 'PAID';
        const beforeAmount = Number(before.totalAmount || 0);
        const afterAmount = Number(after.totalAmount || 0);

        if (beforeKey === afterKey) {
          if (!beforePaid && afterPaid && afterKey) {
            await updateCustomerTotalAndTopSpender(afterKey, after, afterAmount);
          } else if (beforePaid && !afterPaid && beforeKey) {
            await updateCustomerTotalAndTopSpender(beforeKey, before, -beforeAmount);
          } else if (beforePaid && afterPaid && afterKey) {
            await updateCustomerTotalAndTopSpender(afterKey, after, afterAmount - beforeAmount);
          }
        } else {
          // Customer changed on invoice: move amounts between keys
          if (beforePaid && beforeKey) {
            await updateCustomerTotalAndTopSpender(beforeKey, before, -beforeAmount);
          }
          if (afterPaid && afterKey) {
            await updateCustomerTotalAndTopSpender(afterKey, after, afterAmount);
          }
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
