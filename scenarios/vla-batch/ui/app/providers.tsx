"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Een falende refresh laat de laatst gerenderde inhoud staan.
            // Per-blok foutafhandeling: een fout in een tegel mag het scherm
            // niet leegmaken.
            retry: 1,
            refetchOnWindowFocus: true,
            staleTime: 0,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
