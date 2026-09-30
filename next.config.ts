import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The system prompt and the schema are read from disk at runtime: ship them with every route on Vercel.
  outputFileTracingIncludes: {
    "/*": ["./lib/agent/system-prompt.md", "./db/schema.sql"],
  },
};

export default nextConfig;
