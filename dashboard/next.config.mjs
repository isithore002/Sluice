/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the dashboard is a client-side page reading public RPCs, hostable anywhere.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
};

export default nextConfig;
