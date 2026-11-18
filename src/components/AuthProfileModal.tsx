import React, { useState } from 'react';
import { LogOut, MapPin, Trash2, User as UserIcon, X } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { OperationType, db, handleFirestoreError, signInWithGoogle, signOutUser } from '../lib/firebase';
import type { GeoLocation, SavedAddress, UserProfile } from '../types/mediquick';

interface AuthProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  profile: UserProfile | null;
  savedAddresses: SavedAddress[];
  onSelectAddress: (loc: GeoLocation) => void;
}

export const AuthProfileModal: React.FC<AuthProfileModalProps> = ({
  isOpen,
  onClose,
  user,
  profile,
  savedAddresses,
  onSelectAddress,
}) => {
  const [displayName, setDisplayName] = useState(profile?.displayName || user?.displayName || '');
  const [phone, setPhone] = useState(profile?.phone || '+91 98450 11223');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  if (!isOpen) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          uid: user.uid,
          displayName: displayName.trim() || user.displayName || 'MediQuick User',
          email: user.email || '',
          phone: phone.trim().slice(0, 24),
          photoURL: user.photoURL || '',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setSavedOk(true);
      window.setTimeout(() => setSavedOk(false), 2000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAddress = async (addrId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'addresses', addrId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/addresses/${addrId}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-teal-600" />
            <h2 className="text-base font-bold text-slate-900">Account & Saved Addresses</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {!user ? (
            <div className="text-center py-6 space-y-4">
              <p className="text-sm text-slate-600">
                Sign in with your Google account to sync your shopping cart, saved addresses, and order history across devices.
              </p>
              <button
                type="button"
                onClick={async () => {
                  await signInWithGoogle();
                  onClose();
                }}
                className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors"
              >
                Continue with Google
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'User'}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover border border-slate-200"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold">
                      {(user.displayName || 'M')[0]}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {user.displayName || 'MediQuick Member'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await signOutUser();
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:text-red-600 inline-flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors"
                >
                  {saving ? 'Saving...' : savedOk ? 'Profile Updated' : 'Save Profile'}
                </button>
              </form>

              <div className="space-y-2.5 pt-3 border-t border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Saved Delivery Addresses ({savedAddresses.length})
                </h3>
                {savedAddresses.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Pin an address on the map and click Save Address to reuse it in checkout.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {savedAddresses.map((addr) => (
                      <div
                        key={addr.id}
                        className="flex items-center justify-between gap-2 p-3 rounded-xl border border-slate-200 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectAddress({
                              lat: addr.lat,
                              lng: addr.lng,
                              address: addr.addressLine,
                              label: addr.label,
                            });
                            onClose();
                          }}
                          className="flex-1 text-left min-w-0"
                        >
                          <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                            {addr.label}
                          </p>
                          <p className="text-slate-600 truncate mt-0.5">{addr.addressLine}</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAddress(addr.id)}
                          aria-label="Delete saved address"
                          className="text-slate-400 hover:text-red-600 p-1.5"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
