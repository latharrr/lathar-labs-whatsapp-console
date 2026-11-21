import { execSync } from "node:child_process";

export default function () {
  execSync("npx prisma migrate deploy", {
    cwd: new URL("../../db", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: "postgresql://ll:ll_local_only@127.0.0.1:5432/ll_dashboard_test" },
    stdio: "ignore",
  });
}
