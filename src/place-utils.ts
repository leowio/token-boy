import type { Place } from "../shared/socket-events";

const apiBaseUrl =
  import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || "";

export async function fetchPlaces() {
  const response = await fetch(`${apiBaseUrl}/api/places`);
  if (!response.ok) {
    throw new Error("Failed to load places");
  }

  const payload = (await response.json()) as { places?: Place[] };
  return payload.places ?? [];
}

export function getPlaceDetailHref(placeId: string) {
  return `/data-detail.html?id=${encodeURIComponent(placeId)}`;
}

export function formatPlaceTimestamp(createdAt: number) {
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}.${month}.${day} ${hours}:${minutes}`;
}

export function formatPlaceCoords(latitude: number, longitude: number) {
  return `${latitude.toFixed(4)} / ${longitude.toFixed(4)}`;
}

export function summarizeDescription(description: string) {
  const value = description.trim();
  if (!value) {
    return "NO DESCRIPTION";
  }

  return value.length > 64 ? `${value.slice(0, 61)}...` : value;
}
