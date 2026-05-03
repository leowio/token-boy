export function getPublicBasePath() {
  const pathname = window.location.pathname;
  const lastSlashIndex = pathname.lastIndexOf("/");
  return pathname.slice(0, lastSlashIndex + 1) || "/";
}

export function getPublicUrl(path: string) {
  return `${getPublicBasePath()}${path.replace(/^\/+/, "")}`;
}

export function getRelativeUrl(path: string) {
  return path.replace(/^\/+/, "");
}

export function joinUrl(baseUrl: string, path: string) {
  const relativePath = getRelativeUrl(path);
  if (!baseUrl) {
    return relativePath;
  }

  return `${baseUrl.replace(/\/+$/, "")}/${relativePath}`;
}
