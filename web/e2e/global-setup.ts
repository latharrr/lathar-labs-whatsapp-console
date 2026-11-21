import { execSync } from "node:child_process";
import { join } from "node:path";

/** Loads idempotent, clearly labelled e2e fixtures into the local database (see db/src/e2e-fixtures.ts). */
export default function () {
  execSync("npx tsx --env-file=../.env src/e2e-fixtures.ts", { cwd: join(__dirname, "..", "..", "db"), stdio: "inherit" });
}
