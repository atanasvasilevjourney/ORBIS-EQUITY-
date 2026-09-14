/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@luxalgo/vela",
    "@zag-js/core",
    "@zag-js/dialog",
    "@zag-js/dom-query",
    "@zag-js/menu",
    "@zag-js/tooltip",
    "@zag-js/types",
    "@zag-js/vanilla",
  ],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        ...(process.env.ALLOWED_ORIGIN ? [process.env.ALLOWED_ORIGIN] : []),
      ],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};
export default nextConfig;
