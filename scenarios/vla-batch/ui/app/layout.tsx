import type { Metadata, Viewport } from "next";
import { Nav } from "@/components/nav/Nav";
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
        <Providers>
          {/* De navigatie staat BUITEN de route-groups, zodat hij op elke route
              hangt en zijn eigen (neutrale) familie houdt. `min-w-0` op de
              inhoudskolom is niet optioneel: zonder dat duwt een brede tabel
              de flexkolom op en gaat de pagina alsnog horizontaal schuiven. */}
          <div className="lg:flex lg:min-h-screen">
            <Nav />
            <div className="min-w-0 lg:flex-1">{children}</div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
