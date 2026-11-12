import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // sharp yerel modüldür — route içinde sunucu tarafı görüntü küçültme için kullanılır
  serverExternalPackages: ["sharp"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
