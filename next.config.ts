import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Allow phones on the local network to load the app without HMR errors
  // HMR is dev-only and not needed on audience phones
  experimental: {
    // Turbopack HMR websocket — point to the actual server IP
    // Read from env so you only need to update .env.local
  },
};

// Suppress HMR WebSocket errors on remote devices by disabling
// the webpack-hmr endpoint for non-localhost connections.
// The app still works fine — HMR just won't hot-reload on phones (which is fine).
if (process.env.NEXT_PUBLIC_APP_URL) {
  const url = new URL(process.env.NEXT_PUBLIC_APP_URL);
  (nextConfig as any).webpackDevMiddleware = undefined;
  // Tell Next.js the public hostname so HMR connects correctly
  process.env.__NEXT_PRIVATE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL;
}

export default nextConfig;
