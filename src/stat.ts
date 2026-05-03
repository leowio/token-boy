import "./styles.css";

import { createApp, reactive } from "petite-vue";

import { installBootScreen } from "./boot-screen";
import { buildCameraPageHref, navigatePageTabs, pages } from "./page-config";
import { hasPendingPlacePhoto } from "./place-photo";
import { fetchPlaces } from "./place-utils";
import { installTokenBoyNotifier } from "./token-boy-notifier";
import { getOrCreateUserProfile } from "./user-profile";

const activePage = "stat" as const;
const profile = getOrCreateUserProfile();

const appState = reactive({
  activePage,
  cameraHref: buildCameraPageHref(),
  hasPendingPhoto: hasPendingPlacePhoto(),
  isLoading: true,
  userPlaceCount: 0,
  statStatus: "LOADING ENTRIES",
  pages,
  onTabKeydown(event: KeyboardEvent) {
    navigatePageTabs(activePage, event);
  },
});

createApp(appState).mount("#app");
installBootScreen();
installTokenBoyNotifier();
void loadUserPlaceCount();

async function loadUserPlaceCount() {
  appState.isLoading = true;
  appState.statStatus = "LOADING ENTRIES";

  try {
    const places = await fetchPlaces();
    appState.userPlaceCount = places.filter(
      (place) => place.userId === profile.userId,
    ).length;
    appState.statStatus = "ENTRIES";
  } catch (error) {
    appState.userPlaceCount = 0;
    appState.statStatus =
      error instanceof Error ? error.message.toUpperCase() : "LOAD FAILURE";
  } finally {
    appState.isLoading = false;
  }
}
