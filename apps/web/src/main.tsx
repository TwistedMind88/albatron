import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./styles.css";
import "./teme.css";
// bundlovani fontovi za teme (LAN rad bez interneta)
import "@fontsource-variable/space-grotesk"; // Grafit naslovi
import "@fontsource-variable/inter"; // Grafit tekst
import "@fontsource-variable/fraunces"; // Pergament naslovi
import "@fontsource-variable/instrument-sans"; // Pergament tekst
import "@fontsource/ibm-plex-sans/400.css"; // Kokpit tekst
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css"; // Kokpit brojevi/oznake
import "@fontsource/ibm-plex-mono/500.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
