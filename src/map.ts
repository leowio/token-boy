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

import { navigatePageTabs, pages, subtabsByPage } from "./page-config";
import { createSubtabNav } from "./subtabs";
import type {
  ClientToServerEvents,
  MapPin,
  MapPinInput,
  ServerToClientEvents,
} from "../shared/socket-events";

type UserProfile = {
  userId: string;
  username: string;
  userHue: number;
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

type PinProperties = {
  label: string;
};

const socketUrl =
  import.meta.env.VITE_SOCKET_URL ??
  `${window.location.protocol}//${window.location.hostname}:3000`;

const gaodeRasterTileUrl =
  "https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}";
const pinSourceId = "shared-pins";
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
const mapPins = new Map<string, MapPin>();

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
  mapHeading: "LOCAL MAP",
  mapStatus: "LOCAL STANDBY / LINK LOST",
  mapCoordsText: "CTR --.---- / --.----",
  mapPinsText: "PINS 0 VIS / 0 TOT",
  mapUserText: `USER ${profile.username}`,
  mapZoomText: "ZOOM --.- / DBLCLICK PIN",
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

socket.on("allMapPins", (pins) => {
  mapPins.clear();

  for (const pin of pins) {
    mapPins.set(pin.id, pin);
  }

  refreshPinsSource();
  syncMapReadout();
});

socket.on("mapPin", (pin) => {
  if (mapPins.has(pin.id)) {
    return;
  }

  mapPins.set(pin.id, pin);
  refreshPinsSource();
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
    refreshPinsSource();
    refreshCurrentLocationSource();
    syncMapReadout();

    requestAnimationFrame(() => {
      map?.resize();
    });
  });

  map.on("dblclick", (event) => {
    placePin(event.lngLat.lat, event.lngLat.lng);
  });

  for (const eventName of ["moveend", "zoomend"] as const) {
    map.on(eventName, () => {
      rememberActiveCamera();
      syncMapReadout();
    });
  }
}

function installMapLayers() {
  if (!map || map.getSource(pinSourceId) || map.getSource(currentLocationSourceId)) {
    return;
  }

  map.addSource(pinSourceId, {
    type: "geojson",
    data: emptyFeatureCollection<PinProperties>(),
  });

  map.addLayer({
    id: "shared-pins-glow",
    source: pinSourceId,
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
    id: "shared-pins-core",
    source: pinSourceId,
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

function refreshPinsSource() {
  const source = map?.getSource(pinSourceId);
  if (!(source instanceof GeoJSONSource)) {
    return;
  }

  source.setData(buildPinsFeatureCollection());
}

function refreshCurrentLocationSource() {
  const source = map?.getSource(currentLocationSourceId);
  if (!(source instanceof GeoJSONSource)) {
    return;
  }

  source.setData(buildCurrentLocationFeatureCollection());
}

function buildPinsFeatureCollection(): FeatureCollection<Point, PinProperties> {
  return {
    type: "FeatureCollection",
    features: Array.from(mapPins.values()).map((pin) => ({
      type: "Feature",
      id: pin.id,
      properties: {
        label: pin.username.toUpperCase(),
      },
      geometry: {
        type: "Point",
        coordinates: [pin.lng, pin.lat],
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

function placePin(lat: number, lng: number) {
  const pin: MapPinInput = {
    lat,
    lng,
    userHue: profile.userHue,
    userId: profile.userId,
    username: profile.username,
  };

  socket.emit("mapPin", pin);
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
        ? `PINS ${mapPins.size} TRACKED`
        : `PINS 0 VIS / ${mapPins.size} TOT`;
    appState.mapZoomText = `${appState.activeSubtab === "WORLD" ? "GLOBE" : "ZOOM"} --.- / DBLCLICK PIN`;
    return;
  }

  const center = map.getCenter().wrap();
  const visiblePins = appState.activeSubtab === "WORLD" ? mapPins.size : countVisiblePins();

  appState.mapCoordsText = `CTR ${center.lat.toFixed(4)} / ${center.lng.toFixed(4)}`;
  appState.mapPinsText =
    appState.activeSubtab === "WORLD"
      ? `PINS ${visiblePins} TRACKED`
      : `PINS ${visiblePins} VIS / ${mapPins.size} TOT`;
  appState.mapZoomText = `${
    appState.activeSubtab === "WORLD" ? "GLOBE" : "ZOOM"
  } ${map.getZoom().toFixed(1)} / DBLCLICK PIN`;
}

function countVisiblePins() {
  if (!map) {
    return 0;
  }

  const bounds = map.getBounds();

  return Array.from(mapPins.values()).filter((pin) => bounds.contains([pin.lng, pin.lat])).length;
}

function getOrCreateUserProfile(): UserProfile {
  const userIdKey = "token-boy-map-user-id";
  const usernameKey = "token-boy-map-user-name";
  const userHueKey = "token-boy-map-user-hue";

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

  let userHue = Number(localStorage.getItem(userHueKey));
  if (!Number.isFinite(userHue)) {
    userHue = 46 + Math.floor(Math.random() * 8);
    localStorage.setItem(userHueKey, String(userHue));
  }

  return {
    userHue,
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
