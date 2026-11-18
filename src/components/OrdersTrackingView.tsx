import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  MapPin,
  Package,
  RefreshCw,
  ShieldCheck,
  Store,
  Truck,
  XCircle,
} from 'lucide-react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { OperationType, db, handleFirestoreError, signInWithGoogle } from '../lib/firebase';
import type { Order, OrderStatus, Pharmacy } from '../types/mediquick';
import { MapsLocationWidget } from './MapsLocationWidget';

interface OrdersTrackingViewProps {
  user: User | null;
  orders: Order[];
  pharmacies: Pharmacy[];
  mapsApiKey: string;
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string | null) => void;
  onBrowseMedicines: () => void;
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  PLACED: 'Order Placed',
  ACCEPTED: 'Pharmacy Accepted',
  REJECTED: 'Rejected by Pharmacy',
  PARTNER_ASSIGNED: 'Partner Assigned',
  PICKED_UP: 'Picked Up',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const PIPELINE_STEPS: OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PARTNER_ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

export const OrdersTrackingView: React.FC<OrdersTrackingViewProps> = ({
  user,
  orders,
  pharmacies,
  mapsApiKey,
  selectedOrderId,
  onSelectOrder,
  onBrowseMedicines,
}) => {
  const [reassigningOrderId, setReassigningOrderId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const activeOrder =
    orders.find((o) => o.id === selectedOrderId) || orders[0] || null;

  useEffect(() => {
    if (!selectedOrderId && orders.length > 0) {
      onSelectOrder(orders[0].id);
    }
  }, [orders, selectedOrderId, onSelectOrder]);

  if (!user) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-4">
        <Package className="w-10 h-10 text-teal-600 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Sign in to view My Orders</h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Track real-time pharmacy acceptance, Razorpay payment verification, and live courier movement on the map.
        </p>
        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          className="px-5 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  const handleCancelOrder = async (order: Order) => {
    setActionLoading(true);
    try {
      const batch = writeBatch(db);
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      batch.update(doc(db, 'orders', order.id), {
        status: 'CANCELLED',
        paymentStatus: order.paymentMethod === 'RAZORPAY' ? 'REFUNDED' : order.paymentStatus,
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'notifications', notifId), {
        userId: user.uid,
        title: `Order ${order.orderNumber} Cancelled`,
        message:
          order.paymentMethod === 'RAZORPAY'
            ? 'Order cancelled. Razorpay refund has been initiated.'
            : 'Your COD order has been cancelled.',
        type: 'DELIVERY_UPDATE',
        orderId: order.id,
        read: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReassignPharmacy = async (order: Order, nextPharmacy: Pharmacy) => {
    setActionLoading(true);
    try {
      const batch = writeBatch(db);
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      batch.update(doc(db, 'orders', order.id), {
        pharmacyId: nextPharmacy.id,
        pharmacyName: nextPharmacy.name,
        pharmacyLat: nextPharmacy.lat,
        pharmacyLng: nextPharmacy.lng,
        pharmacyOwnerUid: nextPharmacy.ownerUid,
        status: 'PLACED',
        rejectionReason: '',
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'notifications', notifId), {
        userId: user.uid,
        title: `Order ${order.orderNumber} Rerouted`,
        message: `Reassigned to ${nextPharmacy.name}. Waiting for pharmacy confirmation.`,
        type: 'ORDER_PLACED',
        orderId: order.id,
        read: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setReassigningOrderId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (orders.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-4">
        <Package className="w-10 h-10 text-slate-400 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">No medicine orders yet</h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Add medicines to your cart or use Buy Now to place a direct order with a nearby pharmacy.
        </p>
        <button
          type="button"
          onClick={onBrowseMedicines}
          className="px-5 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors"
        >
          Shop Medicines
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left: My Orders List */}
      <div className="lg:col-span-5 space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-bold text-slate-900">My Orders</h2>
          <span className="text-xs text-slate-500 tabular-nums">{orders.length} total</span>
        </div>

        <div className="space-y-3">
          {orders.map((order) => {
            const isSelected = activeOrder?.id === order.id;
            const isRejected = order.status === 'REJECTED';
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => onSelectOrder(order.id)}
                className={`w-full text-left p-4 rounded-2xl border transition-all ${
                  isSelected
                    ? 'bg-white border-teal-600 shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-900">
                    {order.orderNumber}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      isRejected || order.status === 'CANCELLED'
                        ? 'text-red-600'
                        : order.status === 'DELIVERED'
                          ? 'text-emerald-700'
                          : 'text-teal-700'
                    }`}
                  >
                    {STATUS_LABELS[order.status]}
                  </span>
                </div>

                <p className="text-sm font-semibold text-slate-900 mt-1.5 truncate">
                  {order.pharmacyName}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {order.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}
                </p>

                <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-slate-100 text-xs">
                  <span className="text-slate-500">
                    {order.paymentMethod === 'RAZORPAY' ? 'Razorpay' : 'COD'} · {order.paymentStatus}
                  </span>
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    ₹{order.totalAmount.toLocaleString('en-IN')}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Active Order Details & Live Tracking Map */}
      {activeOrder && (
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-mono font-semibold text-slate-900">
                  {activeOrder.orderNumber}
                </span>
                <span aria-hidden="true">·</span>
                <span>{new Date(activeOrder.createdAt).toLocaleString()}</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mt-1">
                {STATUS_LABELS[activeOrder.status]}
              </h3>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold font-mono text-slate-900 tabular-nums">
                ₹{activeOrder.totalAmount.toLocaleString('en-IN')}
              </p>
              <p className="text-xs text-slate-500 flex items-center justify-end gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
                {activeOrder.paymentMethod === 'RAZORPAY'
                  ? `Razorpay ${activeOrder.paymentStatus}`
                  : `COD · ${activeOrder.paymentStatus}`}
              </p>
            </div>
          </div>

          {/* Pharmacy Rejection Alert + Cancel or Reassign options */}
          {activeOrder.status === 'REJECTED' && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-red-900">
                    Pharmacy Could Not Fulfill This Order
                  </h4>
                  <p className="text-xs text-red-800 mt-0.5">
                    Reason: {activeOrder.rejectionReason || 'Stock temporarily unavailable at this branch.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() =>
                    setReassigningOrderId(
                      reassigningOrderId === activeOrder.id ? null : activeOrder.id,
                    )
                  }
                  className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Find Another Pharmacy
                </button>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleCancelOrder(activeOrder)}
                  className="px-3.5 py-2 rounded-xl bg-white border border-red-300 text-red-700 hover:bg-red-100 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Cancel Order
                </button>
              </div>

              {reassigningOrderId === activeOrder.id && (
                <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-800">
                    Select an alternative nearby pharmacy:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {pharmacies
                      .filter((p) => p.id !== activeOrder.pharmacyId)
                      .map((alt) => (
                        <button
                          key={alt.id}
                          type="button"
                          disabled={actionLoading}
                          onClick={() => handleReassignPharmacy(activeOrder, alt)}
                          className="p-2.5 rounded-lg border border-slate-200 hover:border-teal-600 text-left text-xs transition-colors"
                        >
                          <p className="font-semibold text-slate-900">{alt.name}</p>
                          <p className="text-slate-500 mt-0.5 tabular-nums">
                            {alt.deliveryTimeMins} mins ETA · Rating {alt.rating}
                          </p>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Status Timeline */}
          {activeOrder.status !== 'REJECTED' && activeOrder.status !== 'CANCELLED' && (
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              {PIPELINE_STEPS.map((step, idx) => {
                const currentIdx = PIPELINE_STEPS.indexOf(activeOrder.status);
                const done = currentIdx >= idx;
                return (
                  <div
                    key={step}
                    className={`p-2.5 rounded-xl border text-center space-y-1 ${
                      done
                        ? 'bg-teal-50/70 border-teal-200 text-teal-900'
                        : 'bg-slate-50 border-slate-200 text-slate-400'
                    }`}
                  >
                    <div className="flex justify-center">
                      {done ? (
                        <CheckCircle2 className="w-4 h-4 text-teal-600" />
                      ) : (
                        <Clock className="w-4 h-4" />
                      )}
                    </div>
                    <p className="text-[11px] font-semibold leading-tight">
                      {STATUS_LABELS[step]}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Live Delivery Tracking Map */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-teal-600" />
                Real-Time Delivery Tracking
              </span>
              {activeOrder.partnerName && (
                <span className="text-slate-600">
                  Courier: <strong className="text-slate-900">{activeOrder.partnerName}</strong>{' '}
                  ({activeOrder.partnerPhone})
                </span>
              )}
            </div>
            <MapsLocationWidget
              mapsApiKey={mapsApiKey}
              location={{
                lat: activeOrder.deliveryLat,
                lng: activeOrder.deliveryLng,
                address: activeOrder.deliveryAddress,
              }}
              onLocationChange={() => {}}
              pharmacies={pharmacies}
              trackingOrder={activeOrder}
              heightClass="h-[260px]"
              allowManualPin={false}
              showSearchControls={false}
            />
          </div>

          {/* Items & Address */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-xs">
            <div className="space-y-1.5">
              <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5 text-teal-600" />
                Medicines ({activeOrder.items.length})
              </p>
              {activeOrder.items.map((it, i) => (
                <div key={i} className="flex justify-between text-slate-600">
                  <span className="truncate pr-2">
                    {it.name} ×{it.quantity}
                  </span>
                  <span className="font-mono tabular-nums shrink-0">
                    ₹{(it.price * it.quantity).toLocaleString('en-IN')}
                  </span>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-teal-600" />
                Delivery Address
              </p>
              <p className="text-slate-600 leading-relaxed">{activeOrder.deliveryAddress}</p>
              <p className="text-slate-500">
                Recipient: {activeOrder.customerName} · {activeOrder.customerPhone}
              </p>
            </div>
          </div>

          {activeOrder.status === 'PLACED' && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleCancelOrder(activeOrder)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 hover:border-red-300 text-slate-700 hover:text-red-700 text-xs font-medium transition-colors"
              >
                Cancel Order
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
