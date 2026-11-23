import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto("http://localhost:4173/index.html", { waitUntil: "networkidle" });
await page.evaluate(async () => {
  const step = Math.round(window.innerHeight * 0.7);
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 110));
  }
});
await page.waitForTimeout(2200);

const targets = [
  ["hero", ".hero"],
  ["s01", "#observability"],
  ["s02", "#analysis"],
  ["s03", "#intervention"],
  ["s04", "#verification"],
  ["s05", "#related"],
  ["s06", "#install"],
  ["s07", "#authors"],
  ["foot", ".footer"],
];

for (const [name, sel] of targets) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await el.screenshot({ path: `unslop/sec-${name}.png` });
  console.log("ok", name);
}

await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
