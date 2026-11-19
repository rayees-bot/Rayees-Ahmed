import React, { useState } from 'react';
import { CheckCircle2, Compass, Search, Sparkles } from 'lucide-react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { OperationType, db, handleFirestoreError, signInWithGoogle } from '../lib/firebase';
import type { Medicine, MedicineHunterRequest, Pharmacy } from '../types/mediquick';
import { MedicineCard } from './MedicineCard';

interface MedicineHunterViewProps {
  user: User | null;
  rareMedicines: Medicine[];
  pharmacies: Pharmacy[];
  userLat: number;
  userLng: number;
  cartQuantities: Record<string, number>;
  onAddToCart: (medicine: Medicine, qty: number) => void;
  onBuyNow: (medicine: Medicine, qty: number) => void;
  hunterRequests: MedicineHunterRequest[];
}

export const MedicineHunterView: React.FC<MedicineHunterViewProps> = ({
  user,
  rareMedicines,
  pharmacies,
  userLat,
  userLng,
  cartQuantities,
  onAddToCart,
  onBuyNow,
  hunterRequests,
}) => {
  const [medicineQuery, setMedicineQuery] = useState('');
  const [moleculeOrBrand, setMoleculeOrBrand] = useState('');
  const [quantityNeeded, setQuantityNeeded] = useState('1 Vial');
  const [cityOrArea, setCityOrArea] = useState('Chennai Siruseri');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [rareFilter, setRareFilter] = useState('');

  const filteredRare = rareMedicines.filter((m) => {
    if (!rareFilter.trim()) return true;
    const q = rareFilter.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.brand.toLowerCase().includes(q) ||
      m.genericName.toLowerCase().includes(q)
    );
  });

  const handleSubmitHunter = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    if (!user) {
      await signInWithGoogle();
      return;
    }
    if (medicineQuery.trim().length < 2) return;

    setSubmitting(true);
    try {
      const reqId = `hunt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const batch = writeBatch(db);

      batch.set(doc(db, 'medicineHunterRequests', reqId), {
        userId: user.uid,
        medicineQuery: medicineQuery.trim().slice(0, 140),
        moleculeOrBrand: moleculeOrBrand.trim().slice(0, 120),
        quantityNeeded: quantityNeeded.trim().slice(0, 40) || '1 Unit',
        cityOrArea: cityOrArea.trim().slice(0, 120) || 'Metro City',
        notes: notes.trim().slice(0, 400),
        status: 'SEARCHING',
        createdAt: serverTimestamp(),
      });

      batch.set(doc(db, 'notifications', notifId), {
        userId: user.uid,
        title: 'Medicine Hunter Search Launched',
        message: `Scanning regional specialty & hospital depots for ${medicineQuery.trim()}.`,
        type: 'HUNTER',
        read: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setMedicineQuery('');
      setMoleculeOrBrand('');
      setNotes('');
      setSuccessMsg('Medicine Hunter request logged! Specialty cold-chain depots are scanning inventory.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'medicineHunterRequests');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Hunter Request Form + Active Searches (separate from cart) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div className="flex items-start gap-3 pb-4 border-b border-slate-100">
            <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
              <Compass className="w-6 h-6 text-teal-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Medicine Hunter — Rare & Orphan Drug Locator
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Can&apos;t find a specialty oncology, biologic, or imported formulation? Launch a dedicated Medicine Hunter search across hospital & cold-chain distributors.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmitHunter} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Rare Medicine Name
                </label>
                <input
                  type="text"
                  required
                  value={medicineQuery}
                  onChange={(e) => setMedicineQuery(e.target.value)}
                  placeholder="e.g., Nusinersen, Zolgensma, IVIG 10%"
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Active Molecule / Manufacturer
                </label>
                <input
                  type="text"
                  value={moleculeOrBrand}
                  onChange={(e) => setMoleculeOrBrand(e.target.value)}
                  placeholder="e.g., Roche / Takeda / Biogen"
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Quantity / Pack Required
                </label>
                <input
                  type="text"
                  required
                  value={quantityNeeded}
                  onChange={(e) => setQuantityNeeded(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  City / Delivery Zone
                </label>
                <input
                  type="text"
                  required
                  value={cityOrArea}
                  onChange={(e) => setCityOrArea(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Cold-Chain or Clinical Notes (Optional)
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Specify 2-8°C storage requirements, hospital reference, or urgency..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600"
              />
            </div>

            {successMsg && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                {successMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Sparkles className="w-4 h-4 text-teal-400" />
              {!user
                ? 'Sign in with Google to Launch Hunter'
                : submitting
                  ? 'Scanning Specialty Network...'
                  : 'Launch Medicine Hunter Search'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
          <h3 className="text-base font-bold text-slate-900">
            Active Hunter Requests ({hunterRequests.length})
          </h3>
          {hunterRequests.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">
              Your custom Medicine Hunter requests appear here. Available rare medicines below can also be ordered directly!
            </p>
          ) : (
            <div className="space-y-3">
              {hunterRequests.map((hr) => (
                <div
                  key={hr.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-semibold text-teal-700">{hr.status}</span>
                    <span className="text-slate-500">{hr.quantityNeeded}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-900">{hr.medicineQuery}</p>
                  <p className="text-xs text-slate-600">
                    {hr.moleculeOrBrand ? `${hr.moleculeOrBrand} · ` : ''}
                    {hr.cityOrArea}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Direct Purchase Rare Medicines */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              In-Stock Rare & Specialty Medicines (Direct Order)
            </h3>
            <p className="text-sm text-slate-600">
              Verified cold-chain specialty stock available immediately — add directly to cart or Buy Now without waiting.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={rareFilter}
              onChange={(e) => setRareFilter(e.target.value)}
              placeholder="Filter rare medicines..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredRare.map((med) => (
            <MedicineCard
              key={med.id}
              medicine={med}
              pharmacy={pharmacies.find((p) => p.id === med.pharmacyId)}
              userLat={userLat}
              userLng={userLng}
              cartQty={cartQuantities[med.id] || 0}
              onAddToCart={onAddToCart}
              onBuyNow={onBuyNow}
            />
          ))}
        </div>
      </section>
    </div>
  );
};
