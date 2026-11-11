import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A stray lockfile higher up the folder tree confuses Next's root detection; pin it here.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
