const bootLines = [
  "[    0.000000] tokenboy kernel 0.1.0 initializing",
  "[    0.013337] calibrating pip display phosphor matrix",
  "[    0.042100] loading contribution ledger",
  "[    0.088204] mounting /vault/map read-only",
  "[    0.141009] scanning local archive sectors",
  "[    0.207701] camera device registered as /dev/entry0",
  "[    0.300118] gps beacon state: pending",
  "[    0.418887] starting token boy notifier daemon",
  "[    0.512230] user profile loaded",
  "[    0.620042] contribution protocol armed",
  "[    0.777777] boot complete",
];
const bootSeenSessionKey = "token-boy-boot-seen";

const tokenBoyAscii = String.raw`
 ______   ___   __  _    ___  ____       ____    ___   __ __ 
|      | /   \ |  |/ ]  /  _]|    \     |    \  /   \ |  |  |
|      ||     ||  ' /  /  [_ |  _  |    |  o  )|     ||  |  |
|_|  |_||  O  ||    \ |    _]|  |  |    |     ||  O  ||  ~  |
  |  |  |     ||     ||   [_ |  |  |    |  O  ||     ||___, |
  |  |  |     ||  .  ||     ||  |  |    |     ||     ||     |
  |__|   \___/ |__|\_||_____||__|__|    |_____| \___/ |____/
`;

let bootScreen: HTMLElement | null = null;

export function installBootScreen() {
  if (bootScreen || sessionStorage.getItem(bootSeenSessionKey)) {
    return;
  }

  sessionStorage.setItem(bootSeenSessionKey, "1");
  bootScreen = document.createElement("section");
  bootScreen.className = "boot-screen";
  bootScreen.setAttribute("aria-label", "Token Boy boot sequence");

  const consoleElement = document.createElement("div");
  consoleElement.className = "boot-console";

  const asciiElement = document.createElement("pre");
  asciiElement.className = "boot-ascii";
  asciiElement.textContent = tokenBoyAscii;

  const logElement = document.createElement("pre");
  logElement.className = "boot-log";

  consoleElement.append(asciiElement, logElement);
  bootScreen.append(consoleElement);
  document.body.append(bootScreen);

  let lineIndex = 0;
  const lineTimer = window.setInterval(() => {
    logElement.textContent += `${bootLines[lineIndex]}\n`;
    logElement.scrollTop = logElement.scrollHeight;
    lineIndex += 1;

    if (lineIndex >= bootLines.length) {
      window.clearInterval(lineTimer);
      window.setTimeout(() => {
        bootScreen?.classList.add("is-complete");
        window.setTimeout(() => {
          bootScreen?.remove();
          bootScreen = null;
        }, 360);
      }, 520);
    }
  }, 92);
}
