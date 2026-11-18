import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  InfoWindow,
  Pin,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Bookmark,
  Check,
  Crosshair,
  MapPin,
  Navigation,
  Search,
  Store,
  Truck,
} from 'lucide-react';
import type { GeoLocation, Order, Pharmacy, SavedAddress } from '../types/mediquick';

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function usePlaceAutocomplete(input: string, biasCenter: { lat: number; lng: number }) {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!placesLib || !input.trim()) {
      setSuggestions([]);
      return;
    }

    const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new AutocompleteSessionToken();
    }

    let cancelled = false;
    setIsLoading(true);

    const timer = window.setTimeout(() => {
      AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: input.trim(),
        sessionToken: sessionTokenRef.current!,
        locationBias: {
          center: biasCenter,
          radius: 25000,
        },
      })
        .then((res: { suggestions?: google.maps.places.AutocompleteSuggestion[] }) => {
          if (!cancelled) {
            setSuggestions(res.suggestions || []);
            setIsLoading(false);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setSuggestions([]);
            setIsLoading(false);
          }
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429') || msg.includes('OVER_QUERY_LIMIT')) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [placesLib, input, biasCenter.lat, biasCenter.lng]);

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
    setSuggestions([]);
  }, []);

  return { placesLib, suggestions, isLoading, resetSession };
}

