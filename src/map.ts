import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";

import type { FeatureCollection, Point } from "geojson";
import maplibregl, {
  GeoJSONSource,
  Map as MapLibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import { createApp, reactive } from "petite-vue";
import { io, type Socket } from "socket.io-client";

import { buildCameraPageHref, navigatePageTabs, pages, subtabsByPage } from "./page-config";
import { clearPendingPlacePhoto, hasPendingPlacePhoto, readPendingPlacePhoto } from "./place-photo";
import { createSubtabNav } from "./subtabs";
import type {
  ClientToServerEvents,
  Place,
  PlaceInput,
  ServerToClientEvents,
} from "../shared/socket-events";

type UserProfile = {
  userId: string;
  username: string;
};

type MapMode = "LOCAL" | "WORLD";

type CameraSnapshot = {
  center: [number, number];
  zoom: number;
};

type MapPageState = {
  activePage: "map";
  activeSubtab: MapMode;
  activeSubtabs: MapMode[];
  cameraHref: string;
  hasPendingPhoto: boolean;
  isSubtabActive: (subtab: string) => boolean;
  setActiveSubtab: (subtab: string) => void;
  mapHeading: string;
  mapStatus: string;
  mapCoordsText: string;
  mapPinsText: string;
  mapUserText: string;
  mapZoomText: string;
  pages: typeof pages;
  onTabKeydown: (event: KeyboardEvent) => void;
  onSubtabKeydown: (event: KeyboardEvent, currentIndex: number) => void;
};

type PlaceProperties = {
  title: string;
  userId: string;
};

const socketUrl =
  import.meta.env.VITE_SOCKET_URL ??
  `${window.location.protocol}//${window.location.hostname}:3000`;

const gaodeRasterTileUrl =
  "https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}";
const placeSourceId = "shared-places";
const currentLocationSourceId = "current-location";
const profile = getOrCreateUserProfile();
const mapPixelRatio = Math.max(0.85, window.devicePixelRatio * 0.7);
const rasterBasemapStyle: StyleSpecification = {
  version: 8,
  sources: {
    "gaode-raster": {
      type: "raster",
      tiles: [gaodeRasterTileUrl],
      tileSize: 256,
      maxzoom: 18,
      minzoom: 0,
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#000000",
      },
    },
    {
      id: "gaode-raster-layer",
      type: "raster",
      source: "gaode-raster",
      paint: {
        "raster-opacity": 0.98,
      },
    },
  ],
};

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketUrl);
const places = new Map<string, Place>();

const defaultLocalCamera: CameraSnapshot = {
  center: [121.4737, 31.2304],
  zoom: 13.8,
};

const defaultWorldCamera: CameraSnapshot = {
  center: [12, 18],
  zoom: 0.75,
};

let map: MapLibreMap | null = null;
let mapReady = false;
let watchId: number | null = null;
let hasCenteredLocalMap = false;
let gpsAccuracy: number | null = null;
let currentLocation: [number, number] | null = null;
let gpsState = "STANDBY";
let localCamera = { ...defaultLocalCamera };
let worldCamera = { ...defaultWorldCamera };
const subtabNav = createSubtabNav<MapMode>({
  subtabs: subtabsByPage.map as MapMode[],
  initialSubtab: "LOCAL",
  beforeChange() {
    rememberActiveCamera();
  },
  onChange(mode) {
    applyMapMode(mode, false);
  },
});

const appState = reactive({
  activePage: "map",
  ...subtabNav,
  cameraHref: buildCameraPageHref(),
  hasPendingPhoto: hasPendingPlacePhoto(),
  mapHeading: "LOCAL MAP",
  mapStatus: "LOCAL STANDBY / LINK LOST",
  mapCoordsText: "CTR --.---- / --.----",
  mapPinsText: "PLACES 0 VIS / 0 TOT",
  mapUserText: `USER ${profile.username}`,
  mapZoomText: "ZOOM --.- / DBLCLICK PLACE",
  pages,
  onTabKeydown(event: KeyboardEvent) {
    navigatePageTabs("map", event);
  },
}) as MapPageState;

