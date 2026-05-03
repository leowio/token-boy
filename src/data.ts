import "./styles.css";

import { createApp, reactive } from "petite-vue";

import { installBootScreen } from "./boot-screen";
import {
  buildCameraPageHref,
  navigatePageTabs,
  pages,
  subtabsByPage,
} from "./page-config";
import { hasPendingPlacePhoto } from "./place-photo";
import {
  fetchPlaces,
  formatPlaceCoords,
  formatPlaceTimestamp,
  getPlaceDetailHref,
  summarizeDescription,
} from "./place-utils";
import { createSubtabNav } from "./subtabs";
import { installTokenBoyNotifier } from "./token-boy-notifier";
import { getOrCreateUserProfile } from "./user-profile";
import type { Place } from "../shared/socket-events";

const activePage = "data" as const;
const profile = getOrCreateUserProfile();
const subtabNav = createSubtabNav<"ALL" | "ME">({
  subtabs: subtabsByPage[activePage] as ("ALL" | "ME")[],
  initialSubtab: "ALL",
  onChange() {
    syncVisibleEntries();
  },
});

type DataEntryRow = {
  id: string;
  href: string;
  title: string;
  summary: string;
  coords: string;
  owner: string;
  timestamp: string;
};

let allPlaces: Place[] = [];

const appState = reactive({
  activePage,
  ...subtabNav,
  cameraHref: buildCameraPageHref(),
  dataStatus: "LOADING ARCHIVE",
  detailHint: "SELECT ENTRY FOR DETAIL",
  hasPendingPhoto: hasPendingPlacePhoto(),
  isLoading: true,
  visibleEntries: [] as DataEntryRow[],
  pages,
  onTabKeydown(event: KeyboardEvent) {
    navigatePageTabs(activePage, event);
  },
});

createApp(appState).mount("#app");
installBootScreen();
installTokenBoyNotifier();
void loadPlaces();

async function loadPlaces() {
  appState.isLoading = true;
  appState.dataStatus = "LOADING ARCHIVE";

  try {
    allPlaces = await fetchPlaces();
    syncVisibleEntries();
  } catch (error) {
    allPlaces = [];
    appState.visibleEntries = [];
    appState.dataStatus =
      error instanceof Error ? error.message.toUpperCase() : "LOAD FAILURE";
  } finally {
    appState.isLoading = false;
  }
}

function syncVisibleEntries() {
  const filteredPlaces =
    appState.activeSubtab === "ME"
      ? allPlaces.filter((place) => place.userId === profile.userId)
      : allPlaces;

  appState.visibleEntries = filteredPlaces.map((place) => ({
    id: place.id,
    href: getPlaceDetailHref(place.id),
    title: place.title,
    summary: summarizeDescription(place.description),
    coords: formatPlaceCoords(place.latitude, place.longitude),
    owner: place.userId === profile.userId ? "ME" : place.userId,
    timestamp: formatPlaceTimestamp(place.createdAt),
  }));

  if (filteredPlaces.length === 0) {
    appState.dataStatus =
      appState.activeSubtab === "ME" ? "NO PERSONAL ENTRIES" : "NO ENTRIES";
    appState.detailHint = "ARCHIVE EMPTY";
    return;
  }

  appState.dataStatus = `${appState.activeSubtab} ARCHIVE ${filteredPlaces.length}`;
  appState.detailHint = "OPEN ENTRY FOR FULL RECORD";
}
