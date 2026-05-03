export type PageId = "stat" | "data" | "map";

export type PageLink = {
  id: PageId;
  label: string;
  href: string;
};

export type FooterMeter = {
  label: string;
  value: string;
  percent: number;
};

export const cameraPageHref = "camera.html";
const cameraReturnParam = "returnTo";

export const pages: PageLink[] = [
  { id: "stat", label: "STAT", href: "./" },
  { id: "data", label: "DATA", href: "data.html" },
  { id: "map", label: "MAP", href: "map.html" },
];

export const subtabsByPage: Record<PageId, string[]> = {
  stat: ["STATUS", "SPECIAL", "PERKS"],
  data: ["ALL", "ME"],
  map: ["LOCAL", "WORLD"],
};

export const footerMetersByPage: Record<
  PageId,
  [FooterMeter, FooterMeter, FooterMeter]
> = {
  stat: [
    { label: "HP", value: "57/135", percent: 42 },
    { label: "LEVEL 6", value: "", percent: 82 },
    { label: "AP", value: "90/90", percent: 100 },
  ],
  data: [
    { label: "WT", value: "112/210", percent: 53 },
    { label: "CAPS", value: "", percent: 68 },
    { label: "DATA", value: "14/32", percent: 44 },
  ],
  map: [
    { label: "RAD", value: "003", percent: 8 },
    { label: "SIGNAL", value: "", percent: 76 },
    { label: "LOC", value: "07", percent: 70 },
  ],
};

export function navigatePageTabs(activePage: PageId, event: KeyboardEvent) {
  const activeIndex = pages.findIndex((page) => page.id === activePage);
  const lastIndex = pages.length - 1;
  let nextIndex = activeIndex;

  if (event.key === "ArrowRight") {
    nextIndex = activeIndex === lastIndex ? 0 : activeIndex + 1;
  } else if (event.key === "ArrowLeft") {
    nextIndex = activeIndex <= 0 ? lastIndex : activeIndex - 1;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = lastIndex;
  } else {
    return;
  }

  event.preventDefault();
  window.location.assign(pages[nextIndex].href);
}

export function buildCameraPageHref(returnHref = getCurrentPageHref()) {
  const params = new URLSearchParams();
  params.set(cameraReturnParam, returnHref);
  return `${cameraPageHref}?${params.toString()}`;
}

export function getCameraReturnHref() {
  const params = new URLSearchParams(window.location.search);
  const returnHref = params.get(cameraReturnParam);

  if (!returnHref || returnHref.startsWith("http")) {
    return pages.find((page) => page.id === "map")?.href ?? "/";
  }

  return returnHref;
}

function getCurrentPageHref() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