function PlaceSearchInput({
  biasCenter,
  onSelectLocation,
}: {
  biasCenter: { lat: number; lng: number };
  onSelectLocation: (loc: GeoLocation) => void;
}) {
  const [queryText, setQueryText] = useState('');
  const { placesLib, suggestions, isLoading, resetSession } = usePlaceAutocomplete(
    queryText,
    biasCenter,
  );

  const handleSelect = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    if (!placesLib || !suggestion.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });
      const loc = place.location;
      if (loc) {
        onSelectLocation({
          lat: loc.lat(),
          lng: loc.lng(),
          address: place.formattedAddress || place.displayName || suggestion.placePrediction.text.text,
          label: place.displayName || 'Selected Address',
        });
      }
      setQueryText('');
      resetSession();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT')) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
    }
  };

  return (
    <div className="relative flex-1">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="Search street, landmark, or area..."
          className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600"
        />
      </div>
      {(suggestions.length > 0 || isLoading) && queryText.trim().length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg z-30 max-h-56 overflow-y-auto divide-y divide-slate-100">
          {isLoading && (
            <div className="px-3.5 py-2.5 text-xs text-slate-500">Searching places...</div>
          )}
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelect(s)}
              className="w-full text-left px-3.5 py-2.5 text-sm text-slate-700 hover:bg-teal-50/70 flex items-start gap-2.5 transition-colors"
            >
              <MapPin className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
              <span className="line-clamp-2">{s.placePrediction?.text.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DeliveryRouteLayer({
  origin,
  destination,
}: {
  origin: google.maps.LatLngLiteral;
  destination: google.maps.LatLngLiteral;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');

  useEffect(() => {
    if (!map) return;
    let activePolyline: google.maps.Polyline | null = null;
    let cancelled = false;

    const drawFallbackLine = () => {
      if (cancelled) return;
      activePolyline = new google.maps.Polyline({
        path: [origin, destination],
        geodesic: true,
        strokeColor: '#0D9488',
        strokeOpacity: 0.85,
        strokeWeight: 4,
        map,
      });
    };

    const computeModernRoute = async () => {
      if (!routesLib || !routesLib.Route) {
        drawFallbackLine();
        return;
      }

      try {
        const RouteClass = routesLib.Route as unknown as {
          new (m?: google.maps.Map): {
            computeRoutes: (req: unknown) => Promise<{
              routes?: Array<{
                polyline?: { encodedPolyline?: string };
                viewport?: {
                  southwest: google.maps.LatLngLiteral;
                  northeast: google.maps.LatLngLiteral;
                };
              }>;
            }>;
          };
          decode?: (encoded: string) => google.maps.LatLng[];
        };

        const routeService = new RouteClass(map);
        const response = await routeService.computeRoutes({
          origin,
          destination,
          travelMode: 'DRIVING',
          provideRouteAlternatives: false,
        });

        if (cancelled) return;
        const route = response?.routes?.[0];
        if (route?.polyline?.encodedPolyline && typeof RouteClass.decode === 'function') {
          const path = RouteClass.decode(route.polyline.encodedPolyline);
          activePolyline = new google.maps.Polyline({
            path,
            geodesic: true,
            strokeColor: '#0D9488',
            strokeOpacity: 0.95,
            strokeWeight: 5,
            map,
          });
          if (route.viewport) {
            const bounds = new google.maps.LatLngBounds(
              route.viewport.southwest,
              route.viewport.northeast,
            );
            map.fitBounds(bounds, 48);
          }
        } else {
          drawFallbackLine();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429') || msg.includes('OVER_QUERY_LIMIT')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        drawFallbackLine();
      }
    };

    computeModernRoute();

    return () => {
      cancelled = true;
      if (activePolyline) {
        activePolyline.setMap(null);
      }
    };
  }, [map, routesLib, origin.lat, origin.lng, destination.lat, destination.lng]);

  return null;
}

function MapCenterSync({ center }: { center: { lat: number; lng: number } }) {
  const map = useMap();
  useEffect(() => {
    if (map) {
      map.panTo(center);
    }
  }, [map, center.lat, center.lng]);
  return null;
}

function InteractiveGoogleMapCanvas({
  location,
  onLocationChange,
  pharmacies,
  selectedPharmacyId,
  onSelectPharmacy,
  trackingOrder,
  heightClass,
  allowManualPin,
}: {
  location: GeoLocation;
  onLocationChange: (loc: GeoLocation) => void;
  pharmacies: Pharmacy[];
  selectedPharmacyId?: string | null;
  onSelectPharmacy?: (pharmacy: Pharmacy) => void;
  trackingOrder?: Order | null;
  heightClass: string;
  allowManualPin: boolean;
}) {
  const loadingStatus = useApiLoadingStatus();
  const [activePharmacyInfo, setActivePharmacyInfo] = useState<Pharmacy | null>(null);

  if (loadingStatus === APILoadingStatus.FAILED || loadingStatus === APILoadingStatus.AUTH_FAILURE) {
    return (
      <CoordinateFallbackMap
        location={location}
        onLocationChange={onLocationChange}
        pharmacies={pharmacies}
        selectedPharmacyId={selectedPharmacyId}
        onSelectPharmacy={onSelectPharmacy}
        trackingOrder={trackingOrder}
        heightClass={heightClass}
        allowManualPin={allowManualPin}
      />
    );
  }

  const mapCenter = trackingOrder?.partnerLat && trackingOrder?.partnerLng
    ? { lat: trackingOrder.partnerLat, lng: trackingOrder.partnerLng }
    : { lat: location.lat, lng: location.lng };

  return (
    <div className={`relative w-full ${heightClass} rounded-2xl overflow-hidden border border-slate-200 bg-slate-100`}>
      <GoogleMap
        defaultCenter={mapCenter}
        defaultZoom={13}
        mapId="DEMO_MAP_ID"
        gestureHandling="greedy"
        disableDefaultUI={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
        onClick={(ev) => {
          if (!allowManualPin || !ev.detail.latLng) return;
          const lat = Number(ev.detail.latLng.lat.toFixed(5));
          const lng = Number(ev.detail.latLng.lng.toFixed(5));
          onLocationChange({
            lat,
            lng,
            address: `Pinned Location (${lat}, ${lng})`,
            label: 'Manual Pin',
          });
        }}
      >
        <MapCenterSync center={mapCenter} />

        {/* Customer / Delivery Location Pin */}
        <AdvancedMarker
          position={{
            lat: trackingOrder ? trackingOrder.deliveryLat : location.lat,
            lng: trackingOrder ? trackingOrder.deliveryLng : location.lng,
          }}
          title="Delivery Location"
        >
          <Pin background="#0F172A" borderColor="#FFFFFF" glyphColor="#FFFFFF" scale={1.15} />
        </AdvancedMarker>

        {/* Nearby Pharmacies */}
        {!trackingOrder &&
          pharmacies.map((pharmacy) => {
            const isSelected = pharmacy.id === selectedPharmacyId;
            return (
              <AdvancedMarker
                key={pharmacy.id}
                position={{ lat: pharmacy.lat, lng: pharmacy.lng }}
                title={pharmacy.name}
                onClick={() => {
                  setActivePharmacyInfo(pharmacy);
                  onSelectPharmacy?.(pharmacy);
                }}
              >
                <Pin
                  background={isSelected ? '#0D9488' : '#14B8A6'}
                  borderColor="#FFFFFF"
                  glyphColor="#FFFFFF"
                  scale={isSelected ? 1.2 : 1.0}
                />
              </AdvancedMarker>
            );
          })}

        {activePharmacyInfo && !trackingOrder && (
          <InfoWindow
            position={{ lat: activePharmacyInfo.lat, lng: activePharmacyInfo.lng }}
            onCloseClick={() => setActivePharmacyInfo(null)}
          >
            <div className="p-1 max-w-[210px] space-y-1">
              <p className="font-semibold text-sm text-slate-900">{activePharmacyInfo.name}</p>
              <p className="text-xs text-slate-600">{activePharmacyInfo.address}</p>
              <p className="text-xs font-medium text-teal-700 tabular-nums">
                {activePharmacyInfo.deliveryTimeMins} mins ETA · Rating {activePharmacyInfo.rating}
              </p>
            </div>
          </InfoWindow>
        )}

        {/* Active Delivery Tracking Mode */}
        {trackingOrder && (
          <>
            <AdvancedMarker
              position={{ lat: trackingOrder.pharmacyLat, lng: trackingOrder.pharmacyLng }}
              title={trackingOrder.pharmacyName}
            >
              <Pin background="#0D9488" borderColor="#FFFFFF" glyphColor="#FFFFFF" scale={1.1} />
            </AdvancedMarker>

            {trackingOrder.partnerLat !== undefined && trackingOrder.partnerLng !== undefined && (
              <AdvancedMarker
                position={{ lat: trackingOrder.partnerLat, lng: trackingOrder.partnerLng }}
                title={trackingOrder.partnerName || 'Delivery Partner'}
              >
                <div className="w-9 h-9 rounded-full bg-teal-600 border-2 border-white shadow-md flex items-center justify-center text-white">
                  <Truck className="w-4 h-4" />
                </div>
              </AdvancedMarker>
            )}

            <DeliveryRouteLayer
              origin={{ lat: trackingOrder.pharmacyLat, lng: trackingOrder.pharmacyLng }}
              destination={{ lat: trackingOrder.deliveryLat, lng: trackingOrder.deliveryLng }}
            />
          </>
        )}
      </GoogleMap>
    </div>
  );
}

function CoordinateFallbackMap({
  location,
  onLocationChange,
  pharmacies,
  selectedPharmacyId,
  onSelectPharmacy,
  trackingOrder,
  heightClass,
  allowManualPin,
}: {
  location: GeoLocation;
  onLocationChange: (loc: GeoLocation) => void;
  pharmacies: Pharmacy[];
  selectedPharmacyId?: string | null;
  onSelectPharmacy?: (pharmacy: Pharmacy) => void;
  trackingOrder?: Order | null;
  heightClass: string;
  allowManualPin: boolean;
}) {
  const baseLat = trackingOrder ? trackingOrder.deliveryLat : location.lat;
  const baseLng = trackingOrder ? trackingOrder.deliveryLng : location.lng;

  const toPercent = (lat: number, lng: number) => {
    const x = 50 + ((lng - baseLng) / 0.08) * 100;
    const y = 50 - ((lat - baseLat) / 0.08) * 100;
    return {
      left: `${Math.min(90, Math.max(10, x))}%`,
      top: `${Math.min(88, Math.max(12, y))}%`,
    };
  };

  const handleBoardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!allowManualPin) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width - 0.5;
    const ry = 0.5 - (e.clientY - rect.top) / rect.height;
    const lat = Number((baseLat + ry * 0.08).toFixed(5));
    const lng = Number((baseLng + rx * 0.08).toFixed(5));
    onLocationChange({
      lat,
      lng,
      address: `Pinned Location (${lat}, ${lng})`,
      label: 'Manual Pin',
    });
  };

  return (
    <div
      onClick={handleBoardClick}
      className={`relative w-full ${heightClass} rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 select-none ${
        allowManualPin ? 'cursor-crosshair' : ''
      }`}
    >
      {/* Subtle clinical grid */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.18) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />

      {/* Route SVG line for tracking */}
      {trackingOrder && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <line
            x1={toPercent(trackingOrder.pharmacyLat, trackingOrder.pharmacyLng).left}
            y1={toPercent(trackingOrder.pharmacyLat, trackingOrder.pharmacyLng).top}
            x2={toPercent(trackingOrder.deliveryLat, trackingOrder.deliveryLng).left}
            y2={toPercent(trackingOrder.deliveryLat, trackingOrder.deliveryLng).top}
            stroke="#0D9488"
            strokeWidth="3"
            strokeDasharray="6 4"
          />
        </svg>
      )}

      {/* Customer pin */}
      <div
        style={toPercent(baseLat, baseLng)}
        className="absolute -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center"
      >
        <div className="w-8 h-8 rounded-full bg-slate-900 text-white shadow-md border-2 border-white flex items-center justify-center">
          <MapPin className="w-4 h-4" />
        </div>
        <span className="mt-1 px-2 py-0.5 bg-slate-900 text-white text-[11px] font-medium rounded shadow whitespace-nowrap">
          Delivery Pin
        </span>
      </div>

      {/* Pharmacies */}
      {!trackingOrder &&
        pharmacies.map((p) => {
          const pos = toPercent(p.lat, p.lng);
          const selected = p.id === selectedPharmacyId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectPharmacy?.(p);
              }}
              style={pos}
              className="absolute -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center group"
            >
              <div
                className={`w-8 h-8 rounded-full border-2 border-white shadow flex items-center justify-center transition-transform group-hover:scale-110 ${
                  selected ? 'bg-teal-700 text-white scale-110' : 'bg-teal-600 text-white'
                }`}
              >
                <Store className="w-4 h-4" />
              </div>
              <span className="mt-1 px-2 py-0.5 bg-white border border-slate-200 text-slate-800 text-[11px] font-medium rounded shadow-sm whitespace-nowrap">
                {p.name.split(' ')[0]} · {p.deliveryTimeMins}m
              </span>
            </button>
          );
        })}

      {/* Tracking markers */}
      {trackingOrder && (
        <>
          <div
            style={toPercent(trackingOrder.pharmacyLat, trackingOrder.pharmacyLng)}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center"
          >
            <div className="w-8 h-8 rounded-full bg-teal-600 text-white border-2 border-white shadow flex items-center justify-center">
              <Store className="w-4 h-4" />
            </div>
            <span className="mt-1 px-2 py-0.5 bg-white border border-slate-200 text-slate-800 text-[11px] font-medium rounded shadow-sm whitespace-nowrap">
              {trackingOrder.pharmacyName.split(' ')[0]}
            </span>
          </div>

          {trackingOrder.partnerLat !== undefined && trackingOrder.partnerLng !== undefined && (
            <div
              style={toPercent(trackingOrder.partnerLat, trackingOrder.partnerLng)}
              className="absolute -translate-x-1/2 -translate-y-1/2 z-30 flex flex-col items-center transition-all duration-500"
            >
              <div className="w-9 h-9 rounded-full bg-teal-700 text-white border-2 border-white shadow-lg flex items-center justify-center">
                <Truck className="w-4 h-4" />
              </div>
              <span className="mt-1 px-2 py-0.5 bg-teal-700 text-white text-[11px] font-semibold rounded shadow whitespace-nowrap">
                {trackingOrder.partnerName || 'Rider'}
              </span>
            </div>
          )}
        </>
      )}

      {allowManualPin && (
        <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 shadow-sm">
          Click anywhere on the map to move your delivery pin
        </div>
      )}
    </div>
  );
}

