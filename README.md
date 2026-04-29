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

The frontend runs on `https://localhost:5173` in local development and proxies backend requests to `http://localhost:3000`.

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
- Leave `VITE_BACKEND_URL` unset for local HTTPS dev so the frontend uses Vite's same-origin `/api` proxy.
- `VITE_BACKEND_URL` points the frontend and Vite dev proxy at a backend when you need direct cross-origin calls.
- `VITE_API_URL` can override the API base URL separately.
- `VITE_SOCKET_URL` can override the Socket.IO server separately.
