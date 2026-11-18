import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Loader2,
  MapPin,
  PackageCheck,
  ShieldCheck,
  Store,
  Truck,
  Wallet,
  X,
} from 'lucide-react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { OperationType, db, handleFirestoreError, signInWithGoogle } from '../lib/firebase';
import type {
  CartItem,
  GeoLocation,
  PaymentMethod,
  Pharmacy,
  SavedAddress,
} from '../types/mediquick';
import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD } from '../types/mediquick';
import { MapsLocationWidget } from './MapsLocationWidget';
import { RazorpayModal } from './RazorpayModal';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  items: CartItem[];
  isBuyNow: boolean;
  location: GeoLocation;
  onLocationChange: (loc: GeoLocation) => void;
  pharmacies: Pharmacy[];
  savedAddresses: SavedAddress[];
  onSaveCurrentAddress: (label: string) => Promise<void>;
  mapsApiKey: string;
  onClearCartAfterOrder: () => Promise<void>;
  onOrderSuccessNavigate: (orderId: string) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  user,
  items,
  isBuyNow,
  location,
  onLocationChange,
  pharmacies,
  savedAddresses,
  onSaveCurrentAddress,
  mapsApiKey,
  onClearCartAfterOrder,
  onOrderSuccessNavigate,
}) => {
  const [customerName, setCustomerName] = useState(user?.displayName || '');
  const [customerPhone, setCustomerPhone] = useState('+91 98450 11223');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('RAZORPAY');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placedOrder, setPlacedOrder] = useState<{
    id: string;
    orderNumber: string;
    total: number;
    pharmacyName: string;
    paymentMethod: PaymentMethod;
  } | null>(null);

  const [razorpaySession, setRazorpaySession] = useState<{
    orderId: string;
    amountPaise: number;
  } | null>(null);

  useEffect(() => {
    if (user?.displayName && !customerName) {
      setCustomerName(user.displayName);
    }
  }, [user?.displayName]);

  useEffect(() => {
    if (!isOpen) {
      setPlacedOrder(null);
      setError(null);
      setRazorpaySession(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const deliveryFee = items.length === 0 || subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
  const totalAmount = subtotal + deliveryFee;

  // Determine fulfilling pharmacy from first item (or nearest pharmacy fallback)
  const primaryItem = items[0];
  const matchedPharmacy =
    pharmacies.find((p) => p.id === primaryItem?.pharmacyId) || pharmacies[0];

  const commitOrderToFirestore = async (
    activeUser: User,
    paymentDetails?: {
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    },
  ) => {
    if (!matchedPharmacy) {
      throw new Error('No nearby pharmacy available to fulfill this order.');
    }

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const orderNumber = `MQ-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const orderItems = items.slice(0, 30).map((i) => ({
      medicineId: i.medicineId,
      name: i.name,
      brand: i.brand,
      price: i.price,
      quantity: i.quantity,
      imageUrl: i.imageUrl,
      packSize: i.packSize,
      isRare: i.isRare,
    }));

    const batch = writeBatch(db);

    const orderPayload: Record<string, unknown> = {
      orderNumber,
      userId: activeUser.uid,
      customerName: customerName.trim() || activeUser.displayName || 'Customer',
      customerPhone: customerPhone.trim() || '+91 98450 11223',
      pharmacyId: matchedPharmacy.id,
      pharmacyName: matchedPharmacy.name,
      pharmacyLat: matchedPharmacy.lat,
      pharmacyLng: matchedPharmacy.lng,
      pharmacyOwnerUid: matchedPharmacy.ownerUid,
      items: orderItems,
      subtotal,
      deliveryFee,
      totalAmount,
      paymentMethod,
      paymentStatus: paymentMethod === 'RAZORPAY' ? 'PAID' : 'PENDING',
      deliveryAddress: location.address.slice(0, 280),
      deliveryLat: location.lat,
      deliveryLng: location.lng,
      status: 'PLACED',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (paymentDetails) {
      orderPayload.razorpayOrderId = paymentDetails.razorpay_order_id;
      orderPayload.razorpayPaymentId = paymentDetails.razorpay_payment_id;
    }

    batch.set(doc(db, 'orders', orderId), orderPayload);

    const paymentPayload: Record<string, unknown> = {
      orderId,
      orderNumber,
      userId: activeUser.uid,
      amount: totalAmount,
      currency: 'INR',
      method: paymentMethod,
      status: paymentMethod === 'RAZORPAY' ? 'VERIFIED' : 'PENDING',
      verified: paymentMethod === 'RAZORPAY',
      createdAt: serverTimestamp(),
    };

    if (paymentDetails) {
      paymentPayload.razorpayOrderId = paymentDetails.razorpay_order_id;
      paymentPayload.razorpayPaymentId = paymentDetails.razorpay_payment_id;
      paymentPayload.razorpaySignature = paymentDetails.razorpay_signature;
    }

    batch.set(doc(db, 'payments', paymentId), paymentPayload);

    batch.set(doc(db, 'notifications', notifId), {
      userId: activeUser.uid,
      title: `Order ${orderNumber} Placed`,
      message: `Sent directly to ${matchedPharmacy.name}. Waiting for pharmacy confirmation.`,
      type: 'ORDER_PLACED',
      orderId,
      read: false,
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
    }

    if (!isBuyNow) {
      await onClearCartAfterOrder();
    }

    setPlacedOrder({
      id: orderId,
      orderNumber,
      total: totalAmount,
      pharmacyName: matchedPharmacy.name,
      paymentMethod,
    });
  };

  const handlePlaceOrder = async () => {
    setError(null);
    if (!user) {
      try {
        await signInWithGoogle();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Please sign in to place an order.');
      }
      return;
    }

    if (items.length === 0) {
      setError('No medicines selected.');
      return;
    }
    if (customerName.trim().length < 2) {
      setError('Please enter recipient full name.');
      return;
    }
    if (customerPhone.trim().length < 6) {
      setError('Please enter a valid contact phone number.');
      return;
    }
    if (location.address.trim().length < 4) {
      setError('Please select a valid delivery address on the map.');
      return;
    }

    setPlacing(true);
    try {
      if (paymentMethod === 'COD') {
        await commitOrderToFirestore(user);
        setPlacing(false);
        return;
      }

      // Razorpay online payment flow
      const orderRes = await fetch('/api/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: totalAmount,
          currency: 'INR',
          receipt: `mq_${Date.now()}`,
        }),
      });

      const orderData = (await orderRes.json()) as {
        mode: 'live' | 'sandbox';
        keyId: string | null;
        orderId: string;
        amount: number;
        currency: string;
        error?: string;
      };

      if (!orderRes.ok) {
        throw new Error(orderData.error || 'Could not initiate Razorpay order.');
      }

      if (orderData.mode === 'live' && orderData.keyId && window.Razorpay) {
        const rzp = new window.Razorpay({
          key: orderData.keyId,
          amount: orderData.amount,
          currency: orderData.currency,
          name: 'MediQuick',
          description: 'Instant Medicine Order',
          order_id: orderData.orderId,
          prefill: {
            name: customerName,
            email: user.email || '',
            contact: customerPhone,
          },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              const verifyRes = await fetch('/api/payments/razorpay/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
              });
              const verifyJson = (await verifyRes.json()) as { verified?: boolean; error?: string };
              if (!verifyRes.ok || !verifyJson.verified) {
                throw new Error(verifyJson.error || 'Payment verification failed.');
              }
              await commitOrderToFirestore(user, response);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Payment verification failed.');
            } finally {
              setPlacing(false);
            }
          },
          modal: {
            ondismiss: () => setPlacing(false),
          },
        });
        rzp.open();
      } else {
        setRazorpaySession({
          orderId: orderData.orderId,
          amountPaise: orderData.amount,
        });
        setPlacing(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to place order.');
      setPlacing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative z-10 w-full max-w-4xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {placedOrder ? 'Order Placed Successfully' : 'Direct Medicine Checkout'}
            </h2>
            <p className="text-xs text-slate-500">
              {placedOrder
                ? `Order ${placedOrder.orderNumber} sent directly to ${placedOrder.pharmacyName}`
                : 'Your order is placed directly with the pharmacy without waiting for prior approval.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close checkout"
            className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {placedOrder ? (
          <div className="p-8 text-center space-y-5 overflow-y-auto">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-xl font-bold text-slate-900">Order Placed Successfully!</h3>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                Your order <span className="font-mono font-semibold text-slate-900">{placedOrder.orderNumber}</span> has been saved and routed to{' '}
                <span className="font-semibold text-slate-900">{placedOrder.pharmacyName}</span>.
              </p>
            </div>

            <div className="max-w-md mx-auto bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Order ID</span>
                <span className="font-mono font-semibold text-slate-900">{placedOrder.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Mode</span>
                <span className="font-medium text-slate-900">
                  {placedOrder.paymentMethod === 'RAZORPAY'
                    ? 'Online Payment (Razorpay Verified)'
                    : 'Cash on Delivery'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Amount</span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  ₹{placedOrder.total.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status</span>
                <span className="font-semibold text-teal-700">Sent to Pharmacy Dashboard</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOrderSuccessNavigate(placedOrder.id);
                }}
                className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors"
              >
                <Truck className="w-4 h-4" />
                Track Order in My Orders
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left column: Address + Map + Contact + Payment */}
            <div className="lg:col-span-7 space-y-6">
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-teal-600" />
                    1. Select Delivery Location on Map
                  </h3>
                </div>
                <MapsLocationWidget
                  mapsApiKey={mapsApiKey}
                  location={location}
                  onLocationChange={onLocationChange}
                  pharmacies={pharmacies}
                  selectedPharmacyId={matchedPharmacy?.id}
                  savedAddresses={savedAddresses}
                  onSaveCurrentAddress={user ? onSaveCurrentAddress : undefined}
                  heightClass="h-[240px]"
                  allowManualPin
                  showSearchControls
                />
              </section>

              <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Recipient Name
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Full name"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Delivery Contact Phone
                  </label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+91 98450 00000"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600"
                  />
                </div>
              </section>

              <section className="space-y-3 pt-2 border-t border-slate-100">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-teal-600" />
                  2. Payment Method
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('RAZORPAY')}
                    className={`p-3.5 rounded-xl border text-left transition-colors ${
                      paymentMethod === 'RAZORPAY'
                        ? 'bg-teal-50/70 border-teal-600'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-900">
                        Online Payment (Razorpay)
                      </span>
                      <ShieldCheck className="w-4 h-4 text-teal-600" />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      UPI, Cards & NetBanking with instant cryptographic verification.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('COD')}
                    className={`p-3.5 rounded-xl border text-left transition-colors ${
                      paymentMethod === 'COD'
                        ? 'bg-teal-50/70 border-teal-600'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-900">
                        Cash on Delivery (COD)
                      </span>
                      <Wallet className="w-4 h-4 text-slate-600" />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Pay by cash or UPI QR when your medicine reaches your doorstep.
                    </p>
                  </button>
                </div>
              </section>
            </div>

            {/* Right column: Order Summary */}
            <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <PackageCheck className="w-4 h-4 text-teal-600" />
                    Order Summary
                  </h3>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {items.reduce((s, i) => s + i.quantity, 0)} items
                  </span>
                </div>

                {matchedPharmacy && (
                  <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs space-y-1">
                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <Store className="w-3.5 h-3.5 text-teal-600" />
                      Fulfilling Pharmacy: {matchedPharmacy.name}
                    </div>
                    <p className="text-slate-500">
                      Est. dispatch in {matchedPharmacy.deliveryTimeMins} mins · {matchedPharmacy.address}
                    </p>
                  </div>
                )}

                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {items.map((item) => (
                    <div key={item.medicineId} className="flex items-center gap-3 text-xs">
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        className="w-11 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{item.name}</p>
                        <p className="text-slate-500 tabular-nums">
                          Qty {item.quantity} × ₹{item.price.toLocaleString('en-IN')}
                        </p>
                      </div>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        ₹{(item.price * item.quantity).toLocaleString('en-IN')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-200">
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Medicines Subtotal</span>
                    <span className="font-mono tabular-nums">₹{subtotal.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Express Delivery Fee</span>
                    <span className="font-mono tabular-nums">
                      {deliveryFee === 0 ? 'FREE' : `₹${deliveryFee}`}
                    </span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-200">
                    <span>Total Amount</span>
                    <span className="font-mono tabular-nums">
                      ₹{totalAmount.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                {error && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  disabled={placing || items.length === 0}
                  onClick={handlePlaceOrder}
                  className="w-full py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
                >
                  {placing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing Order...
                    </>
                  ) : !user ? (
                    'Sign in with Google & Place Order'
                  ) : paymentMethod === 'RAZORPAY' ? (
                    `Pay ₹${totalAmount.toLocaleString('en-IN')} & Place Order`
                  ) : (
                    `Place Order (COD · ₹${totalAmount.toLocaleString('en-IN')})`
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {razorpaySession && user && (
        <RazorpayModal
          isOpen={Boolean(razorpaySession)}
          amount={totalAmount}
          orderId={razorpaySession.orderId}
          customerName={customerName || user.displayName || 'Customer'}
          customerEmail={user.email || 'customer@mediquick.app'}
          onCancel={() => {
            setRazorpaySession(null);
            setPlacing(false);
          }}
          onSuccess={async (verifiedPayload) => {
            setRazorpaySession(null);
            setPlacing(true);
            try {
              await commitOrderToFirestore(user, verifiedPayload);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Order creation failed.');
            } finally {
              setPlacing(false);
            }
          }}
        />
      )}
    </div>
  );
};
