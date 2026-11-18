import React, { useState } from 'react';
import { Minus, Pill, Plus, ShoppingBag, Snowflake, Store, Zap } from 'lucide-react';
import type { Medicine, Pharmacy } from '../types/mediquick';
import { MAX_CART_QTY } from '../types/mediquick';
import { haversineKm } from './MapsLocationWidget';

interface MedicineCardProps {
  medicine: Medicine;
  pharmacy?: Pharmacy;
  userLat: number;
  userLng: number;
  cartQty: number;
  onAddToCart: (medicine: Medicine, qty: number) => void;
  onBuyNow: (medicine: Medicine, qty: number) => void;
}

export const MedicineCard: React.FC<MedicineCardProps> = ({
  medicine,
  pharmacy,
  userLat,
  userLng,
  cartQty,
  onAddToCart,
  onBuyNow,
}) => {
  const [selectedQty, setSelectedQty] = useState(1);
  const [imgFailed, setImgFailed] = useState(false);

  const distKm = pharmacy
    ? haversineKm(userLat, userLng, pharmacy.lat, pharmacy.lng).toFixed(1)
    : null;

  const discountPct =
    medicine.mrp > medicine.price
      ? Math.round(((medicine.mrp - medicine.price) / medicine.mrp) * 100)
      : 0;

  return (
    <article className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      {/* Image area */}
      <div className="relative aspect-[4/3] bg-slate-100 overflow-hidden">
        {!imgFailed ? (
          <img
            src={medicine.imageUrl}
            alt={medicine.name}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-100 to-teal-50 flex flex-col items-center justify-center p-4 text-center">
            <Pill className="w-9 h-9 text-teal-600 mb-2" />
            <span className="text-xs font-medium text-slate-600">{medicine.name}</span>
          </div>
        )}

        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          <span
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold tracking-tight shadow-sm ${
              medicine.isRare
                ? 'bg-slate-900 text-white'
                : 'bg-white/95 text-teal-800 border border-slate-200/80'
            }`}
          >
            {medicine.isRare ? 'Rare Specialty' : medicine.category}
          </span>
          {medicine.requiresColdChain && (
            <span className="px-2 py-1 rounded-md text-[11px] font-medium bg-sky-50 text-sky-800 border border-sky-200 inline-flex items-center gap-1 shadow-sm">
              <Snowflake className="w-3 h-3" />
              2–8°C
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
            <span className="font-medium uppercase tracking-wide truncate">{medicine.brand}</span>
            <span className="shrink-0 tabular-nums">
              {medicine.inStock && medicine.stock > 0
                ? `${medicine.stock} in stock`
                : 'Out of stock'}
            </span>
          </div>

          <h3 className="text-base font-semibold text-slate-900 leading-snug line-clamp-1">
            {medicine.name}
          </h3>

          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
            {medicine.genericName} · {medicine.packSize} ({medicine.dosageForm})
          </p>

          <div className="flex items-center gap-1.5 text-xs text-slate-600 pt-1">
            <Store className="w-3.5 h-3.5 text-teal-600 shrink-0" />
            <span className="truncate">{medicine.pharmacyName}</span>
            {distKm && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums shrink-0">{distKm} km</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="tabular-nums shrink-0 text-teal-700 font-medium">
              {medicine.etaMins}m
            </span>
          </div>
        </div>

        {/* Price + Quantity + Actions */}
        <div className="pt-3 border-t border-slate-100 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                ₹{medicine.price.toLocaleString('en-IN')}
              </span>
              {medicine.mrp > medicine.price && (
                <span className="text-xs text-slate-400 line-through font-mono tabular-nums">
                  ₹{medicine.mrp.toLocaleString('en-IN')}
                </span>
              )}
              {discountPct > 0 && (
                <span className="text-xs font-semibold text-teal-700 tabular-nums">
                  {discountPct}% off
                </span>
              )}
            </div>

            {/* Quantity selector */}
            <div className="inline-flex items-center border border-slate-200 rounded-lg bg-slate-50">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setSelectedQty((q) => Math.max(1, q - 1))}
                className="w-7 h-7 flex items-center justify-center text-slate-600 hover:text-slate-900"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-7 text-center text-xs font-semibold text-slate-900 tabular-nums">
                {selectedQty}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() =>
                  setSelectedQty((q) => Math.min(Math.min(MAX_CART_QTY, medicine.stock || 25), q + 1))
                }
                className="w-7 h-7 flex items-center justify-center text-slate-600 hover:text-slate-900"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!medicine.inStock || medicine.stock <= 0}
              onClick={() => onAddToCart(medicine, selectedQty)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-teal-600 text-teal-700 hover:bg-teal-50 text-xs font-semibold transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              {cartQty > 0 ? `Add (${cartQty} in cart)` : 'Add to Cart'}
            </button>
            <button
              type="button"
              disabled={!medicine.inStock || medicine.stock <= 0}
              onClick={() => onBuyNow(medicine, selectedQty)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              <Zap className="w-3.5 h-3.5" />
              Buy Now
            </button>
          </div>
        </div>
      </div>
    </article>
  );
};
