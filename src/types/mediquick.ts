export type ActiveView =
  | 'shop'
  | 'map'
  | 'orders'
  | 'emergency'
  | 'hunter'
  | 'partner';

export type MedicineCategory =
  | 'All'
  | 'Pain & Fever'
  | 'Antibiotics'
  | 'Respiratory'
  | 'Diabetes & Insulin'
  | 'Cardiac & BP'
  | 'Rare & Biologics'
  | 'Vitamins & Immunity'
  | 'First Aid';

export type OrderStatus =
  | 'PLACED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'PARTNER_ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

export type PaymentMethod = 'COD' | 'RAZORPAY';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

export interface GeoLocation {
  lat: number;
  lng: number;
  address: string;
  label?: string;
}

export interface Medicine {
  id: string;
  name: string;
  brand: string;
  genericName: string;
  category: Exclude<MedicineCategory, 'All'>;
  price: number;
  mrp: number;
  packSize: string;
  dosageForm: string;
  imageUrl: string;
  description: string;
  stock: number;
  inStock: boolean;
  isRare: boolean;
  requiresColdChain: boolean;
  prescriptionOptional: boolean;
  pharmacyId: string;
  pharmacyName: string;
  pharmacyOwnerUid: string;
  etaMins: number;
}

export interface Pharmacy {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  rating: number;
  open24x7: boolean;
  isRareSpecialist: boolean;
  deliveryTimeMins: number;
  ownerUid: string;
}

export interface DeliveryPartner {
  id: string;
  name: string;
  phone: string;
  vehicleType: string;
  plateNumber: string;
  currentLat: number;
  currentLng: number;
  available: boolean;
  activeOrderId?: string;
  ownerUid: string;
}

export interface CartItem {
  medicineId: string;
  userId: string;
  name: string;
  brand: string;
  price: number;
  quantity: number;
  imageUrl: string;
  packSize: string;
  isRare: boolean;
  pharmacyId: string;
  pharmacyName: string;
  pharmacyOwnerUid: string;
}

export interface OrderItem {
  medicineId: string;
  name: string;
  brand: string;
  price: number;
  quantity: number;
  imageUrl: string;
  packSize: string;
  isRare: boolean;
}

export interface Order {
  id: string;
  orderNumber: string;
  userId: string;
  customerName: string;
  customerPhone: string;
  pharmacyId: string;
  pharmacyName: string;
  pharmacyLat: number;
  pharmacyLng: number;
  pharmacyOwnerUid: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  status: OrderStatus;
  rejectionReason?: string;
  partnerId?: string;
  partnerName?: string;
  partnerPhone?: string;
  partnerOwnerUid?: string;
  partnerLat?: number;
  partnerLng?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: 'PENDING' | 'VERIFIED' | 'FAILED' | 'REFUNDED';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  verified: boolean;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'ORDER_PLACED' | 'ORDER_ACCEPTED' | 'ORDER_REJECTED' | 'DELIVERY_UPDATE' | 'EMERGENCY' | 'HUNTER';
  orderId?: string;
  read: boolean;
  createdAt: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  phone: string;
  photoURL: string;
  updatedAt: string;
}

export interface SavedAddress {
  id: string;
  userId: string;
  label: string;
  addressLine: string;
  landmark?: string;
  lat: number;
  lng: number;
  isDefault: boolean;
  createdAt: string;
}

export interface EmergencyRequest {
  id: string;
  userId: string;
  patientName: string;
  contactPhone: string;
  medicineName: string;
  dosageNotes?: string;
  urgency: 'CRITICAL_15MIN' | 'URGENT_30MIN';
  deliveryAddress: string;
  lat: number;
  lng: number;
  status: 'BROADCASTED' | 'PHARMACY_RESPONDED' | 'DISPATCHED' | 'RESOLVED';
  createdAt: string;
}

export interface MedicineHunterRequest {
  id: string;
  userId: string;
  medicineQuery: string;
  moleculeOrBrand?: string;
  quantityNeeded: string;
  cityOrArea: string;
  notes?: string;
  status: 'SEARCHING' | 'LOCATED' | 'CONFIRMED' | 'CLOSED';
  locatedPharmacy?: string;
  createdAt: string;
}

export const DELIVERY_FEE = 35;
export const FREE_DELIVERY_THRESHOLD = 499;
export const MAX_CART_QTY = 25;
export const MAX_ORDER_ITEMS = 30;
export const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
