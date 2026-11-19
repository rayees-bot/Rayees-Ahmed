import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Compass,
  MapPin,
  Package,
  Search,
  ShieldAlert,
  ShoppingBag,
  Store,
  Truck,
  User as UserIcon,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { AuthProfileModal } from './components/AuthProfileModal';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutModal } from './components/CheckoutModal';
import { EmergencyRequestView } from './components/EmergencyRequestView';
import { MapsLocationWidget, haversineKm } from './components/MapsLocationWidget';
import { MedicineCard } from './components/MedicineCard';
import { MedicineHunterView } from './components/MedicineHunterView';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { OrdersTrackingView } from './components/OrdersTrackingView';
import { PartnerHubView } from './components/PartnerHubView';
import {
  DEFAULT_USER_LOCATION,
  IMG_HERO,
  buildSeedDeliveryPartners,
  buildSeedMedicines,
  buildSeedPharmacies,
  ensureFirestoreSeeded,
} from './data/seedCatalog';
import { OperationType, auth, db, handleFirestoreError, signInWithGoogle } from './lib/firebase';
import {
  MAX_CART_QTY,
  type ActiveView,
  type AppNotification,
  type CartItem,
  type DeliveryPartner,
  type EmergencyRequest,
  type GeoLocation,
  type Medicine,
  type MedicineCategory,
  type MedicineHunterRequest,
  type Order,
  type Pharmacy,
  type SavedAddress,
  type UserProfile,
} from './types/mediquick';

const GUEST_CART_KEY = 'mediquick_guest_cart_v1';

const CATEGORIES: MedicineCategory[] = [
  'All',
  'Pain & Fever',
  'Antibiotics',
  'Respiratory',
  'Diabetes & Insulin',
  'Cardiac & BP',
  'Rare & Biologics',
  'Vitamins & Immunity',
  'First Aid',
];

function formatTs(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof (val as Timestamp)?.toDate === 'function') {
    return (val as Timestamp).toDate().toISOString();
  }
  return new Date().toISOString();
}

