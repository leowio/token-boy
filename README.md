# Token Boy

A small TypeScript scaffold using:

- `petite-vue` for progressive HTML bindings
- `p5` for the collaborative drawing canvas
- Node, Express, and Socket.IO for realtime events
- Vite for frontend development and production bundling

## Run Locally

```sh
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` and connects to the Socket.IO backend on `http://localhost:3000`.

## Production Build

```sh
npm run build
npm start
```

The Node backend serves the built frontend from `dist`.

## Environment

Copy `.env.example` if you want to override defaults:

```sh
cp .env.example .env
```

- `PORT` controls the backend port.
- `CLIENT_ORIGIN` controls allowed Socket.IO CORS origins in development.
- `VITE_SOCKET_URL` points the frontend at a Socket.IO server.
