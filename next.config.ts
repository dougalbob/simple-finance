import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Simple Finance sits behind Cloudflare Access; keep responses quiet and lean.
  poweredByHeader: false,
};

export default nextConfig;
