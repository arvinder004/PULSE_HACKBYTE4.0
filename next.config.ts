import type { NextConfig } from "next";

const ALLOWED_ORIGINS = [
  'https://pulse.venoms.app',
  'http://localhost:3001',
  process.env.NEXT_PUBLIC_APP_URL,
].filter(Boolean) as string[];

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {},
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin',      value: ALLOWED_ORIGINS.join(', ') },
          { key: 'Access-Control-Allow-Methods',     value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers',     value: 'Content-Type, Authorization, X-API-Key' },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
        ],
      },
    ];
  },
};

// Tell Next.js the public hostname so HMR connects correctly on remote devices
if (process.env.NEXT_PUBLIC_APP_URL) {
  process.env.__NEXT_PRIVATE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL;
}

export default nextConfig;
