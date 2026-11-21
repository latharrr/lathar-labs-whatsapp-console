import { defineConfig } from "vitest/config";

const TEST_DB = "postgresql://ll:ll_local_only@127.0.0.1:5432/ll_dashboard_test";
export default defineConfig({
  test: {
    globalSetup: "./test/global-setup.ts",
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DB,
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      NODE_ENV: "test",
      MEDIA_DIR: "../.data/test-media",
      GRAPH_BASE: "https://graph.test.invalid",
      META_APP_SECRET: "fixture_app_secret_local_only",
    },
  },
});
