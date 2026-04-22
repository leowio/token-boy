import express from "express";
import http from "node:http";
import path from "node:path";
import { Server } from "socket.io";
import type {
  ChatMessage,
  ClientToServerEvents,
  ServerToClientEvents,
  SketchEvent,
} from "../shared/socket-events.js";

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

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    sockets: io.of("/").sockets.size,
    uptime: process.uptime(),
  });
});

const clientDist = path.resolve(process.cwd(), "dist");
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

  socket.on("disconnect", () => {
    io.emit("presence", io.of("/").sockets.size);
  });
});

server.listen(port, () => {
  console.log(`Socket.IO server listening on http://localhost:${port}`);
});
