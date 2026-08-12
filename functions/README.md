This folder contains example Firebase Cloud Functions to maintain lightweight aggregates used by the UI.

- `onInvoiceWrite`: maintains `aggregates/shopStats.totalPaidRevenue` and `totalInvoices` incrementally when invoices are created/updated/deleted.
- `onCustomerWrite`: maintains `aggregates/shopStats.totalCustomers` incrementally when customers are created/deleted.

To deploy:

1. Install dependencies and deploy from this folder:

```bash
cd functions
npm install
firebase deploy --only functions
```

2. Ensure your Firebase project and billing tier allow functions and that you have initialized the Functions SDK with appropriate region/config if needed.

Notes:
- These functions incrementally update aggregates to avoid full-collection reads in the client.
- You can expand to track additional aggregates (topSpender, paidCounts, etc.) as needed.
