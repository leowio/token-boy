import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type {
  Place,
  PlaceCreationResult,
  PlaceInput,
  UserTokenStats,
} from "../shared/socket-events.js";

type PlaceRow = {
  id: string;
  user_id: string;
  photo: string | null;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  created_at: number;
  token_worth: number;
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
    created_at INTEGER NOT NULL,
    token_worth INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_places_user_id ON places(user_id);
  CREATE INDEX IF NOT EXISTS idx_places_created_at ON places(created_at DESC);

  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    tokens INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
`);

export function listPlaces() {
  return (
    database
      .prepare(
        `
        SELECT id, user_id, photo, title, description, latitude, longitude, created_at, token_worth
        FROM places
        ORDER BY created_at DESC
      `,
      )
      .all() as PlaceRow[]
  ).map(mapRowToPlace);
}

export function createPlace(input: PlaceInput) {
  const now = Date.now();
  const userId = sanitizeUserId(input.userId);
  const title = sanitizeTitle(input.title);
  const description = sanitizeDescription(input.description);
  const latitude = sanitizeLatitude(input.latitude);
  const longitude = sanitizeLongitude(input.longitude);
  const photo = sanitizePhoto(input.photo);
  const tokenWorth = calculateTokenWorth(description);
  const place: Place = {
    id: randomUUID(),
    userId,
    photo,
    title,
    description,
    latitude,
    longitude,
    createdAt: now,
    tokenWorth,
  };

  database
    .prepare(
      `
    INSERT INTO places (
      id,
      user_id,
      photo,
      title,
      description,
      latitude,
      longitude,
      created_at,
      token_worth
    ) VALUES (
      :id,
      :user_id,
      :photo,
      :title,
      :description,
      :latitude,
      :longitude,
      :created_at,
      :token_worth
    )
  `,
    )
    .run({
      id: place.id,
      user_id: place.userId,
      photo: place.photo,
      title: place.title,
      description: place.description,
      latitude: place.latitude,
      longitude: place.longitude,
      created_at: place.createdAt,
      token_worth: place.tokenWorth,
    });

  const tokenBalance = addUserTokens(place.userId, place.tokenWorth, now);

  return {
    place,
    tokenWorth: place.tokenWorth,
    tokenBalance,
  } satisfies PlaceCreationResult;
}

export function getPlacesCount() {
  const row = database
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM places
    `,
    )
    .get() as { count: number } | undefined;
  return row?.count ?? 0;
}

export function getPlacesDatabasePath() {
  return databasePath;
}

export function getUserTokenStats(userId: string): UserTokenStats {
  const normalizedUserId = sanitizeUserId(userId);
  const row = database
    .prepare(
      `
      SELECT tokens
      FROM users
      WHERE user_id = :user_id
    `,
    )
    .get({ user_id: normalizedUserId }) as { tokens: number } | undefined;

  const tokens = row?.tokens ?? 0;
  const placeCountRow = database
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM places
      WHERE user_id = :user_id
    `,
    )
    .get({ user_id: normalizedUserId }) as { count: number } | undefined;

  return {
    userId: normalizedUserId,
    tokens,
    placeCount: placeCountRow?.count ?? 0,
  };
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
    tokenWorth: row.token_worth,
  };
}

function calculateTokenWorth(description: string) {
  const text = description.trim();
  return 25 + Math.ceil(text.length / 40);
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
  const match = photo.match(
    /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/,
  );
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

export function spendUserTokens(userId: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive number");
  }

  const normalizedUserId = sanitizeUserId(userId);
  const current = getUserTokenStats(normalizedUserId);

  if (current.tokens < amount) {
    const error = new Error("insufficient tokens");
    (error as Error & { code?: string }).code = "INSUFFICIENT_TOKENS";
    throw error;
  }

  const nextTokens = current.tokens - amount;
  database
    .prepare(
      `
      INSERT INTO users (user_id, tokens, updated_at)
      VALUES (:user_id, :tokens, :updated_at)
      ON CONFLICT(user_id) DO UPDATE SET
        tokens = excluded.tokens,
        updated_at = excluded.updated_at
    `,
    )
    .run({
      user_id: normalizedUserId,
      tokens: nextTokens,
      updated_at: Date.now(),
    });

  return nextTokens;
}

function addUserTokens(userId: string, tokens: number, updatedAt: number) {
  const current = getUserTokenStats(userId);
  const nextTokens = current.tokens + tokens;

  database
    .prepare(
      `
      INSERT INTO users (user_id, tokens, updated_at)
      VALUES (:user_id, :tokens, :updated_at)
      ON CONFLICT(user_id) DO UPDATE SET
        tokens = excluded.tokens,
        updated_at = excluded.updated_at
    `,
    )
    .run({
      user_id: userId,
      tokens: nextTokens,
      updated_at: updatedAt,
    });

  return nextTokens;
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
