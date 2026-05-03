import "./styles.css";

import { createApp, reactive } from "petite-vue";

import { installBootScreen } from "./boot-screen";
import { buildCameraPageHref, navigatePageTabs, pages } from "./page-config";
import { hasPendingPlacePhoto } from "./place-photo";
import {
  fetchPlaces,
  formatPlaceCoords,
  formatPlaceTimestamp,
} from "./place-utils";
import { installTokenBoyNotifier } from "./token-boy-notifier";
import { getOrCreateUserProfile } from "./user-profile";
import type { Place } from "../shared/socket-events";

const activePage = "data" as const;
const profile = getOrCreateUserProfile();
const placeId =
  new URLSearchParams(window.location.search).get("id")?.trim() ?? "";

const appState = reactive({
  activePage,
  cameraHref: buildCameraPageHref(),
  detailHint: "SELECT AN ENTRY FROM THE ARCHIVE",
  detailLabel: "DETAIL",
  detailStatus: "LOADING RECORD",
  hasPendingPhoto: hasPendingPlacePhoto(),
  pages,
  place: null as Place | null,
  placeCoords: "--.---- / --.----",
  placeDescription: "NO DESCRIPTION",
  placeTimestamp: "----.--.-- --:--",
  onTabKeydown(event: KeyboardEvent) {
    navigatePageTabs(activePage, event);
  },
});

createApp(appState).mount("#app");
installBootScreen();
installTokenBoyNotifier();
void loadPlace();

async function loadPlace() {
  if (!placeId) {
    appState.detailStatus = "ENTRY MISSING";
    return;
  }

  try {
    const places = await fetchPlaces();
    const place = places.find((entry) => entry.id === placeId) ?? null;

    if (!place) {
      appState.detailStatus = "ENTRY NOT FOUND";
      return;
    }

    appState.place = place;
    appState.detailLabel = place.title;
    appState.detailStatus =
      place.userId === profile.userId ? "MY RECORD" : "FIELD RECORD";
    appState.placeCoords = formatPlaceCoords(place.latitude, place.longitude);
    appState.placeDescription = place.description.trim() || "NO DESCRIPTION";
    appState.placeTimestamp = formatPlaceTimestamp(place.createdAt);
  } catch (error) {
    appState.detailStatus =
      error instanceof Error ? error.message.toUpperCase() : "LOAD FAILURE";
  }
}
