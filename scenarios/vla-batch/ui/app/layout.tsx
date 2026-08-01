import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";

/**
 * Mobiel is hier geen bijzaak. NAMUR NE 190 (2023) gaat over werken met
 * mobiele apparaten in de procesomgeving, en voor een kleine zuivelfabriek
 * zonder controlekamer is een tablet het realistische bedieningsscenario.
 *
 * maximumScale bewust NIET beperkt: inzoomen moet kunnen, zeker met
 * handschoenen of bij slecht licht.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "DairyWorks Vla",
  description: "Operator- en managementschermen voor de vla-lijn",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
