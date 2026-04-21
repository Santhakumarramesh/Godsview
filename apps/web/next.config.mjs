/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@gv/ui", "@gv/api-client", "@gv/types", "@gv/config"],
  experimental: {
    // Phase 0: keep features conservative; turn on selectively in later phases.
    typedRoutes: true,
  },
  async rewrites() {
    const apiBase = process.env.GODSVIEW_CONTROL_PLANE_ORIGIN || "http://localhost:8000";
    return [
      // Proxy /api/* to FastAPI gateway (primary route used by all pages)
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
      // Proxy /health/* to gateway health endpoints
      {
        source: "/health/:path*",
        destination: `${apiBase}/health/:path*`,
      },
    ];
  },
};

export default nextConfig;
