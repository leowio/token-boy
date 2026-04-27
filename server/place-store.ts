import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { Place, PlaceInput } from "../shared/socket-events.js";

type PlaceRow = {
  id: string;
  user_id: string;
  photo: string | null;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  created_at: number;
};

const dataDir = path.resolve(process.cwd(), "data");
const databasePath = path.join(dataDir, "token-boy.sqlite");
const publicDir = path.resolve(process.cwd(), "public");
const uploadsDir = path.join(publicDir, "uploads");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const database = new DatabaseSync(databasePath);

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    photo TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_places_user_id ON places(user_id);
  CREATE INDEX IF NOT EXISTS idx_places_created_at ON places(created_at DESC);
`);

export function listPlaces() {
  return (
    database
      .prepare(`
        SELECT id, user_id, photo, title, description, latitude, longitude, created_at
        FROM places
        ORDER BY created_at DESC
      `)
      .all() as PlaceRow[]
  ).map(mapRowToPlace);
}

export function createPlace(input: PlaceInput) {
  const now = Date.now();
  const place: Place = {
    id: randomUUID(),
    userId: sanitizeUserId(input.userId),
    photo: sanitizePhoto(input.photo),
    title: sanitizeTitle(input.title),
    description: sanitizeDescription(input.description),
    latitude: sanitizeLatitude(input.latitude),
    longitude: sanitizeLongitude(input.longitude),
    createdAt: now,
  };

  database
    .prepare(`
    INSERT INTO places (
      id,
      user_id,
      photo,
      title,
      description,
      latitude,
      longitude,
      created_at
    ) VALUES (
      :id,
      :user_id,
      :photo,
      :title,
      :description,
      :latitude,
      :longitude,
      :created_at
    )
  `)
    .run({
      id: place.id,
      user_id: place.userId,
      photo: place.photo,
      title: place.title,
      description: place.description,
      latitude: place.latitude,
      longitude: place.longitude,
      created_at: place.createdAt,
    });

  return place;
}

export function getPlacesCount() {
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM places
    `)
    .get() as { count: number } | undefined;
  return row?.count ?? 0;
}

export function getPlacesDatabasePath() {
  return databasePath;
}

export function getUploadsDirectoryPath() {
  return uploadsDir;
}

function mapRowToPlace(row: PlaceRow): Place {
  return {
    id: row.id,
    userId: row.user_id,
    photo: row.photo,
    title: row.title,
    description: row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    createdAt: row.created_at,
  };
}

function sanitizeUserId(userId: string) {
  const value = userId.trim().slice(0, 64);

  if (!value) {
    throw new Error("userId is required");
  }

  return value;
}

function sanitizePhoto(photo: string | null) {
  if (photo === null) {
    return null;
  }

  const value = photo.trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("data:")) {
    return storePhotoDataUrl(value);
  }

  return value.slice(0, 512);
}

function sanitizeTitle(title: string) {
  const value = title.trim().slice(0, 80);
  return value || "UNTITLED PLACE";
}

function sanitizeDescription(description: string) {
  return description.trim().slice(0, 800);
}

function sanitizeLatitude(latitude: number) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("latitude must be a finite number between -90 and 90");
  }

  return latitude;
}

function sanitizeLongitude(longitude: number) {
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("longitude must be a finite number between -180 and 180");
  }

  return longitude;
}

function storePhotoDataUrl(photo: string) {
  const match = photo.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error("photo must be a valid image data URL");
  }

  const [, mimeType, encoded] = match;
  const extension = getPhotoExtension(mimeType);
  const buffer = Buffer.from(encoded, "base64");

  if (buffer.byteLength === 0) {
    throw new Error("photo payload is empty");
  }

  if (buffer.byteLength > 3_500_000) {
    throw new Error("photo payload is too large");
  }

  const filename = `${randomUUID()}.${extension}`;
  const absolutePath = path.join(uploadsDir, filename);
  fs.writeFileSync(absolutePath, buffer);

  return `/uploads/${filename}`;
}

function getPhotoExtension(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      throw new Error("unsupported photo type");
  }
}
