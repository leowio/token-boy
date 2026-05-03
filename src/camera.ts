import "./styles.css";

import { createApp, reactive } from "petite-vue";

import { installBootScreen } from "./boot-screen";
import { getCameraReturnHref } from "./page-config";
import {
  clearPendingPlacePhoto,
  hasPendingPlacePhoto,
  setPendingPlacePhoto,
} from "./place-photo";
import { installTokenBoyNotifier, notifyTokenBoy } from "./token-boy-notifier";
import type { PlaceCreationResult, PlaceInput } from "../shared/socket-events";

type CameraPageState = {
  cameraCoordsText: string;
  cameraFrameText: string;
  cameraHref: string;
  cameraPhotoText: string;
  cameraStatus: string;
  cameraUserText: string;
  capturePhoto: () => void;
  formStatus: string;
  hasPendingPhoto: boolean;
  hasSnapshot: boolean;
  isSaving: boolean;
  placeDescription: string;
  placeLatitude: string;
  placeLongitude: string;
  placeTitle: string;
  placeUserId: string;
  retakePhoto: () => void;
  savePlace: () => Promise<void>;
};

type UserProfile = {
  userId: string;
  username: string;
};

const profile = getOrCreateUserProfile();
const previewSize = 240;
const cameraFilter =
  "grayscale(1) brightness(0.28) sepia(1) saturate(8) hue-rotate(3deg) contrast(1.34)";
const apiBaseUrl =
  import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || "";

let videoElement: HTMLVideoElement | null = null;
let previewCanvas: HTMLCanvasElement | null = null;
let previewContext: CanvasRenderingContext2D | null = null;
let mediaStream: MediaStream | null = null;
let gpsAccuracy: number | null = null;
let watchId: number | null = null;
let gpsState = "STANDBY";
let cameraState = "STANDBY";
let frameSizeText = "FRAME -- x --";
let currentCoords: [number, number] | null = null;
let previewFrameId: number | null = null;
let snapshotCoords: [number, number] | null = null;
let snapshotPhoto: string | null = null;

const appState = reactive({
  cameraCoordsText: "GPS --.---- / --.----",
  cameraFrameText: frameSizeText,
  cameraHref: getCameraReturnHref(),
  cameraPhotoText: hasPendingPlacePhoto() ? "PHOTO ARMED" : "PHOTO EMPTY",
  cameraStatus: "CAM STANDBY / GPS STANDBY",
  cameraUserText: `USER ${profile.username}`,
  capturePhoto() {
    captureCurrentFrame();
  },
  formStatus: "CAPTURE IMAGE TO START RECORD",
  hasPendingPhoto: hasPendingPlacePhoto(),
  hasSnapshot: false,
  isSaving: false,
  placeDescription: "",
  placeLatitude: "--.----",
  placeLongitude: "--.----",
  placeTitle: "",
  placeUserId: profile.userId,
  retakePhoto() {
    resumeLivePreview();
  },
  async savePlace() {
    await storePlaceRecord();
  },
}) as CameraPageState;

createApp(appState).mount("#app");
installBootScreen();
installTokenBoyNotifier();

initializeCameraPage();
startLocationTracking();

window.addEventListener("pagehide", () => {
  if (watchId !== null && "geolocation" in navigator) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  stopCameraPreview();
});

function initializeCameraPage() {
  videoElement = document.getElementById(
    "field-camera-video",
  ) as HTMLVideoElement | null;
  previewCanvas = document.getElementById(
    "field-camera-canvas",
  ) as HTMLCanvasElement | null;
  previewContext = previewCanvas?.getContext("2d", { alpha: false }) ?? null;
  if (previewContext) {
    previewContext.imageSmoothingEnabled = false;
  }

  if (!videoElement || !previewCanvas || !previewContext) {
    return;
  }

  setupPreviewCanvas();

  if (!navigator.mediaDevices?.getUserMedia) {
    cameraState = "UNSUPPORTED";
    syncCameraReadout();
    return;
  }

  cameraState = "ACQUIRING";
  syncCameraReadout();

  void navigator.mediaDevices
    .getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 1280 },
      },
    })
    .then((stream) => {
      mediaStream = stream;
      if (!videoElement) {
        stopTracks(stream);
        return;
      }

      videoElement.srcObject = stream;
      videoElement.addEventListener("loadedmetadata", onVideoMetadataLoaded, {
        once: true,
      });
      void videoElement.play().catch(() => {
        cameraState = "ERROR";
        syncCameraReadout();
      });
    })
    .catch((error: DOMException) => {
      if (error.name === "NotAllowedError") {
        cameraState = "DENIED";
      } else if (
        error.name === "NotFoundError" ||
        error.name === "OverconstrainedError"
      ) {
        cameraState = "UNAVAILABLE";
      } else {
        cameraState = "ERROR";
      }

      syncCameraReadout();
    });
}

