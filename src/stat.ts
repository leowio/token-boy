import "./styles.css";

import { createApp, reactive } from "petite-vue";

import { footerMetersByPage, navigatePageTabs, pages, subtabsByPage } from "./page-config";
import { createSubtabNav } from "./subtabs";

const activePage = "stat" as const;
const footer = footerMetersByPage[activePage];
const subtabNav = createSubtabNav({
  subtabs: subtabsByPage[activePage],
});

const appState = reactive({
  activePage,
  ...subtabNav,
  footerLeft: footer[0],
  footerCenter: footer[1],
  footerRight: footer[2],
  pages,
  onTabKeydown(event: KeyboardEvent) {
    navigatePageTabs(activePage, event);
  },
});

createApp(appState).mount("#app");
