import type { NextConfig } from "next";

/**
 * Güvenlik başlıkları — tüm rotalar için.
 * CSP: Tesseract.js dil verisi ve worker çekirdeği CDN'den geldiği için
 * tessdata.projectnaptha.com ve cdn.jsdelivr.net açık uçlar olarak listelendi;
 * worker/wasm blob: üzerinden çalışır. Next.js hidrasyon bootstrap'ı için
 * 'unsafe-inline' zorunludur.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://tessdata.projectnaptha.com https://cdn.jsdelivr.net",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // sharp yerel modüldür — route içinde sunucu tarafı görüntü küçültme için kullanılır
  serverExternalPackages: ["sharp"],
  poweredByHeader: false,
  reactStrictMode: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
