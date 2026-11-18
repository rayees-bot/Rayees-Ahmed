/**
 * Phase 0 Security Rules Verification Harness (Dirty Dozen Assertions)
 * Documents and validates the 12 adversarial test cases against firestore.rules.
 */
export interface DirtyDozenCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedOutcome: 'PERMISSION_DENIED';
  payloadSample: Record<string, unknown>;
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Shadow Field Injection on Order Create',
    collection: 'orders',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { orderNumber: 'MQ-9999', userId: 'uidA', isFreeOrder: true },
  },
  {
    id: 2,
    name: 'Cross-User Cart Mutation',
    collection: 'carts/uidA/items',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { medicineId: 'med_1', userId: 'uidA', quantity: 1 },
  },
  {
    id: 3,
    name: 'Negative Total Amount Order',
    collection: 'orders',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { totalAmount: -100, subtotal: -100 },
  },
  {
    id: 4,
    name: 'Unverified Email Order Write',
    collection: 'orders',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { authToken: { email_verified: false } },
  },
  {
    id: 5,
    name: 'Document ID Poisoning',
    collection: 'orders',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { docId: 'invalid/path$with*chars' },
  },
  {
    id: 6,
    name: 'Unbounded Order Items Array (>30)',
    collection: 'orders',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { itemsLength: 31 },
  },
  {
    id: 7,
    name: 'Terminal State Modification After DELIVERED',
    collection: 'orders',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { status: 'PLACED' },
  },
  {
    id: 8,
    name: 'Customer Self-Accepting Own Order',
    collection: 'orders',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { actorUid: 'customerUid', status: 'ACCEPTED' },
  },
  {
    id: 9,
    name: 'Unfiltered Order List Scraping',
    collection: 'orders',
    operation: 'list',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { queryFilter: 'none' },
  },
  {
    id: 10,
    name: 'Cross-User Saved Address PII Read',
    collection: 'users/uidA/addresses',
    operation: 'get',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { actorUid: 'uidB' },
  },
  {
    id: 11,
    name: 'Client Timestamp Forgery',
    collection: 'orders',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { createdAt: '1999-01-01T00:00:00Z' },
  },
  {
    id: 12,
    name: 'Immutable Order Owner Tampering',
    collection: 'orders',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payloadSample: { userId: 'uidB' },
  },
];