createApp(appState).mount("#app");

ensureMapReady();
startLocationTracking();

socket.on("connect", () => {
  syncMapReadout();
});

socket.on("disconnect", () => {
  syncMapReadout();
});

socket.on("allPlaces", (incomingPlaces) => {
  places.clear();

  for (const place of incomingPlaces) {
    places.set(place.id, place);
  }

  refreshPlacesSource();
  syncMapReadout();
});

socket.on("placeCreated", (place) => {
  if (places.has(place.id)) {
    return;
  }

  places.set(place.id, place);
  refreshPlacesSource();
  syncMapReadout();
});

window.addEventListener("pagehide", () => {
  if (watchId !== null && "geolocation" in navigator) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  socket.close();
  map?.remove();
  map = null;
  mapReady = false;
});

function ensureMapReady() {
  const host = document.getElementById("vault-map");
  if (!host || map) {
    return;
  }

  map = new maplibregl.Map({
    attributionControl: false,
    center: defaultLocalCamera.center,
    container: host,
    pixelRatio: mapPixelRatio,
    pitch: 0,
    renderWorldCopies: false,
    style: rasterBasemapStyle,
    zoom: defaultLocalCamera.zoom,
  });

  map.dragRotate.disable();
  map.doubleClickZoom.disable();
  map.touchZoomRotate.disableRotation();

  map.on("load", () => {
    mapReady = true;
    installMapLayers();
    applyMapMode(appState.activeSubtab, true);
    refreshPlacesSource();
    refreshCurrentLocationSource();
    syncMapReadout();

    requestAnimationFrame(() => {
      map?.resize();
    });
  });

  map.on("dblclick", (event) => {
    createPlaceAt(event.lngLat.lat, event.lngLat.lng);
  });

  for (const eventName of ["moveend", "zoomend"] as const) {
    map.on(eventName, () => {
      rememberActiveCamera();
      syncMapReadout();
    });
  }
}

function installMapLayers() {
  if (!map || map.getSource(placeSourceId) || map.getSource(currentLocationSourceId)) {
    return;
  }

  map.addSource(placeSourceId, {
    type: "geojson",
    data: emptyFeatureCollection<PlaceProperties>(),
  });

  map.addLayer({
    id: "shared-places-glow",
    source: placeSourceId,
    type: "circle",
    paint: {
      "circle-blur": 0.26,
      "circle-color": "#f6d747",
      "circle-opacity": 0.2,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 4, 6, 6, 12, 10, 18, 14],
      "circle-stroke-width": 0,
    },
  });

  map.addLayer({
    id: "shared-places-core",
    source: placeSourceId,
    type: "circle",
    paint: {
      "circle-color": "#f6d747",
      "circle-opacity": 0.94,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.5, 6, 2.5, 12, 4, 18, 5.5],
      "circle-stroke-color": "rgba(0, 0, 0, 0.85)",
      "circle-stroke-width": 1.2,
    },
  });

  map.addSource(currentLocationSourceId, {
    type: "geojson",
    data: emptyFeatureCollection(),
  });

  map.addLayer({
    id: "current-location-halo",
    source: currentLocationSourceId,
    type: "circle",
    paint: {
      "circle-color": "rgba(246, 215, 71, 0.16)",
      "circle-opacity": 1,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 6, 9, 12, 12, 18, 18],
      "circle-stroke-color": "rgba(246, 215, 71, 0.52)",
      "circle-stroke-width": 1.3,
    },
  });

  map.addLayer({
    id: "current-location-core",
    source: currentLocationSourceId,
    type: "circle",
    paint: {
      "circle-color": "#f6d747",
      "circle-opacity": 1,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 2, 6, 3, 12, 4.5, 18, 6],
      "circle-stroke-color": "rgba(0, 0, 0, 0.84)",
      "circle-stroke-width": 1.4,
    },
  });
}

