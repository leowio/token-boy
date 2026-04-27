import express from "express";
import http from "node:http";
import path from "node:path";
import { Server } from "socket.io";
import type {
  ChatMessage,
  ClientToServerEvents,
  PlaceInput,
  ServerToClientEvents,
  SketchEvent,
} from "../shared/socket-events.js";
import { createPlace, getPlacesCount, getUploadsDirectoryPath, listPlaces } from "./place-store.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const clientOrigins = process.env.CLIENT_ORIGIN?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean) ?? ["http://localhost:5173", "http://127.0.0.1:5173"];

const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: clientOrigins,
  },
});

app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin && clientOrigins.includes(origin)) {
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

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    places: getPlacesCount(),
    sockets: io.of("/").sockets.size,
    uptime: process.uptime(),
  });
});

app.get("/api/places", (request, response) => {
  const userId = typeof request.query.userId === "string" ? request.query.userId.trim() : "";
  const places = listPlaces();

  response.json({
    places: userId ? places.filter((place) => place.userId === userId) : places,
  });
});

app.post("/api/places", (request, response) => {
  const payload = request.body as Partial<PlaceInput>;

  try {
    const place = createPlace({
      photo: typeof payload.photo === "string" ? payload.photo : null,
      title: typeof payload.title === "string" ? payload.title : "",
      description: typeof payload.description === "string" ? payload.description : "",
      latitude: Number(payload.latitude),
      longitude: Number(payload.longitude),
      userId: typeof payload.userId === "string" ? payload.userId : "",
    });

    io.emit("placeCreated", place);
    response.status(201).json({ place });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Invalid place payload",
    });
  }
});

const clientDist = path.resolve(process.cwd(), "dist");
app.use("/uploads", express.static(getUploadsDirectoryPath()));
app.use(express.static(clientDist));
app.use((request, response, next) => {
  if (request.method === "GET" && request.accepts("html")) {
    response.sendFile(path.join(clientDist, "index.html"));
    return;
  }

  next();
});

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
      const place = createPlace({
        ...input,
        userId: input.userId.trim() || socket.id,
      });

      io.emit("placeCreated", place);
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
  console.log(`Socket.IO server listening on http://localhost:${port}`);
});
