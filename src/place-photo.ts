const pendingPlacePhotoStorageKey = "token-boy-pending-place-photo";

export function hasPendingPlacePhoto() {
  return readPendingPlacePhoto() !== null;
}

export function readPendingPlacePhoto() {
  try {
    return sessionStorage.getItem(pendingPlacePhotoStorageKey);
  } catch {
    return null;
  }
}

export function setPendingPlacePhoto(photo: string) {
  try {
    sessionStorage.setItem(pendingPlacePhotoStorageKey, photo);
  } catch {
    // Ignore storage write failures and keep the UI usable.
  }
}

export function clearPendingPlacePhoto() {
  try {
    sessionStorage.removeItem(pendingPlacePhotoStorageKey);
  } catch {
    // Ignore storage cleanup failures.
  }
}
