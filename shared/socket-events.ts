export type BrushEventInput = {
  type: "brush";
  x: number;
  y: number;
  hue: number;
  radius: number;
};

export type ClearEventInput = {
  type: "clear";
};

export type SketchEventInput = BrushEventInput | ClearEventInput;

export type SketchEvent = SketchEventInput & {
  id: string;
  createdAt: number;
};

export type ChatMessageInput = {
  name: string;
  text: string;
  color: string;
};

export type ChatMessage = ChatMessageInput & {
  id: string;
  createdAt: number;
};

export type MapPinInput = {
  lat: number;
  lng: number;
  userId: string;
  username: string;
  userHue: number;
};

export type MapPin = MapPinInput & {
  id: string;
  createdAt: number;
};

export interface ServerToClientEvents {
  message: (message: ChatMessage) => void;
  presence: (online: number) => void;
  sketchEvent: (event: SketchEvent) => void;
  allMapPins: (pins: MapPin[]) => void;
  mapPin: (pin: MapPin) => void;
}

export interface ClientToServerEvents {
  message: (message: ChatMessageInput) => void;
  sketchEvent: (event: SketchEventInput) => void;
  mapPin: (pin: MapPinInput) => void;
}
