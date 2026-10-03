import type { NextConfig } from "next";

// 每個回應都帶的安全標頭。
// CSP 只放不會弄壞 Next.js 的三條：不准別的網站用 iframe 嵌入（防點擊劫持）、不載入 plugin、<base> 不能被竄改。
// script-src 沒有收緊：Next.js 的 inline script 要靠 nonce 才能放行，得配合 middleware 另外做，列在 THREAT_MODEL 的待辦。
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
