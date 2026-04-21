/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@gv/ui", "@gv/api-client", "@gv/types", "@gv/config"],
  experimental: {
    // Phase 0: keep features conservative; turn on selectively in later phases.
    typedRoutes: true,
  },
  async rewrites() {
    const apiBase = process.env.GODSVIEW_API_ORIGIN || "http://localhost:3001";
    const controlPlane = process.env.GODSVIEW_CONTROL_PLANE_ORIGIN || "http://localhost:8000";
    return [
      // Proxy /api/v1/* to the Node API server (primary trading backend)
      {
        source: "/api/v1/:path*",
        destination: `${apiBase}/api/:path*`,
      },
      // Proxy /api/v2/* to FastAPI control plane (admin, auth, flags)
      {
        source: "/api/v2/:path*",
        destination: `${controlPlane}/api/:path*`,
      },
      // Proxy /api/* fallback to Node API server
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
      // Proxy /health/* to Node API health endpoints
      {
        source: "/health/:path*",
        destination: `${apiBase}/health/:path*`,
      },
    ];
  },
};

export default nextConfig;
