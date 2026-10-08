import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://proofbill:proofbill@localhost:5432/proofbill_test",
      PAYPAL_ENV: "mock",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      APP_URL: "http://localhost:3000",
      PAYER_EMAIL: "",
    },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
