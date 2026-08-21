import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This web app lives inside the backend repo (izlan/web); pin file tracing to this dir so the parent lockfile
  // is not mistaken for the workspace root.
  outputFileTracingRoot: here,
  // The CMS is a pure API client of the Izlan backend; it ships no server secrets and does no SSR data fetching.
  eslint: {
    // Lint is run explicitly via `npm run lint` in CI; do not fail the production build on lint.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
