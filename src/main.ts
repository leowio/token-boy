import "./styles.css";

import { createApp } from "petite-vue";
import P5 from "p5";
import { io, type Socket } from "socket.io-client";
import type {
  ChatMessage,
  ClientToServerEvents,
  ServerToClientEvents,
  SketchEvent,
} from "../shared/socket-events";

const socketUrl =
  import.meta.env.VITE_SOCKET_URL ??
  `${window.location.protocol}//${window.location.hostname}:3000`;

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketUrl);

type SketchApi = {
  clear: () => void;
  paintRemote: (event: SketchEvent) => void;
};

type AppState = {
  connected: boolean;
  peers: number;
  hue: number;
  radius: number;
  name: string;
  draftMessage: string;
  messages: ChatMessage[];
  swatches: number[];
  readonly statusText: string;
  setHue: (hue: number) => void;
  clearCanvas: () => void;
  sendMessage: () => void;
};

let sketchApi: SketchApi | null = null;

const appState: AppState = {
  connected: false,
  peers: 0,
  hue: 192,
  radius: 24,
  name: `Guest ${Math.floor(100 + Math.random() * 900)}`,
  draftMessage: "",
  messages: [],
  swatches: [8, 38, 122, 192, 268, 324],
  get statusText() {
    return this.connected ? "Connected" : "Connecting";
  },
  setHue(hue: number) {
    appState.hue = hue;
  },
  clearCanvas() {
    sketchApi?.clear();
    socket.emit("sketchEvent", { type: "clear" });
  },
  sendMessage() {
    const text = appState.draftMessage.trim();
    if (!text) {
      return;
    }

    socket.emit("message", {
      name: appState.name,
      text,
      color: `hsl(${appState.hue}, 76%, 48%)`,
    });
    appState.draftMessage = "";
  },
};

createApp(appState).mount("#app");

socket.on("connect", () => {
  appState.connected = true;
});

socket.on("disconnect", () => {
  appState.connected = false;
});

socket.on("presence", (online) => {
  appState.peers = online;
});

socket.on("message", (message) => {
  appState.messages.unshift(message);
  appState.messages = appState.messages.slice(0, 12);
});

socket.on("sketchEvent", (event) => {
  sketchApi?.paintRemote(event);
});

const createSketch = () => {
  const sketch = (p: P5) => {
    let layer: P5.Graphics;
    const remotes = new Map<
      string,
      { x: number; y: number; hue: number; radius: number; age: number }
    >();

    const paint = (x: number, y: number, hue: number, radius: number) => {
      layer.noStroke();
      for (let i = 0; i < 4; i += 1) {
        const drift = i * 1.8;
        layer.fill((hue + i * 10) % 360, 76, 92, 0.16);
        layer.circle(
          x + p.random(-drift, drift),
          y + p.random(-drift, drift),
          radius * (1 - i * 0.11),
        );
      }
    };

    const isInsideCanvas = () =>
      p.mouseX >= 0 && p.mouseX <= p.width && p.mouseY >= 0 && p.mouseY <= p.height;

    const emitBrush = () => {
      if (!appState.connected || !isInsideCanvas()) {
        return;
      }

      const radius = Number(appState.radius);
      const hue = Number(appState.hue);
      paint(p.mouseX, p.mouseY, hue, radius);
      socket.emit("sketchEvent", {
        type: "brush",
        x: p.mouseX / p.width,
        y: p.mouseY / p.height,
        hue,
        radius,
      });
    };

    const resetLayer = () => {
      layer.clear();
      layer.background(210, 16, 97, 0.96);
    };

    p.setup = () => {
      const host = document.getElementById("p5-canvas");
      const width = host?.clientWidth ?? 960;
      const height = host?.clientHeight ?? 640;
      const canvas = p.createCanvas(width, height);
      canvas.parent("p5-canvas");
      canvas.elt.setAttribute("aria-label", "Collaborative p5 drawing canvas");

      p.colorMode(p.HSB, 360, 100, 100, 1);
      layer = p.createGraphics(width, height);
      layer.colorMode(p.HSB, 360, 100, 100, 1);
      resetLayer();

      sketchApi = {
        clear: resetLayer,
        paintRemote(event) {
          if (event.type === "clear") {
            resetLayer();
            return;
          }

          const x = event.x * p.width;
          const y = event.y * p.height;
          paint(x, y, event.hue, event.radius);
          remotes.set(event.id, { x, y, hue: event.hue, radius: event.radius, age: 0 });
        },
      };
    };

    p.draw = () => {
      p.background(218, 24, 12);
      p.image(layer, 0, 0);

      remotes.forEach((remote, id) => {
        remote.age += 1;
        const alpha = Math.max(0, 1 - remote.age / 45);
        p.noFill();
        p.stroke(remote.hue, 90, 96, alpha);
        p.strokeWeight(2);
        p.circle(remote.x, remote.y, remote.radius + remote.age * 0.35);

        if (remote.age > 45) {
          remotes.delete(id);
        }
      });
    };

    p.mouseDragged = emitBrush;
    p.mousePressed = emitBrush;
    const touchSketch = p as P5 & { touchMoved: () => boolean };
    touchSketch.touchMoved = () => {
      emitBrush();
      return false;
    };

    p.windowResized = () => {
      const host = document.getElementById("p5-canvas");
      if (!host) {
        return;
      }

      const snapshot = layer.get();
      p.resizeCanvas(host.clientWidth, host.clientHeight);
      const nextLayer = p.createGraphics(host.clientWidth, host.clientHeight);
      nextLayer.colorMode(p.HSB, 360, 100, 100, 1);
      nextLayer.background(210, 16, 97, 0.96);
      nextLayer.image(snapshot, 0, 0, nextLayer.width, nextLayer.height);
      layer = nextLayer;
    };
  };

  return new P5(sketch);
};

createSketch();
