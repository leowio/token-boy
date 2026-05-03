import "./styles.css";

import { createApp, reactive } from "petite-vue";

import { installBootScreen } from "./boot-screen";
import { buildCameraPageHref, navigatePageTabs, pages } from "./page-config";
import { hasPendingPlacePhoto } from "./place-photo";
import {
  InsufficientTokensError,
  fetchUserTokenStats,
  spendUserTokens,
} from "./place-utils";
import { installTokenBoyNotifier } from "./token-boy-notifier";
import { getOrCreateUserProfile } from "./user-profile";

const activePage = "stat" as const;
const profile = getOrCreateUserProfile();

const SPEECH_FULL_TEXT = "Click on me to ask any questions";
const SPEECH_TYPE_INTERVAL_MS = 55;
const ORACLE_COST = 20;
const ORACLE_ANSWERS = [
  "It is decidedly so.",
  "Without a doubt.",
  "Yes, definitely.",
  "You may rely on it.",
  "Signs point to yes.",
  "Outlook good.",
  "Most likely.",
  "Reply hazy, try again.",
  "Ask again later.",
  "Better not tell you now.",
  "Cannot predict now.",
  "Concentrate and ask again.",
  "Don't count on it.",
  "My reply is no.",
  "My sources say no.",
  "Outlook not so good.",
  "Very doubtful.",
  "Absolutely, but only on a Tuesday.",
  "The vault says: maybe.",
  "Token Boy is laughing at you.",
  "Yes, but at a terrible cost.",
  "The radiation hides the answer.",
];

function pickRandomAnswer() {
  const index = Math.floor(Math.random() * ORACLE_ANSWERS.length);
  return ORACLE_ANSWERS[index] ?? "Ask again later.";
}

const appState = reactive({
  activePage,
  cameraHref: buildCameraPageHref(),
  hasPendingPhoto: hasPendingPlacePhoto(),
  isLoading: true,
  userPlaceCount: 0,
  userTokenBalance: 0,
  pages,
  speechFullText: SPEECH_FULL_TEXT,
  speechText: "",
  speechDone: false,
  ORACLE_COST,
  isOracleOpen: false,
  isOracleSubmitting: false,
  oracleQuestion: "",
  oracleAnswer: "",
  oracleError: "",
  onTabKeydown(event: KeyboardEvent) {
    navigatePageTabs(activePage, event);
  },
  openOracle() {
    appState.isOracleOpen = true;
    appState.oracleError = "";
    document.body.style.overflow = "hidden";
  },
  closeOracle() {
    appState.isOracleOpen = false;
    appState.isOracleSubmitting = false;
    appState.oracleQuestion = "";
    appState.oracleAnswer = "";
    appState.oracleError = "";
    document.body.style.overflow = "";
  },
  resetOracle() {
    appState.oracleQuestion = "";
    appState.oracleAnswer = "";
    appState.oracleError = "";
  },
  onOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      appState.closeOracle();
    }
  },
  async submitOracleQuestion() {
    const question = appState.oracleQuestion.trim();
    if (!question || appState.isOracleSubmitting || appState.oracleAnswer) {
      return;
    }

    appState.isOracleSubmitting = true;
    appState.oracleError = "";

    try {
      const { tokens } = await spendUserTokens(profile.userId, ORACLE_COST);
      appState.userTokenBalance = tokens;
      await new Promise((resolve) => setTimeout(resolve, 650));
      appState.oracleAnswer = pickRandomAnswer();
    } catch (error) {
      if (error instanceof InsufficientTokensError) {
        appState.oracleError = `NOT ENOUGH TOKENS! You need ${ORACLE_COST}.`;
      } else {
        appState.oracleError = "The spirits are unreachable. Try again.";
      }
    } finally {
      appState.isOracleSubmitting = false;
    }
  },
});

createApp(appState).mount("#app");
installBootScreen();
installTokenBoyNotifier();
void loadUserTokenBalance();
startSpeechTyping();

function startSpeechTyping() {
  let index = 0;
  const tick = () => {
    index += 1;
    appState.speechText = SPEECH_FULL_TEXT.slice(0, index);
    if (index >= SPEECH_FULL_TEXT.length) {
      appState.speechDone = true;
      return;
    }
    window.setTimeout(tick, SPEECH_TYPE_INTERVAL_MS);
  };
  window.setTimeout(tick, 400);
}

async function loadUserTokenBalance() {
  appState.isLoading = true;

  try {
    const stats = await fetchUserTokenStats(profile.userId);
    appState.userPlaceCount = stats.placeCount;
    appState.userTokenBalance = stats.tokens;
  } catch (error) {
    appState.userPlaceCount = 0;
    appState.userTokenBalance = 0;
  } finally {
    appState.isLoading = false;
  }
}
