// Simple test for Cloud Functions
// Run with: node test.js

const functions = require("firebase-functions");

// Inline test of the customer key function
function getCustomerKey(invoiceData) {
  if (!invoiceData) return null;
  const email = invoiceData.customerEmail && String(invoiceData.customerEmail).trim().toLowerCase();
  const phone = invoiceData.customerPhone && String(invoiceData.customerPhone).replace(/\D/g, '');
  const name = invoiceData.customerName && String(invoiceData.customerName).trim().toLowerCase();
  const base = email || phone || name;
  if (!base) return null;
  return base.replace(/[^a-z0-9]/g, '_');
}

console.log("Testing getCustomerKey function...\n");

// Test cases
const testCases = [
  {
    name: "Email as identifier (sanitized for Firestore)",
    input: { customerEmail: "john@example.com", customerName: "John Doe" },
    expected: "john_example_com"
  },
  {
    name: "Phone as identifier",
    input: { customerPhone: "(555) 123-4567", customerName: "Jane Smith" },
    expected: "5551234567"
  },
  {
    name: "Name as identifier",
    input: { customerName: "Bob Johnson" },
    expected: "bob_johnson"
  },
  {
    name: "Null input",
    input: null,
    expected: null
  },
  {
    name: "Empty customer data",
    input: {},
    expected: null
  },
];

testCases.forEach(test => {
  const result = getCustomerKey(test.input);
  const passed = result === test.expected;
  console.log(`${passed ? '✓' : '✗'} ${test.name}`);
  if (!passed) {
    console.log(`  Expected: ${test.expected}, Got: ${result}`);
  }
});

console.log("\n✓ Test suite complete!");
