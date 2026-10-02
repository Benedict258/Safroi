import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["pg"],
  outputFileTracingRoot: import.meta.dirname,
};

export default config;
