import "./styles.css";

import { createApp, reactive } from "petite-vue";

import { footerMetersByPage, navigatePageTabs, pages, subtabsByPage } from "./page-config";

const activePage = "stat" as const;
const footer = footerMetersByPage[activePage];

const appState = reactive({
  activePage,
  activeSubtabs: subtabsByPage[activePage],
  footerLeft: footer[0],
  footerCenter: footer[1],
  footerRight: footer[2],
  pages,
  onTabKeydown(event: KeyboardEvent) {
    navigatePageTabs(activePage, event);
  },
});

createApp(appState).mount("#app");
