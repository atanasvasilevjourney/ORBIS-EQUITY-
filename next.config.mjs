/** @type {import('next').NextConfig} */
const allowed = ["localhost:3000"];
if (process.env.ALLOWED_ORIGIN) allowed.push(process.env.ALLOWED_ORIGIN);

const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: allowed,
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
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
