# MediQuick Firestore Security Specification

## 1. Data Invariants
1. **Cart Ownership**: `/carts/{userId}` and `/carts/{userId}/items/{itemId}` can only be read or mutated by the authenticated owner (`request.auth.uid == userId`) with verified email.
2. **Direct Order Integrity**: Every order in `/orders/{orderId}` must have `userId == request.auth.uid` on create, `items.size() >= 1 && items.size() <= 30`, valid `pharmacyId` referencing `/pharmacies/{pharmacyId}`, and initial status `PLACED`.
3. **PII Isolation**: User profiles (`/users/{userId}`) and saved addresses (`/users/{userId}/addresses/{addressId}`) are strictly owner-only (`request.auth.uid == userId`).
4. **Tiered Order Updates**:
   - Customer (`existing().userId == request.auth.uid`) may cancel a non-terminal order (`CANCELLED`) or reassign a `REJECTED` order to a new pharmacy (`PLACED`).
   - Pharmacy Operator (`existing().pharmacyOwnerUid == request.auth.uid`) may transition `PLACED -> ACCEPTED` or `PLACED -> REJECTED`, or assign a delivery partner (`ACCEPTED -> PARTNER_ASSIGNED`).
   - Delivery Partner (`existing().partnerOwnerUid == request.auth.uid`) may update live tracking coordinates and transit statuses (`PICKED_UP`, `OUT_FOR_DELIVERY`, `DELIVERED`).
5. **Terminal State Locking**: Orders in `DELIVERED` or `CANCELLED` state cannot be modified by non-admin clients.
6. **Payment Integrity**: `/payments/{paymentId}` belongs strictly to `userId == request.auth.uid`, is immutable after creation (except admin), and links to an existing order owned by the user.
7. **Separate Workflows**: `/emergencyRequests` and `/medicineHunterRequests` remain strictly isolated from `/carts` and `/orders`, scoped to `userId == request.auth.uid` (and admins).

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on Order Create**: `{ ..., "isFreeOrder": true }` -> Rejected by `hasOnly(...)`.
2. **UID Spoofing on Cart Write**: User B writing to `/carts/userA/items/med1` -> Rejected by `isOwner(userId)`.
3. **Negative Price / Zero Quantity on Order**: `{ items: [{ price: -50, quantity: 0 }] }` -> Rejected by numeric bounds.
4. **Unverified Email Write**: `{ email_verified: false }` -> Rejected by `isVerified()`.
5. **ID Poisoning**: Creating `/orders/` with 500-char ID or `../` -> Rejected by `isValidId(orderId)`.
6. **Unbounded Array Bomb**: Creating order with 50 items -> Rejected by `data.items.size() <= 30`.
7. **Terminal State Re-open**: Updating an order with `status: 'DELIVERED'` back to `'PLACED'` -> Rejected by terminal lock.
8. **Customer Self-Accepting Order**: Customer changing `status` from `'PLACED'` to `'ACCEPTED'` -> Rejected by pharmacy operator tier check.
9. **Cross-User Order List Scraping**: Listing `/orders` without owner/pharmacy/partner match -> Rejected by `allow list` resource filter.
10. **PII Snooping**: User B reading `/users/userA/addresses/addr1` -> Rejected by `isOwner(userId)`.
11. **Timestamp Forgery**: Creating order with fake `createdAt` not matching `request.time` -> Rejected by `incoming().createdAt == request.time`.
12. **Immutable Owner Tampering**: Updating `userId` or `orderNumber` on an existing order -> Rejected by immutability invariants.
