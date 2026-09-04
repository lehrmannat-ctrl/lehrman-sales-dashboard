/** @type {import('next').NextConfig} */

// Next.js Server Actions check the request's Origin header against this list
// as a CSRF guard. "localhost:3000" only works for local dev — a production
// deploy on Vercel needs its own domain(s) added here too, or every Server
// Action (i.e. most of the mutations in this app) fails in production with
// "Invalid Server Actions request". Vercel sets these env vars automatically
// on every deployment, so this stays correct without editing it again:
//   VERCEL_PROJECT_PRODUCTION_URL -> the stable production domain
//   VERCEL_URL                   -> the current deployment's own URL (previews too)
const allowedOrigins = [
  "localhost:3000",
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
  process.env.VERCEL_URL,
  // A custom domain pointed at this project (set NEXT_PUBLIC_APP_URL to it,
  // e.g. https://dashboard.lehrmanmobiledetail.com) also needs to be here.
  process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, ""),
].filter(Boolean);

const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins,
    },
  },
};

export default nextConfig;