export default function App() {
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
  );
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [activeView, setActiveView] = useState<ActiveView>('shop');
  const [location, setLocation] = useState<GeoLocation>(DEFAULT_USER_LOCATION);
  const [selectedPharmacyFilter, setSelectedPharmacyFilter] = useState<string | null>(null);

  const [medicines, setMedicines] = useState<Medicine[]>(() => buildSeedMedicines('seed_owner'));
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>(() => buildSeedPharmacies('seed_owner'));
  const [partners, setPartners] = useState<DeliveryPartner[]>(() =>
    buildSeedDeliveryPartners('seed_owner'),
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<MedicineCategory>('All');
  const [rareFilter, setRareFilter] = useState<'all' | 'normal' | 'rare'>('all');

  const [cartItems, setCartItems] = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem(GUEST_CART_KEY);
      return raw ? (JSON.parse(raw) as CartItem[]) : [];
    } catch {
      return [];
    }
  });

  const [ordersByCustomer, setOrdersByCustomer] = useState<Order[]>([]);
  const [ordersByPharmacy, setOrdersByPharmacy] = useState<Order[]>([]);
  const [ordersByPartner, setOrdersByPartner] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [emergencyRequests, setEmergencyRequests] = useState<EmergencyRequest[]>([]);
  const [hunterRequests, setHunterRequests] = useState<MedicineHunterRequest[]>([]);

  const [cartOpen, setCartOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [checkoutState, setCheckoutState] = useState<{
    open: boolean;
    items: CartItem[];
    isBuyNow: boolean;
  }>({ open: false, items: [], isBuyNow: false });

  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 2600);
  }, []);

  // Google Maps quota listener & runtime key fetch fallback
  useEffect(() => {
    const onQuota = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    if (!mapsApiKey && window.location.protocol !== 'file:') {
      fetch('/api/config')
        .then((r) => r.json())
        .then((data: { mapsApiKey?: string }) => {
          if (data.mapsApiKey) setMapsApiKey(data.mapsApiKey);
        })
        .catch(() => {});
    }
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, [mapsApiKey]);

  const loadCatalog = useCallback(async () => {
    try {
      const [medSnap, pharmSnap] = await Promise.all([
        getDocs(query(collection(db, 'medicines'), where('inStock', '==', true))),
        getDocs(query(collection(db, 'pharmacies'), where('rating', '>=', 0))),
      ]);
      if (!medSnap.empty) {
        setMedicines(medSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Medicine));
      }
      if (!pharmSnap.empty) {
        const list = pharmSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Pharmacy);
        list.sort((a, b) => a.name.localeCompare(b.name));
        setPharmacies(list);
      }
    } catch {
      // Fallback seed catalog remains active
    }
  }, []);

  // Auth listener & initial catalog sync
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        await ensureFirestoreSeeded(nextUser.uid).catch(() => {});
        await loadCatalog();
        try {
          await setDoc(
            doc(db, 'users', nextUser.uid),
            {
              uid: nextUser.uid,
              displayName: nextUser.displayName || 'MediQuick User',
              email: nextUser.email || '',
              phone: '+91 98450 11223',
              photoURL: nextUser.photoURL || '',
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        } catch {
          // Non-blocking profile sync
        }

        // Merge any guest cart items into Firestore cart
        try {
          const raw = localStorage.getItem(GUEST_CART_KEY);
          const guestItems = raw ? (JSON.parse(raw) as CartItem[]) : [];
          if (guestItems.length > 0) {
            const batch = writeBatch(db);
            for (const item of guestItems) {
              batch.set(
                doc(db, 'carts', nextUser.uid, 'items', item.medicineId),
                {
                  ...item,
                  userId: nextUser.uid,
                  updatedAt: serverTimestamp(),
                },
                { merge: true },
              );
            }
            const totalQty = guestItems.reduce((s, i) => s + i.quantity, 0);
            const totalSub = guestItems.reduce((s, i) => s + i.price * i.quantity, 0);
            batch.set(
              doc(db, 'carts', nextUser.uid),
              {
                userId: nextUser.uid,
                itemCount: totalQty,
                subtotal: totalSub,
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            );
            await batch.commit();
            localStorage.removeItem(GUEST_CART_KEY);
          }
        } catch {
          // Non-blocking merge
        }
      }
    });
    return () => unsub();
  }, [loadCatalog]);

  // Load public catalog (medicines, pharmacies)
  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Authenticated real-time Firestore subscriptions
  useEffect(() => {
    if (!authReady || !user) return;

    const unsubs: Array<() => void> = [];

    // 1. User Profile
    unsubs.push(
      onSnapshot(
        doc(db, 'users', user.uid),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data();
            setProfile({
              uid: d.uid,
              displayName: d.displayName,
              email: d.email || '',
              phone: d.phone || '',
              photoURL: d.photoURL || '',
              updatedAt: formatTs(d.updatedAt),
            });
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`),
      ),
    );

    // 2. Saved Addresses
    unsubs.push(
      onSnapshot(
        collection(db, 'users', user.uid, 'addresses'),
        (snap) => {
          setSavedAddresses(
            snap.docs.map((d) => {
              const data = d.data();
              return {
                id: d.id,
                userId: data.userId,
                label: data.label,
                addressLine: data.addressLine,
                landmark: data.landmark,
                lat: data.lat,
                lng: data.lng,
                isDefault: Boolean(data.isDefault),
                createdAt: formatTs(data.createdAt),
              } as SavedAddress;
            }),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/addresses`),
      ),
    );

    // 3. Persistent Cart Items
    unsubs.push(
      onSnapshot(
        collection(db, 'carts', user.uid, 'items'),
        (snap) => {
          setCartItems(
            snap.docs.map((d) => {
              const data = d.data();
              return {
                medicineId: data.medicineId,
                userId: data.userId,
                name: data.name,
                brand: data.brand,
                price: data.price,
                quantity: data.quantity,
                imageUrl: data.imageUrl,
                packSize: data.packSize || '',
                isRare: Boolean(data.isRare),
                pharmacyId: data.pharmacyId,
                pharmacyName: data.pharmacyName,
                pharmacyOwnerUid: data.pharmacyOwnerUid,
              } as CartItem;
            }),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `carts/${user.uid}/items`),
      ),
    );

    // 4. Delivery Partners
    unsubs.push(
      onSnapshot(
        query(collection(db, 'deliveryPartners'), where('available', '==', true)),
        (snap) => {
          if (!snap.empty) {
            setPartners(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DeliveryPartner));
          }
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'deliveryPartners'),
      ),
    );

    const parseOrderSnap = (docs: Array<{ id: string; data: () => Record<string, unknown> }>) =>
      docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          id: d.id,
          createdAt: formatTs(data.createdAt),
          updatedAt: formatTs(data.updatedAt),
        } as Order;
      });

    // 5a. Customer Orders
    unsubs.push(
      onSnapshot(
        query(collection(db, 'orders'), where('userId', '==', user.uid)),
        (snap) => setOrdersByCustomer(parseOrderSnap(snap.docs)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'orders?userId'),
      ),
    );

    // 5b. Pharmacy Orders
    unsubs.push(
      onSnapshot(
        query(collection(db, 'orders'), where('pharmacyOwnerUid', '==', user.uid)),
        (snap) => setOrdersByPharmacy(parseOrderSnap(snap.docs)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'orders?pharmacyOwnerUid'),
      ),
    );

    // 5c. Delivery Partner Orders
    unsubs.push(
      onSnapshot(
        query(collection(db, 'orders'), where('partnerOwnerUid', '==', user.uid)),
        (snap) => setOrdersByPartner(parseOrderSnap(snap.docs)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'orders?partnerOwnerUid'),
      ),
    );

    // 6. Notifications
    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('userId', '==', user.uid)),
        (snap) => {
          const list = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              userId: data.userId,
              title: data.title,
              message: data.message,
              type: data.type,
              orderId: data.orderId,
              read: Boolean(data.read),
              createdAt: formatTs(data.createdAt),
            } as AppNotification;
          });
          list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setNotifications(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications'),
      ),
    );

    // 7. Separate Emergency Requests
    unsubs.push(
      onSnapshot(
        query(collection(db, 'emergencyRequests'), where('userId', '==', user.uid)),
        (snap) => {
          const list = snap.docs.map((d) => {
            const data = d.data();
            return {
              ...data,
              id: d.id,
              createdAt: formatTs(data.createdAt),
            } as EmergencyRequest;
          });
          list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setEmergencyRequests(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'emergencyRequests'),
      ),
    );

    // 8. Separate Medicine Hunter Requests
    unsubs.push(
      onSnapshot(
        query(collection(db, 'medicineHunterRequests'), where('userId', '==', user.uid)),
        (snap) => {
          const list = snap.docs.map((d) => {
            const data = d.data();
            return {
              ...data,
              id: d.id,
              createdAt: formatTs(data.createdAt),
            } as MedicineHunterRequest;
          });
          list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setHunterRequests(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'medicineHunterRequests'),
      ),
    );

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [authReady, user]);

  // Persist guest cart in localStorage when signed out
  useEffect(() => {
    if (!user) {
      try {
        localStorage.setItem(GUEST_CART_KEY, JSON.stringify(cartItems));
      } catch {
        // Ignore storage quota errors
      }
    }
  }, [cartItems, user]);

  // Merged orders across customer / pharmacy / partner roles
  const allOrders = useMemo(() => {
    const map: Record<string, Order> = {};
    [...ordersByCustomer, ...ordersByPharmacy, ...ordersByPartner].forEach((o) => {
      map[o.id] = o;
    });
    return Object.values(map).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [ordersByCustomer, ordersByPharmacy, ordersByPartner]);

  const customerOrders = useMemo(
    () =>
      ordersByCustomer.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [ordersByCustomer],
  );

  // Cart helpers
  const syncCartSummary = async (uid: string, items: CartItem[]) => {
    const itemCount = items.reduce((s, i) => s + i.quantity, 0);
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    await setDoc(
      doc(db, 'carts', uid),
      {
        userId: uid,
        itemCount,
        subtotal,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  const handleAddToCart = async (medicine: Medicine, qty: number) => {
    const existing = cartItems.find((i) => i.medicineId === medicine.id);
    const nextQty = Math.min(MAX_CART_QTY, (existing?.quantity || 0) + qty);

    const newItem: CartItem = {
      medicineId: medicine.id,
      userId: user?.uid || 'guest',
      name: medicine.name,
      brand: medicine.brand,
      price: medicine.price,
      quantity: nextQty,
      imageUrl: medicine.imageUrl,
      packSize: medicine.packSize,
      isRare: medicine.isRare,
      pharmacyId: medicine.pharmacyId,
      pharmacyName: medicine.pharmacyName,
      pharmacyOwnerUid: medicine.pharmacyOwnerUid,
    };

    const nextItems = existing
      ? cartItems.map((i) => (i.medicineId === medicine.id ? newItem : i))
      : [...cartItems, newItem];

    setCartItems(nextItems);
    showToast(`${medicine.name} added to cart`);

    if (user) {
      try {
        await setDoc(doc(db, 'carts', user.uid, 'items', medicine.id), {
          ...newItem,
          userId: user.uid,
          updatedAt: serverTimestamp(),
        });
        await syncCartSummary(user.uid, nextItems);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `carts/${user.uid}/items/${medicine.id}`);
      }
    }
  };

  const handleUpdateCartQty = async (medicineId: string, newQty: number) => {
    if (newQty <= 0) {
      await handleRemoveCartItem(medicineId);
      return;
    }
    const clamped = Math.min(MAX_CART_QTY, newQty);
    const nextItems = cartItems.map((i) =>
      i.medicineId === medicineId ? { ...i, quantity: clamped } : i,
    );
    setCartItems(nextItems);

    if (user) {
      try {
        await setDoc(
          doc(db, 'carts', user.uid, 'items', medicineId),
          { quantity: clamped, updatedAt: serverTimestamp() },
          { merge: true },
        );
        await syncCartSummary(user.uid, nextItems);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `carts/${user.uid}/items/${medicineId}`);
      }
    }
  };

  const handleRemoveCartItem = async (medicineId: string) => {
    const nextItems = cartItems.filter((i) => i.medicineId !== medicineId);
    setCartItems(nextItems);

    if (user) {
      try {
        await deleteDoc(doc(db, 'carts', user.uid, 'items', medicineId));
        await syncCartSummary(user.uid, nextItems);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `carts/${user.uid}/items/${medicineId}`);
      }
    }
  };

  const handleClearCart = async () => {
    const oldItems = [...cartItems];
    setCartItems([]);
    if (user && oldItems.length > 0) {
      try {
        const batch = writeBatch(db);
        for (const it of oldItems) {
          batch.delete(doc(db, 'carts', user.uid, 'items', it.medicineId));
        }
        batch.set(
          doc(db, 'carts', user.uid),
          { userId: user.uid, itemCount: 0, subtotal: 0, updatedAt: serverTimestamp() },
          { merge: true },
        );
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `carts/${user.uid}`);
      }
    } else {
      localStorage.removeItem(GUEST_CART_KEY);
    }
  };

  const handleBuyNow = (medicine: Medicine, qty: number) => {
    const buyItem: CartItem = {
      medicineId: medicine.id,
      userId: user?.uid || 'guest',
      name: medicine.name,
      brand: medicine.brand,
      price: medicine.price,
      quantity: Math.min(MAX_CART_QTY, Math.max(1, qty)),
      imageUrl: medicine.imageUrl,
      packSize: medicine.packSize,
      isRare: medicine.isRare,
      pharmacyId: medicine.pharmacyId,
      pharmacyName: medicine.pharmacyName,
      pharmacyOwnerUid: medicine.pharmacyOwnerUid,
    };
    setCheckoutState({ open: true, items: [buyItem], isBuyNow: true });
  };

  const handleSaveCurrentAddress = async (label: string) => {
    if (!user) {
      await signInWithGoogle();
      return;
    }
    const addrId = `addr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'users', user.uid, 'addresses', addrId), {
        userId: user.uid,
        label: label.slice(0, 40),
        addressLine: location.address.slice(0, 280),
        landmark: '',
        lat: location.lat,
        lng: location.lng,
        isDefault: savedAddresses.length === 0,
        createdAt: serverTimestamp(),
      });
      showToast(`Saved "${label}" address`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}/addresses/${addrId}`);
    }
  };

  const filteredMedicines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return medicines.filter((m) => {
      if (selectedCategory !== 'All' && m.category !== selectedCategory) return false;
      if (rareFilter === 'normal' && m.isRare) return false;
      if (rareFilter === 'rare' && !m.isRare) return false;
      if (selectedPharmacyFilter && m.pharmacyId !== selectedPharmacyFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.brand.toLowerCase().includes(q) ||
        m.genericName.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.pharmacyName.toLowerCase().includes(q)
      );
    });
  }, [medicines, searchQuery, selectedCategory, rareFilter, selectedPharmacyFilter]);

  const sortedPharmacies = useMemo(() => {
    return [...pharmacies].sort(
      (a, b) =>
        haversineKm(location.lat, location.lng, a.lat, a.lng) -
        haversineKm(location.lat, location.lng, b.lat, b.lng),
    );
  }, [pharmacies, location.lat, location.lng]);

  const cartQuantities = useMemo(() => {
    const lookup: Record<string, number> = {};
    for (const item of cartItems) {
      lookup[item.medicineId] = item.quantity;
    }
    return lookup;
  }, [cartItems]);

  const totalCartCount = cartItems.reduce((s, i) => s + i.quantity, 0);
  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Required Google Maps Platform Demo Key Quota Banner */}
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Top Navigation Bar (Clean 3-Zone Contract) */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveView('shop')}
            className="text-xl font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 flex items-center gap-2"
          >
            <span className="w-2.5 h-2.5 rounded-sm bg-teal-600 inline-block" />
            MediQuick
          </button>

          {/* Zone 2: Single-line Nav Links */}
          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setActiveView('shop')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeView === 'shop' ? 'text-teal-700 font-semibold border-b-2 border-teal-600' : ''
              }`}
            >
              Shop Medicines
            </button>
            <button
              type="button"
              onClick={() => setActiveView('map')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeView === 'map' ? 'text-teal-700 font-semibold border-b-2 border-teal-600' : ''
              }`}
            >
              Nearby Map
            </button>
            <button
              type="button"
              onClick={() => setActiveView('hunter')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeView === 'hunter' ? 'text-teal-700 font-semibold border-b-2 border-teal-600' : ''
              }`}
            >
              Medicine Hunter
            </button>
            <button
              type="button"
              onClick={() => setActiveView('emergency')}
              className={`hover:text-red-700 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeView === 'emergency'
                  ? 'text-red-600 font-semibold border-b-2 border-red-600'
                  : 'text-red-600'
              }`}
            >
              Emergency SOS
            </button>
            <button
              type="button"
              onClick={() => setActiveView('orders')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeView === 'orders' ? 'text-teal-700 font-semibold border-b-2 border-teal-600' : ''
              }`}
            >
              My Orders
            </button>
            <button
              type="button"
              onClick={() => setActiveView('partner')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeView === 'partner' ? 'text-teal-700 font-semibold border-b-2 border-teal-600' : ''
              }`}
            >
              Partner Hub
            </button>
          </nav>

          {/* Zone 3: Cart & Account Actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveView('map')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200/70 text-xs font-medium text-slate-700 max-w-[180px] transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <span className="truncate">{location.label || location.address}</span>
            </button>

            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              aria-label="Notifications"
              className="relative w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadNotifCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              aria-label="Profile and Account"
              className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700"
            >
              <UserIcon className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 shadow-sm"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Cart</span>
              <span className="px-1.5 py-0.5 rounded-md bg-white/20 font-mono text-[11px] tabular-nums">
                {totalCartCount}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile / Tablet Compact Secondary Nav */}
        <div className="lg:hidden border-t border-slate-100 px-4 py-2 flex items-center gap-2 overflow-x-auto">
          {(
            [
              { id: 'shop', label: 'Shop' },
              { id: 'map', label: 'Nearby Map' },
              { id: 'hunter', label: 'Medicine Hunter' },
              { id: 'emergency', label: 'Emergency' },
              { id: 'orders', label: 'My Orders' },
              { id: 'partner', label: 'Partner Hub' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveView(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                activeView === tab.id
                  ? tab.id === 'emergency'
                    ? 'bg-red-600 text-white'
                    : 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-8">
        {activeView === 'shop' && (
          <>
            {/* Hero Banner */}
            <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
              <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-center space-y-5">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-teal-700 tracking-wide">
                    Every Medicine. One Platform.
                  </p>
                  <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight text-balance">
                    Order normal &amp; rare medicines directly from nearby pharmacies.
                  </h1>
                  <p className="text-sm sm:text-base text-slate-600 max-w-xl leading-relaxed">
                    Browse verified pharmacy stock in real time, add to your cart or Buy Now immediately, pay via Razorpay or Cash on Delivery, and track your courier live to your doorstep.
                  </p>
                </div>

                {/* Search Input */}
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search Doloral, Insulin, Tocilizumab, brand, or pharmacy..."
                      className="w-full pl-10 pr-4 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-teal-600"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveView('map')}
                    className="px-4 py-3 rounded-xl border border-slate-200 hover:border-teal-600 bg-white text-slate-800 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
                  >
                    <MapPin className="w-4 h-4 text-teal-600" />
                    Nearby Pharmacies
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
                  <span>{pharmacies.length} Verified Local Pharmacies</span>
                  <span aria-hidden="true">·</span>
                  <span>Direct Checkout Without Pre-Approval</span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => setActiveView('emergency')}
                    className="text-red-600 font-semibold hover:underline inline-flex items-center gap-1"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Need Emergency SOS Dispatch?
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => setActiveView('hunter')}
                    className="text-teal-700 font-semibold hover:underline inline-flex items-center gap-1"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    Launch Medicine Hunter
                  </button>
                </div>
              </div>

              <div className="lg:col-span-5 relative min-h-[220px] bg-slate-100">
                <img
                  src={IMG_HERO}
                  alt="MediQuick pharmacy counter and sealed clinical delivery kit"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            </section>

            {/* Category & Type Filter Bar */}
            <section className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        selectedCategory === cat
                          ? 'bg-slate-900 text-white'
                          : 'bg-white border border-slate-200 text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="inline-flex p-1 bg-slate-200/70 rounded-xl self-start shrink-0">
                  {(
                    [
                      { id: 'all', label: 'All Stock' },
                      { id: 'normal', label: 'Normal' },
                      { id: 'rare', label: 'Rare & Specialty' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setRareFilter(mode.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                        rareFilter === mode.id
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {selectedPharmacyFilter && (
                <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5 text-xs text-teal-900">
                  <span>
                    Filtering medicines stocked by{' '}
                    <strong>
                      {pharmacies.find((p) => p.id === selectedPharmacyFilter)?.name}
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedPharmacyFilter(null)}
                    className="font-semibold underline"
                  >
                    Show all pharmacies
                  </button>
                </div>
              )}

              {/* Medicine Catalog Grid */}
              {filteredMedicines.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
                  <p className="text-base font-semibold text-slate-900">
                    No matching medicines in immediate stock
                  </p>
                  <p className="text-sm text-slate-500">
                    Try clearing filters or use Medicine Hunter to source rare formulations across specialty depots.
                  </p>
                  <div className="flex justify-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedCategory('All');
                        setRareFilter('all');
                        setSelectedPharmacyFilter(null);
                      }}
                      className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
                    >
                      Reset Filters
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('hunter')}
                      className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold"
                    >
                      Search with Medicine Hunter
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredMedicines.map((med) => (
                    <MedicineCard
                      key={med.id}
                      medicine={med}
                      pharmacy={pharmacies.find((p) => p.id === med.pharmacyId)}
                      userLat={location.lat}
                      userLng={location.lng}
                      cartQty={cartQuantities[med.id] || 0}
                      onAddToCart={handleAddToCart}
                      onBuyNow={handleBuyNow}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {activeView === 'map' && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  Interactive Map &amp; Nearby Pharmacy Finder
                </h2>
                <p className="text-sm text-slate-600 mt-0.5">
                  Use GPS location, search an address, click the map to pin manually, or select a nearby pharmacy.
                </p>
              </div>
              <MapsLocationWidget
                mapsApiKey={mapsApiKey}
                location={location}
                onLocationChange={setLocation}
                pharmacies={sortedPharmacies}
                selectedPharmacyId={selectedPharmacyFilter}
                onSelectPharmacy={(p) => setSelectedPharmacyFilter(p.id)}
                savedAddresses={savedAddresses}
                onSaveCurrentAddress={handleSaveCurrentAddress}
                heightClass="h-[420px]"
                allowManualPin
                showSearchControls
              />
            </div>

            <div className="lg:col-span-4 space-y-3">
              <h3 className="text-base font-bold text-slate-900 px-1">
                Nearby Pharmacies ({sortedPharmacies.length})
              </h3>
              {sortedPharmacies.map((p) => {
                const km = haversineKm(location.lat, location.lng, p.lat, p.lng).toFixed(1);
                const medCount = medicines.filter((m) => m.pharmacyId === p.id).length;
                return (
                  <div
                    key={p.id}
                    className={`bg-white border rounded-2xl p-4 space-y-2 transition-colors ${
                      selectedPharmacyFilter === p.id ? 'border-teal-600' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                          <Store className="w-4 h-4 text-teal-600 shrink-0" />
                          {p.name}
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">{p.address}</p>
                      </div>
                      <span className="text-xs font-mono font-semibold text-teal-700 tabular-nums shrink-0">
                        {km} km
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-600 tabular-nums">
                      <span>{p.deliveryTimeMins} mins ETA</span>
                      <span aria-hidden="true">·</span>
                      <span>Rating {p.rating}</span>
                      <span aria-hidden="true">·</span>
                      <span>{p.open24x7 ? 'Open 24x7' : 'Day Hours'}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPharmacyFilter(p.id);
                        setActiveView('shop');
                      }}
                      className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors"
                    >
                      Shop {medCount} Medicines from Branch
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {activeView === 'orders' && (
          <OrdersTrackingView
            user={user}
            orders={customerOrders}
            pharmacies={pharmacies}
            mapsApiKey={mapsApiKey}
            selectedOrderId={selectedOrderId}
            onSelectOrder={setSelectedOrderId}
            onBrowseMedicines={() => setActiveView('shop')}
          />
        )}

        {activeView === 'emergency' && (
          <EmergencyRequestView
            user={user}
            location={location}
            onLocationChange={setLocation}
            pharmacies={sortedPharmacies}
            mapsApiKey={mapsApiKey}
            requests={emergencyRequests}
          />
        )}

        {activeView === 'hunter' && (
          <MedicineHunterView
            user={user}
            rareMedicines={medicines.filter((m) => m.isRare)}
            pharmacies={pharmacies}
            userLat={location.lat}
            userLng={location.lng}
            cartQuantities={cartQuantities}
            onAddToCart={handleAddToCart}
            onBuyNow={handleBuyNow}
            hunterRequests={hunterRequests}
          />
        )}

        {activeView === 'partner' && (
          <PartnerHubView
            user={user}
            orders={allOrders}
            partners={partners}
            emergencyRequests={emergencyRequests}
            hunterRequests={hunterRequests}
          />
        )}
      </main>

      {/* Clean Footer */}
      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>
            <strong className="text-slate-800">MediQuick</strong> — Every Medicine. One Platform.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => setActiveView('shop')} className="hover:text-slate-900">
              Catalog
            </button>
            <button type="button" onClick={() => setActiveView('hunter')} className="hover:text-slate-900">
              Medicine Hunter
            </button>
            <button type="button" onClick={() => setActiveView('emergency')} className="hover:text-red-700">
              Emergency Dispatch
            </button>
            <button type="button" onClick={() => setActiveView('orders')} className="hover:text-slate-900">
              Order Tracking
            </button>
            <button type="button" onClick={() => setActiveView('partner')} className="hover:text-slate-900">
              Pharmacy &amp; Delivery Desk
            </button>
          </div>
        </div>
      </footer>

      {/* Toast Feedback */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 text-xs font-semibold">
          <Package className="w-4 h-4 text-teal-400" />
          <span>{toastMsg}</span>
          <button
            type="button"
            onClick={() => {
              setToastMsg(null);
              setCartOpen(true);
            }}
            className="text-teal-300 underline ml-1"
          >
            View Cart
          </button>
        </div>
      )}

      {/* Drawers & Modals */}
      <CartDrawer
        isOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        items={cartItems}
        onUpdateQty={handleUpdateCartQty}
        onRemoveItem={handleRemoveCartItem}
        onClearCart={handleClearCart}
        onProceedToCheckout={() => {
          setCartOpen(false);
          setCheckoutState({ open: true, items: cartItems, isBuyNow: false });
        }}
      />

      <CheckoutModal
        isOpen={checkoutState.open}
        onClose={() => setCheckoutState((s) => ({ ...s, open: false }))}
        user={user}
        items={checkoutState.items}
        isBuyNow={checkoutState.isBuyNow}
        location={location}
        onLocationChange={setLocation}
        pharmacies={sortedPharmacies}
        savedAddresses={savedAddresses}
        onSaveCurrentAddress={handleSaveCurrentAddress}
        mapsApiKey={mapsApiKey}
        onClearCartAfterOrder={handleClearCart}
        onOrderSuccessNavigate={(newOrderId) => {
          setSelectedOrderId(newOrderId);
          setActiveView('orders');
        }}
      />

      <NotificationsDrawer
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        notifications={notifications}
        onOpenOrder={(orderId) => {
          setSelectedOrderId(orderId);
          setActiveView('orders');
        }}
      />

      <AuthProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
        profile={profile}
        savedAddresses={savedAddresses}
        onSelectAddress={setLocation}
      />
    </div>
  );
}
