import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // react-grid-layout -> react-draggable cita process.env.NODE_ENV; u browseru
  // `process` ne postoji pa onMouseDown puca (drag/resize ne rade). Zameni token.
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
}));
