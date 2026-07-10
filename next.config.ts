import type { NextConfig } from "next";

// 전 응답 공통 보안 헤더. 앱 렌더링을 깨지 않는 안전한 항목 위주.
// (스크립트까지 제한하는 완전한 CSP는 nonce 도입 후 별도 강화 — 아래 default-src는 클릭재킹·object 삽입 차단 목적)
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