interface MapsLocationWidgetProps {
  mapsApiKey: string;
  location: GeoLocation;
  onLocationChange: (loc: GeoLocation) => void;
  pharmacies: Pharmacy[];
  selectedPharmacyId?: string | null;
  onSelectPharmacy?: (pharmacy: Pharmacy) => void;
  savedAddresses?: SavedAddress[];
  onSaveCurrentAddress?: (label: string) => Promise<void>;
  trackingOrder?: Order | null;
  heightClass?: string;
  allowManualPin?: boolean;
  showSearchControls?: boolean;
}

export const MapsLocationWidget: React.FC<MapsLocationWidgetProps> = ({
  mapsApiKey,
  location,
  onLocationChange,
  pharmacies,
  selectedPharmacyId,
  onSelectPharmacy,
  savedAddresses = [],
  onSaveCurrentAddress,
  trackingOrder = null,
  heightClass = 'h-[360px]',
  allowManualPin = true,
  showSearchControls = true,
}) => {
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [saveLabel, setSaveLabel] = useState('Home');
  const [savingAddr, setSavingAddr] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleUseGps = () => {
    if (!navigator.geolocation) {
      setGpsError('Browser geolocation is unavailable.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(5));
        const lng = Number(pos.coords.longitude.toFixed(5));
        onLocationChange({
          lat,
          lng,
          address: `GPS Location (${lat}, ${lng})`,
          label: 'GPS Current Location',
        });
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(err.message || 'Location permission denied.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const handleSaveAddress = async () => {
    if (!onSaveCurrentAddress || !saveLabel.trim()) return;
    setSavingAddr(true);
    try {
      await onSaveCurrentAddress(saveLabel.trim());
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setSavingAddr(false);
    }
  };

  const mapContent = mapsApiKey ? (
    <APIProvider apiKey={mapsApiKey} libraries={['places', 'routes', 'marker']}>
      {showSearchControls && (
        <div className="flex flex-col sm:flex-row gap-2.5 mb-3">
          <PlaceSearchInput biasCenter={location} onSelectLocation={onLocationChange} />
          <button
            type="button"
            onClick={handleUseGps}
            disabled={gpsLoading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:border-teal-600 text-slate-800 text-sm font-medium rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            <Crosshair className="w-4 h-4 text-teal-600" />
            {gpsLoading ? 'Locating...' : 'Use GPS Location'}
          </button>
        </div>
      )}
      <InteractiveGoogleMapCanvas
        location={location}
        onLocationChange={onLocationChange}
        pharmacies={pharmacies}
        selectedPharmacyId={selectedPharmacyId}
        onSelectPharmacy={onSelectPharmacy}
        trackingOrder={trackingOrder}
        heightClass={heightClass}
        allowManualPin={allowManualPin}
      />
    </APIProvider>
  ) : (
    <>
      {showSearchControls && (
        <div className="flex flex-col sm:flex-row gap-2.5 mb-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              defaultValue={location.address}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val && val !== location.address) {
                  onLocationChange({ ...location, address: val, label: 'Manual Address' });
                }
              }}
              placeholder="Enter street address or click map pin..."
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600"
            />
          </div>
          <button
            type="button"
            onClick={handleUseGps}
            disabled={gpsLoading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:border-teal-600 text-slate-800 text-sm font-medium rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            <Crosshair className="w-4 h-4 text-teal-600" />
            {gpsLoading ? 'Locating...' : 'Use GPS Location'}
          </button>
        </div>
      )}
      <CoordinateFallbackMap
        location={location}
        onLocationChange={onLocationChange}
        pharmacies={pharmacies}
        selectedPharmacyId={selectedPharmacyId}
        onSelectPharmacy={onSelectPharmacy}
        trackingOrder={trackingOrder}
        heightClass={heightClass}
        allowManualPin={allowManualPin}
      />
    </>
  );

  return (
    <div className="space-y-3">
      {mapContent}

      {gpsError && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {gpsError}
        </p>
      )}

      {showSearchControls && (
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
          <div className="flex items-start gap-2 text-xs text-slate-600">
            <Navigation className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-900">{location.label || 'Selected'}:</span>{' '}
              <span>{location.address}</span>{' '}
              <span className="font-mono text-slate-400 tabular-nums">
                ({location.lat.toFixed(4)}, {location.lng.toFixed(4)})
              </span>
            </div>
          </div>

          {onSaveCurrentAddress && (
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="text"
                value={saveLabel}
                onChange={(e) => setSaveLabel(e.target.value)}
                maxLength={40}
                placeholder="Label (Home)"
                className="w-28 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-600"
              />
              <button
                type="button"
                onClick={handleSaveAddress}
                disabled={savingAddr}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                {savedNotice ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Bookmark className="w-3.5 h-3.5" />}
                {savedNotice ? 'Saved' : 'Save Address'}
              </button>
            </div>
          )}
        </div>
      )}

      {savedAddresses.length > 0 && showSearchControls && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs font-medium text-slate-500">Saved Addresses:</span>
          {savedAddresses.map((addr) => {
            const active =
              Math.abs(addr.lat - location.lat) < 0.0002 &&
              Math.abs(addr.lng - location.lng) < 0.0002;
            return (
              <button
                key={addr.id}
                type="button"
                onClick={() =>
                  onLocationChange({
                    lat: addr.lat,
                    lng: addr.lng,
                    address: addr.addressLine,
                    label: addr.label,
                  })
                }
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-teal-50 border-teal-600 text-teal-800'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                {addr.label} · {addr.addressLine.slice(0, 28)}
                {addr.addressLine.length > 28 ? '...' : ''}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
