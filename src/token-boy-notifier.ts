import { getRelativeUrl } from "./app-url";

type TokenBoyNotifyEvent = CustomEvent<string>;

declare global {
  interface Window {
    tokenBoyNotify?: (message: string) => void;
  }
}

const typingIntervalMs = 28;
const visibleAfterTypingMs = 2600;
const firstRunStorageKey = "token-boy-onboarding-seen";
const firstRunMessages = [
  "Thank you for using token boy",
  "Click the camera button to log an entry",
  "We thank you for your contribution",
];

let root: HTMLElement | null = null;
let messageElement: HTMLElement | null = null;
let hideTimer: number | null = null;
let typingTimer: number | null = null;
let activeResolve: (() => void) | null = null;

export function installTokenBoyNotifier() {
  if (root) {
    return notifyTokenBoy;
  }

  root = document.createElement("aside");
  root.className = "token-boy-notifier";
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "true");

  const figure = document.createElement("img");
  figure.className = "token-boy-notifier-figure";
  figure.src = getRelativeUrl("/stat-boy.png");
  figure.width = 466;
  figure.height = 320;
  figure.alt = "";
  figure.setAttribute("aria-hidden", "true");

  const bubble = document.createElement("div");
  bubble.className = "token-boy-notifier-bubble";

  messageElement = document.createElement("p");
  bubble.append(messageElement);
  root.append(figure, bubble);
  document.body.append(root);

  window.tokenBoyNotify = notifyTokenBoy;
  window.addEventListener(
    "tokenboy:notify",
    handleNotifyEvent as EventListener,
  );
  queueFirstRunMessages();

  return notifyTokenBoy;
}

export function notifyTokenBoy(message: string) {
  if (!root || !messageElement) {
    installTokenBoyNotifier();
  }

  if (!root || !messageElement) {
    return;
  }

  const text = message.trim();
  if (!text) {
    return Promise.resolve();
  }

  clearNotifierTimers();
  messageElement.textContent = "";
  root.classList.add("is-visible");

  return new Promise<void>((resolve) => {
    activeResolve = resolve;
    let index = 0;
    typingTimer = window.setInterval(() => {
      if (!messageElement) {
        clearNotifierTimers();
        finishActiveNotification();
        return;
      }

      index += 1;
      messageElement.textContent = text.slice(0, index);
      if (index >= text.length) {
        if (typingTimer !== null) {
          window.clearInterval(typingTimer);
          typingTimer = null;
        }

        hideTimer = window.setTimeout(() => {
          root?.classList.remove("is-visible");
          finishActiveNotification();
        }, visibleAfterTypingMs);
      }
    }, typingIntervalMs);
  });
}

function handleNotifyEvent(event: TokenBoyNotifyEvent) {
  notifyTokenBoy(event.detail);
}

function queueFirstRunMessages() {
  if (localStorage.getItem(firstRunStorageKey)) {
    return;
  }

  localStorage.setItem(firstRunStorageKey, "1");
  window.setTimeout(async () => {
    for (const message of firstRunMessages) {
      await notifyTokenBoy(message);
    }
  }, 650);
}

function clearNotifierTimers() {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  if (typingTimer !== null) {
    window.clearInterval(typingTimer);
    typingTimer = null;
  }

  finishActiveNotification();
}

function finishActiveNotification() {
  activeResolve?.();
  activeResolve = null;
}
