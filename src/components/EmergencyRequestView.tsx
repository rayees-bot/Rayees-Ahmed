import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, MapPin, PhoneCall, Radio, ShieldAlert } from 'lucide-react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { OperationType, db, handleFirestoreError, signInWithGoogle } from '../lib/firebase';
import type { EmergencyRequest, GeoLocation, Pharmacy } from '../types/mediquick';
import { MapsLocationWidget } from './MapsLocationWidget';

interface EmergencyRequestViewProps {
  user: User | null;
  location: GeoLocation;
  onLocationChange: (loc: GeoLocation) => void;
  pharmacies: Pharmacy[];
  mapsApiKey: string;
  requests: EmergencyRequest[];
}

export const EmergencyRequestView: React.FC<EmergencyRequestViewProps> = ({
  user,
  location,
  onLocationChange,
  pharmacies,
  mapsApiKey,
  requests,
}) => {
  const [patientName, setPatientName] = useState(user?.displayName || '');
  const [contactPhone, setContactPhone] = useState('+91 98450 11223');
  const [medicineName, setMedicineName] = useState('');
  const [dosageNotes, setDosageNotes] = useState('');
  const [urgency, setUrgency] = useState<'CRITICAL_15MIN' | 'URGENT_30MIN'>('CRITICAL_15MIN');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!user) {
      await signInWithGoogle();
      return;
    }

    if (patientName.trim().length < 2 || medicineName.trim().length < 2) {
      setError('Please enter patient name and critical medicine required.');
      return;
    }

    setSubmitting(true);
    try {
      const reqId = `emg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const batch = writeBatch(db);

      batch.set(doc(db, 'emergencyRequests', reqId), {
        userId: user.uid,
        patientName: patientName.trim().slice(0, 100),
        contactPhone: contactPhone.trim().slice(0, 24),
        medicineName: medicineName.trim().slice(0, 140),
        dosageNotes: dosageNotes.trim().slice(0, 300),
        urgency,
        deliveryAddress: location.address.slice(0, 280),
        lat: location.lat,
        lng: location.lng,
        status: 'BROADCASTED',
        createdAt: serverTimestamp(),
      });

      batch.set(doc(db, 'notifications', notifId), {
        userId: user.uid,
        title: 'Emergency Broadcast Active',
        message: `SOS alert sent to ${pharmacies.length} nearby 24x7 pharmacies for ${medicineName.trim()}.`,
        type: 'EMERGENCY',
        read: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setMedicineName('');
      setDosageNotes('');
      setSuccessMsg('Emergency request broadcasted directly to all nearby 24x7 pharmacies.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'emergencyRequests');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 bg-white border border-red-200 rounded-2xl p-6 space-y-5">
        <div className="flex items-start gap-3 pb-4 border-b border-red-100">
          <div className="w-11 h-11 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Emergency Medicine Request</h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Dedicated priority SOS channel for life-saving medicines. Broadcasts directly to 24x7 pharmacies and ambulances separately from normal shopping orders.
            </p>
          </div>
        </div>

        <form onSubmit={handleBroadcast} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Patient Name
              </label>
              <input
                type="text"
                required
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="Patient full name"
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-red-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Emergency Contact Phone
              </label>
              <input
                type="tel"
                required
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-red-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Critical Medicine & Strength Needed
            </label>
            <input
              type="text"
              required
              value={medicineName}
              onChange={(e) => setMedicineName(e.target.value)}
              placeholder="e.g., Epinephrine 0.3mg Auto-Injector, Nitroglycerin Spray, Anti-Venom"
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-red-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setUrgency('CRITICAL_15MIN')}
              className={`p-3 rounded-xl border text-left transition-colors ${
                urgency === 'CRITICAL_15MIN'
                  ? 'bg-red-50 border-red-600 text-red-900'
                  : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              <p className="text-xs font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                Critical Dispatch (Under 15 mins)
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Immediate siren alert to closest 24x7 medical hubs
              </p>
            </button>
            <button
              type="button"
              onClick={() => setUrgency('URGENT_30MIN')}
              className={`p-3 rounded-xl border text-left transition-colors ${
                urgency === 'URGENT_30MIN'
                  ? 'bg-amber-50 border-amber-600 text-amber-900'
                  : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              <p className="text-xs font-bold flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                Urgent Dispatch (Within 30 mins)
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Priority courier dispatch across city specialty pharmacies
              </p>
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Dosage / Hospital Ward Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={dosageNotes}
              onChange={(e) => setDosageNotes(e.target.value)}
              placeholder="Ward number, doctor instructions, or cold-chain notes..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-red-600"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700">
              Emergency Drop Location (GPS / Map Pin)
            </label>
            <MapsLocationWidget
              mapsApiKey={mapsApiKey}
              location={location}
              onLocationChange={onLocationChange}
              pharmacies={pharmacies}
              heightClass="h-[220px]"
              allowManualPin
              showSearchControls
            />
          </div>

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}
          {successMsg && (
            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              {successMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <Radio className="w-4 h-4" />
            {!user
              ? 'Sign in with Google to Broadcast Emergency'
              : submitting
                ? 'Broadcasting SOS...'
                : 'Broadcast Emergency Medicine Request'}
          </button>
        </form>
      </div>

      <div className="lg:col-span-5 space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-red-600" />
            Your Emergency Broadcasts ({requests.length})
          </h3>
          {requests.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">
              No active emergency requests. Emergency broadcasts remain isolated from your shopping cart.
            </p>
          ) : (
            <div className="space-y-3">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="p-4 rounded-xl border border-red-200 bg-red-50/50 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-red-900">{req.urgency}</span>
                    <span className="font-semibold text-red-700">{req.status}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-900">{req.medicineName}</p>
                  <p className="text-xs text-slate-600">
                    Patient: {req.patientName} · {req.contactPhone}
                  </p>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    {req.deliveryAddress}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
