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

// Tell Next.js the public hostname so HMR connects correctly on remote devices
if (process.env.NEXT_PUBLIC_APP_URL) {
  process.env.__NEXT_PRIVATE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL;
}

export default nextConfig;
