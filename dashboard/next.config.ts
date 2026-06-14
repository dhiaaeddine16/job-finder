import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // got-scraping / header-generator load JSON data files from disk using
  // dynamic paths — they must NOT be bundled by Turbopack. Mark them as
  // server-side external packages so Node.js require() resolves them
  // from node_modules at runtime.
  serverExternalPackages: [
    'got-scraping',
    'got',
    'header-generator',
    'browser-headers',
  ],
};

export default nextConfig;
