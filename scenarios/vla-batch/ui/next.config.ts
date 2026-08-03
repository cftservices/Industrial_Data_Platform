import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // De runner-stage van de Dockerfile draait .next/standalone/server.js.
  output: "standalone",
  // Geen rewrites: de /api-proxy is een route handler, want daar blijven de
  // TDengine-credentials en de foutnormalisatie. Een rewrite zou beide omzeilen.
  reactStrictMode: true,
  // Geen enkele afbeelding in deze app: alle visuals zijn inline SVG uit de
  // Toolkit. Beeldoptimalisatie uitzetten haalt sharp/libvips uit het
  // runtime-pad, en dat is precies de afhankelijkheid met de CVE's.
  images: { unoptimized: true },
};

export default nextConfig;