function onVideoMetadataLoaded() {
  if (!videoElement) {
    return;
  }

  frameSizeText = `FRAME ${videoElement.videoWidth} x ${videoElement.videoHeight}`;
  cameraState = "LIVE";
  startPreviewRender();
  syncCameraReadout();
}

function captureCurrentFrame() {
  if (!currentCoords) {
    cameraState = "WAIT GPS";
    appState.formStatus = "WAIT FOR GPS LOCK";
    syncCameraReadout();
    return;
  }

  if (
    !videoElement ||
    videoElement.videoWidth <= 0 ||
    videoElement.videoHeight <= 0
  ) {
    cameraState = mediaStream ? "WARMUP" : "IDLE";
    appState.formStatus = "CAMERA NOT READY";
    syncCameraReadout();
    return;
  }

  const canvas = document.createElement("canvas");

  canvas.width = previewSize;
  canvas.height = previewSize;

  const context = canvas.getContext("2d");
  if (!context) {
    cameraState = "ERROR";
    appState.formStatus = "CAPTURE FAILURE";
    syncCameraReadout();
    return;
  }

  if (!drawSquareFrame(context, canvas.width, canvas.height)) {
    cameraState = mediaStream ? "WARMUP" : "IDLE";
    appState.formStatus = "FRAME NOT AVAILABLE";
    syncCameraReadout();
    return;
  }

  const photo = canvas.toDataURL("image/jpeg", 0.84);
  setPendingPlacePhoto(photo);
  snapshotPhoto = photo;
  snapshotCoords = [...currentCoords];
  stopPreviewRender();
  appState.hasPendingPhoto = true;
  appState.hasSnapshot = true;
  appState.cameraPhotoText = "PHOTO LOCKED";
  appState.formStatus = "REVIEW AND STORE PLACE";
  appState.placeLatitude = snapshotCoords[0].toFixed(6);
  appState.placeLongitude = snapshotCoords[1].toFixed(6);
  appState.placeUserId = profile.userId;
  if (!appState.placeTitle.trim()) {
    appState.placeTitle = buildDefaultPlaceTitle();
  }
  cameraState = "LOCKED";
  syncCameraReadout();
}

function startLocationTracking() {
  if (watchId !== null) {
    return;
  }

  if (!("geolocation" in navigator)) {
    gpsState = "UNSUPPORTED";
    syncCameraReadout();
    return;
  }

  gpsState = "ACQUIRING";
  syncCameraReadout();

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const [fixedLng, fixedLat] = fixForChineseMap(
        position.coords.longitude,
        position.coords.latitude,
      );

      currentCoords = [fixedLat, fixedLng];
      gpsAccuracy = position.coords.accuracy;
      gpsState = "LOCK";
      syncCameraReadout();
    },
    (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        gpsState = "DENIED";
      } else if (error.code === error.TIMEOUT) {
        gpsState = "TIMEOUT";
      } else {
        gpsState = "ERROR";
      }

      syncCameraReadout();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 5000,
    },
  );
}

function syncCameraReadout() {
  appState.cameraStatus = `CAM ${cameraState} / GPS ${gpsState}`;
  appState.cameraPhotoText = appState.hasSnapshot
    ? "PHOTO LOCKED"
    : appState.hasPendingPhoto
      ? "PHOTO ARMED"
      : "PHOTO EMPTY";
  appState.cameraFrameText = frameSizeText;
  appState.cameraUserText =
    gpsAccuracy === null
      ? `USER ${profile.username}`
      : `USER ${profile.username} ACC ${Math.round(gpsAccuracy)}M`;

  if (!currentCoords) {
    appState.cameraCoordsText = "GPS --.---- / --.----";
    return;
  }

  appState.cameraCoordsText = `GPS ${currentCoords[0].toFixed(4)} / ${currentCoords[1].toFixed(4)}`;
}

