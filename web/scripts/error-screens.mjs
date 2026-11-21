// Error-state screenshots: briefly stops the LOCAL Postgres container (docker compose), captures the
// error page and the sign-in-unavailable message, then starts it again. Local development only.
// Run from web/ with the app on :3100:  set -a; . ../.env; set +a; node scripts/error-screens.mjs
import { chromium } from "playwright";
import { execSync } from "node:child_process";
const [email, password] = [process.env.SEED_OWNER_EMAIL, process.env.SEED_OWNER_PASSWORD];
const OUT = "../docs/screenshots/final";
const b = await chromium.launch({ channel: "chrome" });
const combos = [];
for (const theme of ["light", "dark"]) for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const open = async () => {
    const ctx = await b.newContext({ viewport, baseURL: "http://localhost:3100" });
    await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
    return ctx.newPage();
  };
  const p = await open();
  await p.goto("/login"); await p.getByLabel("Email").fill(email); await p.getByLabel("Password").fill(password);
  await p.getByRole("button", { name: "Sign in" }).click(); await p.getByRole("heading", { name: "Overview" }).waitFor();
  combos.push({ dir: `${theme}-${label}`, p, anon: await open() });
}
execSync("docker compose -f ../docker-compose.yml stop postgres", { stdio: "ignore" });
try {
  for (const { dir, p, anon } of combos) {
    await p.goto("/contacts");
    await p.getByText("Something went wrong on the server").waitFor({ timeout: 20000 });
    await p.locator("html[data-hydrated]").waitFor();
    await p.screenshot({ path: `${OUT}/${dir}/42-error.png`, fullPage: true });
    await anon.goto("/login"); await anon.getByLabel("Email").fill(email); await anon.getByLabel("Password").fill("x-wrong");
    await anon.getByRole("button", { name: "Sign in" }).click();
    await anon.getByText("Sign-in is unavailable right now").waitFor({ timeout: 20000 });
    if (anon.url().includes("prisma")) throw new Error("database error leaked into the URL");
    await anon.screenshot({ path: `${OUT}/${dir}/43-login-unavailable.png`, fullPage: true });
    console.log(dir, "ok", await p.evaluate(() => document.documentElement.dataset.theme));
  }
} finally { execSync("docker compose -f ../docker-compose.yml start postgres", { stdio: "ignore" }); }
await b.close();
