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
      {
        source: "/api/v1/:path*",
        destination: `${apiBase}/:path*`,
      },
    ];
  },
};

export default nextConfig;