function applyMapMode(mode: MapMode, immediate: boolean) {
  appState.activeSubtab = mode;
  appState.mapHeading = mode === "WORLD" ? "WORLD GLOBE" : "LOCAL MAP";

  if (!map || !mapReady) {
    syncMapReadout();
    return;
  }

  const target = mode === "WORLD" ? worldCamera : localCamera;

  map.setProjection({
    type: mode === "WORLD" ? "globe" : "mercator",
  });

  const camera = {
    center: target.center,
    essential: true,
    pitch: 0,
    zoom: target.zoom,
  };

  if (immediate) {
    map.jumpTo(camera);
  } else {
    map.easeTo({
      ...camera,
      duration: 650,
    });
  }

  requestAnimationFrame(() => {
    map?.resize();
  });

  syncMapReadout();
}

function rememberActiveCamera() {
  if (!map || !mapReady) {
    return;
  }

  const center = map.getCenter().wrap();
  const snapshot: CameraSnapshot = {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
  };

  if (appState.activeSubtab === "WORLD") {
    worldCamera = snapshot;
    return;
  }

  localCamera = snapshot;
}

function refreshPlacesSource() {
  const source = map?.getSource(placeSourceId);
  if (!(source instanceof GeoJSONSource)) {
    return;
  }

  source.setData(buildPlacesFeatureCollection());
}

function refreshCurrentLocationSource() {
  const source = map?.getSource(currentLocationSourceId);
  if (!(source instanceof GeoJSONSource)) {
    return;
  }

  source.setData(buildCurrentLocationFeatureCollection());
}

function buildPlacesFeatureCollection(): FeatureCollection<Point, PlaceProperties> {
  return {
    type: "FeatureCollection",
    features: Array.from(places.values()).map((place) => ({
      type: "Feature",
      id: place.id,
      properties: {
        title: place.title,
        userId: place.userId,
      },
      geometry: {
        type: "Point",
        coordinates: [place.longitude, place.latitude],
      },
    })),
  };
}

function buildCurrentLocationFeatureCollection(): FeatureCollection<Point> {
  if (!currentLocation) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [currentLocation[1], currentLocation[0]],
        },
        properties: {},
      },
    ],
  };
}

function createPlaceAt(latitude: number, longitude: number) {
  const place: PlaceInput = {
    photo: readPendingPlacePhoto(),
    title: `MARK ${new Date().toISOString().slice(11, 16)}`,
    description: "",
    latitude,
    longitude,
    userId: profile.userId,
  };

  clearPendingPlacePhoto();
  appState.hasPendingPhoto = false;
  socket.emit("createPlace", place);
}

function startLocationTracking() {
  if (watchId !== null) {
    return;
  }

  if (!("geolocation" in navigator)) {
    gpsState = "UNSUPPORTED";
    syncMapReadout();
    return;
  }

  gpsState = "ACQUIRING";
  syncMapReadout();

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const [fixedLng, fixedLat] = fixForChineseMap(
        position.coords.longitude,
        position.coords.latitude,
      );

      updateCurrentLocation(fixedLat, fixedLng, position.coords.accuracy);
    },
    (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        gpsState = "DENIED";
      } else if (error.code === error.TIMEOUT) {
        gpsState = "TIMEOUT";
      } else {
        gpsState = "ERROR";
      }

      syncMapReadout();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 5000,
    },
  );
}

function updateCurrentLocation(lat: number, lng: number, accuracy: number) {
  currentLocation = [lat, lng];
  gpsAccuracy = accuracy;
  gpsState = "LOCK";

  if (!hasCenteredLocalMap) {
    localCamera = {
      center: [lng, lat],
      zoom: 15.4,
    };
    hasCenteredLocalMap = true;

    if (appState.activeSubtab === "LOCAL") {
      applyMapMode("LOCAL", true);
    }
  }

  refreshCurrentLocationSource();
  syncMapReadout();
}

