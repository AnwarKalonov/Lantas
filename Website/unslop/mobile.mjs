import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
page.on("pageerror", (e) => console.log("ERR", e.message));

await page.goto("http://localhost:4173/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(2400);
await page.screenshot({ path: "unslop/mobile-hero.png" });

await page.evaluate(async () => {
  const step = Math.round(window.innerHeight * 0.7);
  for (let y = 0; y < 3000; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 100));
  }
  window.scrollTo(0, 900);
});
await page.waitForTimeout(900);
await page.screenshot({ path: "unslop/mobile-s01.png" });

const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth
);
console.log("horizontal overflow px:", overflow);
await browser.close();
