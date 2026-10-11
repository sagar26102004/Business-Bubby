import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // This folder is its own project inside the app's repo; without this, Next
  // sees the app's package-lock.json one level up and treats the repo as root.
  outputFileTracingRoot: path.join(__dirname),
  turbopack: { root: path.join(__dirname) },
  // Photos are plain <img> tags pointed at Cloudinary, which already resizes on
  // delivery (lib/media.ts) — so Next's own image optimizer is never used and
  // never billed.
  poweredByHeader: false,
  // The default (one worker per core) intermittently ran out of memory on the
  // dev machine; the site only prerenders a handful of pages, so two is plenty.
  experimental: { cpus: 2 },
};

export default nextConfig;
