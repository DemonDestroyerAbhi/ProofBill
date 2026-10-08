import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@proofbill/core", "@proofbill/db", "@proofbill/ai", "@proofbill/paypal", "@proofbill/services"],
  serverExternalPackages: ["postgres", "unpdf", "mammoth"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};

export default config;
