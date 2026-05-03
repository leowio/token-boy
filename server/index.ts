import "dotenv/config";

import express from "express";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { Server } from "socket.io";
import type {
  ChatMessage,
  ClientToServerEvents,
  PlaceInput,
  ServerToClientEvents,
  SketchEvent,
} from "../shared/socket-events.js";
import {
  createPlace,
  getPlacesCount,
  getUserTokenStats,
  getUploadsDirectoryPath,
  listPlaces,
  spendUserTokens,
} from "./place-store.js";

const port = Number.parseInt(process.env.PORT ?? "4210", 10);
const isProduction = process.env.NODE_ENV === "production";
const useHttps = !isProduction && process.env.HTTPS !== "false";
const projectRoot = process.cwd();
const htmlEntryPoints = new Set([
  "index.html",
  "data.html",
  "data-detail.html",
  "map.html",
  "camera.html",
]);
const clientOrigins = process.env.CLIENT_ORIGIN?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean) ?? ["http://localhost:5173", "http://127.0.0.1:5173"];
const allowAnyClientOrigin = clientOrigins.includes("*");
const clientOriginSet = new Set(clientOrigins);

const app = express();
const server: http.Server | https.Server = await createHttpServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin(origin, callback) {
      callback(null, isAllowedClientOrigin(origin));
    },
  },
});

async function createHttpServer() {
  if (!useHttps) {
    return http.createServer(app);
  }

  const { getCertificate } = await import("@vitejs/plugin-basic-ssl");
  const cert = await getCertificate(
    path.join(projectRoot, "node_modules/.vite/basic-ssl"),
  );
  return https.createServer({ cert, key: cert }, app);
}

app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin && isAllowedClientOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }

  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json({ limit: "5mb" }));

function isAllowedClientOrigin(origin: string | undefined) {
  if (!origin) {
    return true;
  }

  if (allowAnyClientOrigin || clientOriginSet.has(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    const allowedDevPorts = new Set(["5173", String(port)]);
    return allowedDevPorts.has(url.port) && isLocalDevHost(url.hostname);
  } catch {
    return false;
  }
}

function isLocalDevHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    isPrivateIpv4(hostname)
  );
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    places: getPlacesCount(),
    sockets: io.of("/").sockets.size,
    uptime: process.uptime(),
  });
});

app.get("/api/places", (request, response) => {
  const userId =
    typeof request.query.userId === "string" ? request.query.userId.trim() : "";
  const places = listPlaces();

  response.json({
    places: userId ? places.filter((place) => place.userId === userId) : places,
  });
});

app.post("/api/places", (request, response) => {
  const payload = request.body as Partial<PlaceInput>;

  try {
    const result = createPlace({
      photo: typeof payload.photo === "string" ? payload.photo : null,
      title: typeof payload.title === "string" ? payload.title : "",
      description:
        typeof payload.description === "string" ? payload.description : "",
      latitude: Number(payload.latitude),
      longitude: Number(payload.longitude),
      userId: typeof payload.userId === "string" ? payload.userId : "",
    });

    io.emit("placeCreated", result.place);
    response.status(201).json(result);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Invalid place payload",
    });
  }
});

app.get("/api/users/:userId/stats", (request, response) => {
  const userId = request.params.userId.trim();
  try {
    response.json(getUserTokenStats(userId));
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Invalid user id",
    });
  }
});

app.post("/api/users/:userId/spend-tokens", (request, response) => {
  const userId = request.params.userId.trim();
  const amount = Number((request.body as { amount?: unknown })?.amount);

  try {
    const tokens = spendUserTokens(userId, amount);
    response.json({ tokens });
  } catch (error) {
    const code = (error as Error & { code?: string }).code;
    if (code === "INSUFFICIENT_TOKENS") {
      response.status(402).json({ error: "insufficient tokens" });
      return;
    }

    response.status(400).json({
      error: error instanceof Error ? error.message : "Invalid spend request",
    });
  }
});

app.use("/uploads", express.static(getUploadsDirectoryPath()));

await setupClientServing();

async function setupClientServing() {
  if (isProduction) {
    setupProductionStatic();
    return;
  }

  await setupViteMiddleware();
}

function setupProductionStatic() {
  const clientDist = path.resolve(projectRoot, "dist");
  app.use(express.static(clientDist));
  app.use((request, response, next) => {
    if (request.method === "GET" && request.accepts("html")) {
      response.sendFile(path.join(clientDist, "index.html"));
      return;
    }

    next();
  });
}

async function setupViteMiddleware() {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: projectRoot,
    appType: "custom",
    server: {
      middlewareMode: true,
      hmr: { server },
    },
  });

  app.use(vite.middlewares);

  app.use(async (request, response, next) => {
    if (request.method !== "GET" || !request.accepts("html")) {
      next();
      return;
    }

    try {
      const requestedPath = request.path.replace(/^\/+/, "");
      const candidate = requestedPath || "index.html";
      const entry = htmlEntryPoints.has(candidate) ? candidate : "index.html";
      const templatePath = path.join(projectRoot, entry);
      const rawTemplate = await fs.promises.readFile(templatePath, "utf-8");
      const html = await vite.transformIndexHtml(request.originalUrl, rawTemplate);
      response.status(200).set("Content-Type", "text/html").end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
}

io.on("connection", (socket) => {
  io.emit("presence", io.of("/").sockets.size);
  socket.emit("allPlaces", listPlaces());

  socket.on("sketchEvent", (event) => {
    const sketchEvent: SketchEvent = {
      ...event,
      id: socket.id,
      createdAt: Date.now(),
    };

    socket.broadcast.emit("sketchEvent", sketchEvent);
  });

  socket.on("message", (message) => {
    const text = message.text.trim().slice(0, 160);
    if (!text) {
      return;
    }

    const chatMessage: ChatMessage = {
      id: `${socket.id}-${Date.now()}`,
      name: message.name.trim().slice(0, 24) || "Guest",
      text,
      color: message.color,
      createdAt: Date.now(),
    };

    io.emit("message", chatMessage);
  });

  socket.on("createPlace", (input) => {
    try {
      const result = createPlace({
        ...input,
        userId: input.userId.trim() || socket.id,
      });

      io.emit("placeCreated", result.place);
    } catch (error) {
      socket.emit("message", {
        id: `place-error-${Date.now()}`,
        name: "SYSTEM",
        text: error instanceof Error ? error.message : "Invalid place payload",
        color: "#f6d747",
        createdAt: Date.now(),
      });
    }
  });

  socket.on("disconnect", () => {
    io.emit("presence", io.of("/").sockets.size);
  });
});

server.listen(port, () => {
  const protocol = useHttps ? "https" : "http";
  console.log(`Token Boy server listening on ${protocol}://localhost:${port}`);
});