function syncMapReadout() {
  const linkState = socket.connected ? "LINK LIVE" : "LINK LOST";
  const modeLabel = appState.activeSubtab === "WORLD" ? "WORLD GLOBE" : `LOCAL ${gpsState}`;

  appState.mapHeading = appState.activeSubtab === "WORLD" ? "WORLD GLOBE" : "LOCAL MAP";
  appState.mapStatus = `${modeLabel} / ${linkState}`;
  appState.mapUserText =
    gpsAccuracy === null
      ? `USER ${profile.username}`
      : `USER ${profile.username} ACC ${Math.round(gpsAccuracy)}M`;

  if (!map || !mapReady) {
    appState.mapCoordsText = "CTR --.---- / --.----";
    appState.mapPinsText =
      appState.activeSubtab === "WORLD"
        ? `PLACES ${places.size} TRACKED`
        : `PLACES 0 VIS / ${places.size} TOT`;
    appState.mapZoomText = `${appState.activeSubtab === "WORLD" ? "GLOBE" : "ZOOM"} --.- / DBLCLICK PLACE`;
    return;
  }

  const center = map.getCenter().wrap();
  const visiblePlaces = appState.activeSubtab === "WORLD" ? places.size : countVisiblePlaces();

  appState.mapCoordsText = `CTR ${center.lat.toFixed(4)} / ${center.lng.toFixed(4)}`;
  appState.mapPinsText =
    appState.activeSubtab === "WORLD"
      ? `PLACES ${visiblePlaces} TRACKED`
      : `PLACES ${visiblePlaces} VIS / ${places.size} TOT`;
  appState.mapZoomText = `${
    appState.activeSubtab === "WORLD" ? "GLOBE" : "ZOOM"
  } ${map.getZoom().toFixed(1)} / DBLCLICK PLACE`;
}

function countVisiblePlaces() {
  if (!map) {
    return 0;
  }

  const bounds = map.getBounds();

  return Array.from(places.values()).filter((place) =>
    bounds.contains([place.longitude, place.latitude]),
  ).length;
}

function getOrCreateUserProfile(): UserProfile {
  const userIdKey = "token-boy-map-user-id";
  const usernameKey = "token-boy-map-user-name";

  let userId = localStorage.getItem(userIdKey);
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem(userIdKey, userId);
  }

  let username = localStorage.getItem(usernameKey);
  if (!username) {
    username = `DWELLER-${Math.floor(100 + Math.random() * 900)}`;
    localStorage.setItem(usernameKey, username);
  }

  return {
    userId,
    username,
  };
}

function fixForChineseMap(lng: number, lat: number): [number, number] {
  return wgs84ToGcj02(lng, lat);
}

function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) {
    return [lng, lat];
  }

  const a = 6378245;
  const ee = 0.006693421622965943;
  let dLat = transformLat(lng - 105, lat - 35);
  let dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  const magic = 1 - ee * Math.sin(radLat) ** 2;
  const sqrtMagic = Math.sqrt(magic);

  dLat = (dLat * 180) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);

  return [lng + dLng, lat + dLat];
}

function outOfChina(lng: number, lat: number) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lng: number, lat: number) {
  let result =
    -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  result += ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(lat * Math.PI) + 40 * Math.sin((lat / 3) * Math.PI)) * 2) / 3;
  result += ((160 * Math.sin((lat / 12) * Math.PI) + 320 * Math.sin((lat * Math.PI) / 30)) * 2) / 3;
  return result;
}

function transformLng(lng: number, lat: number) {
  let result =
    300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  result += ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(lng * Math.PI) + 40 * Math.sin((lng / 3) * Math.PI)) * 2) / 3;
  result += ((150 * Math.sin((lng / 12) * Math.PI) + 300 * Math.sin((lng / 30) * Math.PI)) * 2) / 3;
  return result;
}

function emptyFeatureCollection<
  TProperties extends object = Record<string, never>,
>(): FeatureCollection<Point, TProperties> {
  return {
    type: "FeatureCollection",
    features: [],
  };
}
