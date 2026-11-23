import { chromium } from "playwright";

const shots = [
  { url: "https://residualml.com/", name: "unslop/before-full.png", full: true },
  { url: "https://residualml.com/", name: "unslop/before-hero.png", full: false },
  { url: "http://localhost:4173/index.html", name: "unslop/after-hero.png", full: false },
  { url: "http://localhost:4173/index.html", name: "unslop/after-full.png", full: true },
  { url: "http://localhost:4173/docs.html", name: "unslop/after-docs.png", full: false },
  { url: "http://localhost:4173/download.html", name: "unslop/after-download.png", full: false },
];

const browser = await chromium.launch();
const errors = [];

for (const shot of shots) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: shot.full ? 1 : 2,
  });
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${shot.url} :: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${shot.url} :: ${e.message}`));

  await page.goto(shot.url, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.75);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
  });
  await page.evaluate(() => {
    document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("in"));
  });
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot.name, fullPage: shot.full });
  console.log("shot", shot.name);
  await page.close();
}

await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
