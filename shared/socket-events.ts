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

export type PlaceInput = {
  photo: string | null;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  userId: string;
};

export type Place = PlaceInput & {
  id: string;
  createdAt: number;
  tokenWorth: number;
};

export type PlaceCreationResult = {
  place: Place;
  tokenWorth: number;
  tokenBalance: number;
};

export type UserTokenStats = {
  userId: string;
  tokens: number;
  placeCount: number;
};

export interface ServerToClientEvents {
  message: (message: ChatMessage) => void;
  presence: (online: number) => void;
  sketchEvent: (event: SketchEvent) => void;
  allPlaces: (places: Place[]) => void;
  placeCreated: (place: Place) => void;
}

export interface ClientToServerEvents {
  message: (message: ChatMessageInput) => void;
  sketchEvent: (event: SketchEventInput) => void;
  createPlace: (place: PlaceInput) => void;
}
