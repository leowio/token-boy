import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl, {
  Map as MapLibreMap,
  Marker,
  type StyleSpecification,
} from "maplibre-gl";
import { createApp, reactive } from "petite-vue";
import { io, type Socket } from "socket.io-client";

import {
  buildCameraPageHref,
  navigatePageTabs,
  pages,
  subtabsByPage,
} from "./page-config";
import { hasPendingPlacePhoto } from "./place-photo";
import { createSubtabNav } from "./subtabs";
import type {
  ClientToServerEvents,
  Place,
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

const socketUrl =
  import.meta.env.VITE_SOCKET_URL ||
  import.meta.env.VITE_BACKEND_URL ||
  undefined;

const gaodeRasterTileUrl =
  "https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}";
const labelZoomThreshold = 10.5;
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

const socket: Socket<ServerToClientEvents, ClientToServerEvents> =
  io(socketUrl);
const places = new Map<string, Place>();
const placeMarkers = new Map<string, Marker>();
let currentLocationMarker: Marker | null = null;

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
  mapZoomText: "ZOOM --.- / VIEW ONLY",
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

  refreshPlaceMarkers();
  syncMapReadout();
});

socket.on("placeCreated", (place) => {
  if (places.has(place.id)) {
    return;
  }

  places.set(place.id, place);
  refreshPlaceMarkers();
  syncMapReadout();
});

window.addEventListener("pagehide", () => {
  if (watchId !== null && "geolocation" in navigator) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  socket.close();
  clearPlaceMarkers();
  currentLocationMarker?.remove();
  currentLocationMarker = null;
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
    applyMapMode(appState.activeSubtab, true);
    refreshPlaceMarkers();
    refreshCurrentLocationMarker();
    syncMapReadout();

    requestAnimationFrame(() => {
      map?.resize();
    });
  });

  for (const eventName of ["moveend", "zoomend"] as const) {
    map.on(eventName, () => {
      rememberActiveCamera();
      syncMapReadout();
    });
  }
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

  refreshCurrentLocationMarker();
  syncMapReadout();
}

function syncMapReadout() {
  const linkState = socket.connected ? "LINK LIVE" : "LINK LOST";
  const modeLabel =
    appState.activeSubtab === "WORLD" ? "WORLD GLOBE" : `LOCAL ${gpsState}`;

  appState.mapHeading =
    appState.activeSubtab === "WORLD" ? "WORLD GLOBE" : "LOCAL MAP";
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
    appState.mapZoomText = `${appState.activeSubtab === "WORLD" ? "GLOBE" : "ZOOM"} --.- / VIEW ONLY`;
    return;
  }

  const center = map.getCenter().wrap();
  const visiblePlaces =
    appState.activeSubtab === "WORLD" ? places.size : countVisiblePlaces();
  syncMarkerLabelVisibility();

  appState.mapCoordsText = `CTR ${center.lat.toFixed(4)} / ${center.lng.toFixed(4)}`;
  appState.mapPinsText =
    appState.activeSubtab === "WORLD"
      ? `PLACES ${visiblePlaces} TRACKED`
      : `PLACES ${visiblePlaces} VIS / ${places.size} TOT`;
  appState.mapZoomText = `${
    appState.activeSubtab === "WORLD" ? "GLOBE" : "ZOOM"
  } ${map.getZoom().toFixed(1)} / VIEW ONLY`;
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

function clearPlaceMarkers() {
  for (const marker of placeMarkers.values()) {
    marker.remove();
  }

  placeMarkers.clear();
}

function syncMarkerLabelVisibility() {
  if (!map) {
    return;
  }

  const isLabelVisible = map.getZoom() >= labelZoomThreshold;
  for (const marker of placeMarkers.values()) {
    marker.getElement().classList.toggle("is-label-visible", isLabelVisible);
  }

  currentLocationMarker
    ?.getElement()
    .classList.toggle("is-label-visible", isLabelVisible);
}

function refreshPlaceMarkers() {
  if (!map) {
    return;
  }

  for (const [id, marker] of placeMarkers) {
    if (!places.has(id)) {
      marker.remove();
      placeMarkers.delete(id);
    }
  }

  for (const place of places.values()) {
    const existingMarker = placeMarkers.get(place.id);
    if (existingMarker) {
      updatePlaceMarker(existingMarker, place);
      continue;
    }

    const marker = createPlaceMarker(place).addTo(map);
    placeMarkers.set(place.id, marker);
  }

  syncMarkerLabelVisibility();
}

function refreshCurrentLocationMarker() {
  if (!map || !currentLocation) {
    return;
  }

  const [latitude, longitude] = currentLocation;
  if (!currentLocationMarker) {
    currentLocationMarker = createPinMarker(
      profile.username,
      latitude,
      longitude,
    ).addTo(map);
    syncMarkerLabelVisibility();
    return;
  }

  updatePinMarker(currentLocationMarker, profile.username, latitude, longitude);
}

function createPlaceMarker(place: Place) {
  return createPinMarker(place.title, place.latitude, place.longitude);
}

function createPinMarker(title: string, latitude: number, longitude: number) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "place-marker";
  element.setAttribute("aria-label", title);
  element.title = title;

  const pin = document.createElement("span");
  pin.className = "place-marker-pin";
  element.append(pin);

  const label = document.createElement("span");
  label.className = "place-marker-label";
  element.append(label);

  const marker = new Marker({
    anchor: "center",
    element,
  }).setLngLat([longitude, latitude]);

  updatePinMarker(marker, title, latitude, longitude);
  return marker;
}

function updatePlaceMarker(marker: Marker, place: Place) {
  updatePinMarker(marker, place.title, place.latitude, place.longitude);
}

function updatePinMarker(
  marker: Marker,
  title: string,
  latitude: number,
  longitude: number,
) {
  const element = marker.getElement();
  const label = element.querySelector<HTMLElement>(".place-marker-label");
  if (label) {
    label.textContent = title;
  }

  element.setAttribute("aria-label", title);
  element.setAttribute("title", title);
  marker.setLngLat([longitude, latitude]);
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
    -100 +
    2 * lng +
    3 * lat +
    0.2 * lat * lat +
    0.1 * lng * lat +
    0.2 * Math.sqrt(Math.abs(lng));
  result +=
    ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) *
      2) /
    3;
  result +=
    ((20 * Math.sin(lat * Math.PI) + 40 * Math.sin((lat / 3) * Math.PI)) * 2) /
    3;
  result +=
    ((160 * Math.sin((lat / 12) * Math.PI) +
      320 * Math.sin((lat * Math.PI) / 30)) *
      2) /
    3;
  return result;
}

function transformLng(lng: number, lat: number) {
  let result =
    300 +
    lng +
    2 * lat +
    0.1 * lng * lng +
    0.1 * lng * lat +
    0.1 * Math.sqrt(Math.abs(lng));
  result +=
    ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) *
      2) /
    3;
  result +=
    ((20 * Math.sin(lng * Math.PI) + 40 * Math.sin((lng / 3) * Math.PI)) * 2) /
    3;
  result +=
    ((150 * Math.sin((lng / 12) * Math.PI) +
      300 * Math.sin((lng / 30) * Math.PI)) *
      2) /
    3;
  return result;
}
