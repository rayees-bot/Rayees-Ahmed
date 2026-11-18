import React, { useState } from 'react';
import {
  Check,
  MapPin,
  Navigation,
  ShieldAlert,
  Store,
  Truck,
  X,
} from 'lucide-react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { OperationType, db, handleFirestoreError, signInWithGoogle } from '../lib/firebase';
import type {
  DeliveryPartner,
  EmergencyRequest,
  MedicineHunterRequest,
  Order,
} from '../types/mediquick';

interface PartnerHubViewProps {
  user: User | null;
  orders: Order[];
  partners: DeliveryPartner[];
  emergencyRequests: EmergencyRequest[];
  hunterRequests: MedicineHunterRequest[];
}

export const PartnerHubView: React.FC<PartnerHubViewProps> = ({
  user,
  orders,
  partners,
  emergencyRequests,
  hunterRequests,
}) => {
  const [roleTab, setRoleTab] = useState<'pharmacy' | 'delivery'>('pharmacy');
  const [rejectingOrderId, setRejectingOrderId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('Item temporarily out of stock at branch');
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-4">
        <Store className="w-10 h-10 text-teal-600 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Sign in to access Pharmacy & Delivery Desk</h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Manage incoming direct medicine orders, accept or reject fulfillment, and dispatch delivery partners in real time.
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

  const pharmacyOrders = orders.filter((o) => o.pharmacyOwnerUid === user.uid);
  const partnerOrders = orders.filter(
    (o) =>
      o.partnerOwnerUid === user.uid &&
      ['PARTNER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(o.status),
  );

  const handlePharmacyAccept = async (order: Order) => {
    setBusyId(order.id);
    try {
      const batch = writeBatch(db);
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      batch.update(doc(db, 'orders', order.id), {
        status: 'ACCEPTED',
        rejectionReason: '',
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'notifications', notifId), {
        userId: order.userId,
        title: `Order ${order.orderNumber} Accepted`,
        message: `${order.pharmacyName} has accepted your order and is packing your medicines.`,
        type: 'ORDER_ACCEPTED',
        orderId: order.id,
        read: false,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handlePharmacyReject = async (order: Order) => {
    setBusyId(order.id);
    try {
      const reason = rejectReason.trim() || 'Branch unable to fulfill this order right now';
      const batch = writeBatch(db);
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      batch.update(doc(db, 'orders', order.id), {
        status: 'REJECTED',
        rejectionReason: reason.slice(0, 240),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'notifications', notifId), {
        userId: order.userId,
        title: `Order ${order.orderNumber} Rejected`,
        message: `${order.pharmacyName} could not fulfill: ${reason}. Choose another pharmacy or cancel.`,
        type: 'ORDER_REJECTED',
        orderId: order.id,
        read: false,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setRejectingOrderId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleAssignPartner = async (order: Order, partner: DeliveryPartner) => {
    setBusyId(order.id);
    try {
      const batch = writeBatch(db);
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      batch.update(doc(db, 'orders', order.id), {
        status: 'PARTNER_ASSIGNED',
        partnerId: partner.id,
        partnerName: partner.name,
        partnerPhone: partner.phone,
        partnerOwnerUid: partner.ownerUid,
        partnerLat: order.pharmacyLat,
        partnerLng: order.pharmacyLng,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'notifications', notifId), {
        userId: order.userId,
        title: `Delivery Partner Assigned`,
        message: `${partner.name} (${partner.vehicleType}) is heading to ${order.pharmacyName}.`,
        type: 'DELIVERY_UPDATE',
        orderId: order.id,
        read: false,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handlePartnerAdvance = async (
    order: Order,
    nextStatus: 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED',
  ) => {
    setBusyId(order.id);
    try {
      const batch = writeBatch(db);
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      const progress =
        nextStatus === 'PICKED_UP' ? 0.25 : nextStatus === 'OUT_FOR_DELIVERY' ? 0.65 : 1.0;

      const nextLat = Number(
        (order.pharmacyLat + (order.deliveryLat - order.pharmacyLat) * progress).toFixed(5),
      );
      const nextLng = Number(
        (order.pharmacyLng + (order.deliveryLng - order.pharmacyLng) * progress).toFixed(5),
      );

      batch.update(doc(db, 'orders', order.id), {
        status: nextStatus,
        partnerLat: nextLat,
        partnerLng: nextLng,
        paymentStatus: nextStatus === 'DELIVERED' ? 'PAID' : order.paymentStatus,
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'notifications', notifId), {
        userId: order.userId,
        title: `Order ${order.orderNumber} ${nextStatus.replaceAll('_', ' ')}`,
        message:
          nextStatus === 'DELIVERED'
            ? 'Your medicines have been delivered safely.'
            : `${order.partnerName || 'Courier'} updated delivery progress.`,
        type: 'DELIVERY_UPDATE',
        orderId: order.id,
        read: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 rounded-2xl p-5">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Pharmacy & Delivery Partner Hub</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Direct orders appear immediately for pharmacy fulfillment and live courier dispatch.
          </p>
        </div>

        <div className="inline-flex p-1 bg-slate-100 rounded-xl self-start">
          <button
            type="button"
            onClick={() => setRoleTab('pharmacy')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 ${
              roleTab === 'pharmacy'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Store className="w-3.5 h-3.5 text-teal-600" />
            Pharmacy Dashboard ({pharmacyOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setRoleTab('delivery')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 ${
              roleTab === 'delivery'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Truck className="w-3.5 h-3.5 text-teal-600" />
            Delivery Partner ({partnerOrders.length})
          </button>
        </div>
      </div>

      {roleTab === 'pharmacy' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-4">
            <h3 className="text-base font-bold text-slate-900 px-1">Incoming Direct Orders</h3>

            {pharmacyOrders.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
                No direct orders received yet. Place an order from the Shop to test the live pharmacy workflow.
              </div>
            ) : (
              pharmacyOrders.map((order) => (
                <div
                  key={order.id}
                  className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-slate-900">
                          {order.orderNumber}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-teal-700">{order.status}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-500">
                          {order.paymentMethod} ({order.paymentStatus})
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 mt-1">
                        {order.pharmacyName}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        {order.customerName} · {order.deliveryAddress}
                      </p>
                    </div>
                    <span className="font-mono text-base font-bold text-slate-900 tabular-nums">
                      ₹{order.totalAmount.toLocaleString('en-IN')}
                    </span>
                  </div>

                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs space-y-1">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-slate-700">
                        <span>
                          {item.name} ({item.packSize}) × {item.quantity}
                        </span>
                        <span className="font-mono tabular-nums">
                          ₹{(item.price * item.quantity).toLocaleString('en-IN')}
                        </span>
                      </div>
                    ))}
                  </div>

                  {order.status === 'PLACED' && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === order.id}
                          onClick={() => handlePharmacyAccept(order)}
                          className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Accept Order
                        </button>
                        <button
                          type="button"
                          disabled={busyId === order.id}
                          onClick={() =>
                            setRejectingOrderId(
                              rejectingOrderId === order.id ? null : order.id,
                            )
                          }
                          className="px-4 py-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                          Reject Order
                        </button>
                      </div>

                      {rejectingOrderId === order.id && (
                        <div className="flex flex-col sm:flex-row gap-2 bg-red-50/70 border border-red-200 rounded-xl p-3">
                          <input
                            type="text"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Reason for rejection..."
                            className="flex-1 px-3 py-1.5 text-xs bg-white border border-red-200 rounded-lg focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={busyId === order.id}
                            onClick={() => handlePharmacyReject(order)}
                            className="px-3.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700"
                          >
                            Confirm Reject
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {order.status === 'ACCEPTED' && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-700">
                        Assign Delivery Partner for Dispatch:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {partners.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            disabled={busyId === order.id}
                            onClick={() => handleAssignPartner(order, p)}
                            className="px-3 py-2 rounded-xl border border-slate-200 hover:border-teal-600 bg-white text-xs font-medium text-slate-800 inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Truck className="w-3.5 h-3.5 text-teal-600" />
                            Dispatch {p.name} ({p.vehicleType})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-600" />
                Active Emergency Requests ({emergencyRequests.length})
              </h3>
              {emergencyRequests.length === 0 ? (
                <p className="text-xs text-slate-500">No active emergency broadcasts.</p>
              ) : (
                <div className="space-y-2">
                  {emergencyRequests.slice(0, 4).map((er) => (
                    <div key={er.id} className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs space-y-1">
                      <p className="font-bold text-red-900">{er.medicineName}</p>
                      <p className="text-red-800">
                        {er.patientName} · {er.urgency}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                Medicine Hunter Leads ({hunterRequests.length})
              </h3>
              {hunterRequests.length === 0 ? (
                <p className="text-xs text-slate-500">No rare medicine hunter searches.</p>
              ) : (
                <div className="space-y-2">
                  {hunterRequests.slice(0, 4).map((hr) => (
                    <div key={hr.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                      <p className="font-semibold text-slate-900">{hr.medicineQuery}</p>
                      <p className="text-slate-600">
                        Qty: {hr.quantityNeeded} · {hr.status}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-slate-900 px-1">
            Assigned Courier Runs & Live GPS Updates
          </h3>
          {partnerOrders.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
              No active deliveries assigned yet. Accept an order in Pharmacy Dashboard and dispatch a delivery partner.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {partnerOrders.map((order) => (
                <div
                  key={order.id}
                  className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono text-xs font-bold text-slate-900">
                        {order.orderNumber}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900 mt-1">
                        {order.partnerName || 'Assigned Courier'}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Pickup: {order.pharmacyName}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Drop: {order.deliveryAddress}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-teal-700">{order.status}</span>
                  </div>

                  {order.partnerLat !== undefined && order.partnerLng !== undefined && (
                    <div className="text-xs font-mono text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-2 tabular-nums">
                      <Navigation className="w-3.5 h-3.5 text-teal-600" />
                      Live GPS: {order.partnerLat.toFixed(5)}, {order.partnerLng.toFixed(5)}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {order.status === 'PARTNER_ASSIGNED' && (
                      <button
                        type="button"
                        disabled={busyId === order.id}
                        onClick={() => handlePartnerAdvance(order, 'PICKED_UP')}
                        className="px-3.5 py-2 rounded-xl bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition-colors"
                      >
                        Mark Picked Up
                      </button>
                    )}
                    {order.status === 'PICKED_UP' && (
                      <button
                        type="button"
                        disabled={busyId === order.id}
                        onClick={() => handlePartnerAdvance(order, 'OUT_FOR_DELIVERY')}
                        className="px-3.5 py-2 rounded-xl bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition-colors"
                      >
                        Start Live Delivery (Out for Delivery)
                      </button>
                    )}
                    {order.status === 'OUT_FOR_DELIVERY' && (
                      <button
                        type="button"
                        disabled={busyId === order.id}
                        onClick={() => handlePartnerAdvance(order, 'DELIVERED')}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
                      >
                        Complete Delivery
                      </button>
                    )}
                    {order.status === 'DELIVERED' && (
                      <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
                        <Check className="w-4 h-4" />
                        Delivered & Settled
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