function stopCameraPreview() {
  stopPreviewRender();

  if (!mediaStream) {
    return;
  }

  stopTracks(mediaStream);
  mediaStream = null;
  if (videoElement) {
    videoElement.srcObject = null;
  }
}

function resumeLivePreview() {
  snapshotPhoto = null;
  snapshotCoords = null;
  clearPendingPlacePhoto();
  appState.hasPendingPhoto = false;
  appState.hasSnapshot = false;
  appState.formStatus = "CAPTURE IMAGE TO START RECORD";
  appState.placeLatitude = "--.----";
  appState.placeLongitude = "--.----";
  cameraState = mediaStream ? "LIVE" : "STANDBY";
  startPreviewRender();
  syncCameraReadout();
}

function setupPreviewCanvas() {
  if (!previewCanvas || !previewContext) {
    return;
  }

  previewCanvas.width = previewSize;
  previewCanvas.height = previewSize;
  previewContext.imageSmoothingEnabled = false;
}

function startPreviewRender() {
  if (!previewCanvas || !previewContext) {
    return;
  }

  stopPreviewRender();

  const draw = () => {
    if (previewContext && previewCanvas) {
      drawSquareFrame(
        previewContext,
        previewCanvas.width,
        previewCanvas.height,
      );
    }

    previewFrameId = window.requestAnimationFrame(draw);
  };

  draw();
}

function stopPreviewRender() {
  if (previewFrameId === null) {
    return;
  }

  window.cancelAnimationFrame(previewFrameId);
  previewFrameId = null;
}

function drawSquareFrame(
  context: CanvasRenderingContext2D,
  outputWidth: number,
  outputHeight: number,
) {
  if (
    !videoElement ||
    videoElement.videoWidth <= 0 ||
    videoElement.videoHeight <= 0
  ) {
    return false;
  }

  const frameSize = Math.min(videoElement.videoWidth, videoElement.videoHeight);
  const cropX = (videoElement.videoWidth - frameSize) / 2;
  const cropY = (videoElement.videoHeight - frameSize) / 2;

  context.save();
  context.fillStyle = "#000";
  context.fillRect(0, 0, outputWidth, outputHeight);
  context.imageSmoothingEnabled = false;
  context.filter = cameraFilter;
  context.drawImage(
    videoElement,
    cropX,
    cropY,
    frameSize,
    frameSize,
    0,
    0,
    outputWidth,
    outputHeight,
  );
  context.restore();

  return true;
}

async function storePlaceRecord() {
  if (appState.isSaving) {
    return;
  }

  if (!snapshotPhoto || !snapshotCoords) {
    appState.formStatus = "CAPTURE REQUIRED";
    return;
  }

  const title = appState.placeTitle.trim();
  if (!title) {
    appState.formStatus = "TITLE REQUIRED";
    return;
  }

  const payload: PlaceInput = {
    photo: snapshotPhoto,
    title,
    description: appState.placeDescription.trim(),
    latitude: snapshotCoords[0],
    longitude: snapshotCoords[1],
    userId: profile.userId,
  };

  appState.isSaving = true;
  appState.formStatus = "STORING PLACE";

  try {
    const response = await fetch(`${apiBaseUrl}/api/places`, {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const result = (await response.json()) as PlaceCreationResult & {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(result.error || "Failed to store place");
    }

    appState.placeDescription = "";
    appState.placeTitle = "";
    resumeLivePreview();
    appState.formStatus = "PLACE STORED";
    await notifyTokenBoy(`+${result.tokenWorth} TOKENS`);
    await notifyTokenBoy("Thank you for your contribution");
  } catch (error) {
    appState.formStatus =
      error instanceof Error ? error.message.toUpperCase() : "STORE FAILURE";
  } finally {
    appState.isSaving = false;
  }
}

function buildDefaultPlaceTitle() {
  const now = new Date();
  const hours = `${now.getHours()}`.padStart(2, "0");
  const minutes = `${now.getMinutes()}`.padStart(2, "0");
  return `SITE ${hours}${minutes}`;
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
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
