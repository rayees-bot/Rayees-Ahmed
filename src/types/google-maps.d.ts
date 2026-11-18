declare namespace google {
  namespace maps {
    interface LatLngLiteral {
      lat: number;
      lng: number;
    }

    class LatLng {
      constructor(lat: number, lng: number);
      lat(): number;
      lng(): number;
    }

    class LatLngBounds {
      constructor(sw?: LatLngLiteral | LatLng, ne?: LatLngLiteral | LatLng);
    }

    class Map {
      panTo(latLng: LatLngLiteral | LatLng): void;
      fitBounds(bounds: LatLngBounds, padding?: number): void;
    }

    class Polyline {
      constructor(opts?: {
        path?: Array<LatLngLiteral | LatLng>;
        geodesic?: boolean;
        strokeColor?: string;
        strokeOpacity?: number;
        strokeWeight?: number;
        map?: Map | null;
      });
      setMap(map: Map | null): void;
    }

    namespace places {
      class AutocompleteSessionToken {}

      interface Place {
        displayName?: string;
        formattedAddress?: string;
        location?: LatLng;
        fetchFields(req: { fields: string[] }): Promise<void>;
      }

      interface PlacePrediction {
        text: { text: string };
        toPlace(): Place;
      }

      interface AutocompleteSuggestion {
        placePrediction?: PlacePrediction;
      }

      const AutocompleteSuggestion: {
        fetchAutocompleteSuggestions(req: {
          input: string;
          sessionToken?: AutocompleteSessionToken;
          locationBias?: { center: LatLngLiteral; radius: number };
        }): Promise<{ suggestions: AutocompleteSuggestion[] }>;
      };
    }
  }
}
