import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const log = (k, v) => console.log(k.padEnd(22), v);

await page.goto("http://localhost:4173/index.html", { waitUntil: "networkidle" });

// diff apply / undo
await page.locator("[data-apply]").scrollIntoViewIfNeeded();
await page.locator("[data-apply]").click();
await page.waitForTimeout(350);
log("diff applied", await page.locator("[data-diff]").evaluate((el) => el.className));
log("status label", await page.locator("[data-diff] .state .label").innerText());
log("undo visible", await page.locator("[data-undo]").isVisible());
await page.locator("[data-undo]").click();
await page.waitForTimeout(250);
log("after undo", await page.locator("[data-diff] .state .label").innerText());

// stepper
await page.locator("[data-stepper]").scrollIntoViewIfNeeded();
const steps = page.locator("[data-stepper] .step");
log("steps", await steps.count());
await steps.nth(3).click();
await page.waitForTimeout(250);
log("stepper title", await page.locator("[data-stepper] .step-panel h3").innerText());
log("stepper selected", await page.locator('[data-stepper] .step[aria-selected="true"] .t').innerText());

// matrix focus
await page.locator("[data-matrix]").scrollIntoViewIfNeeded();
await page.locator('[data-matrix] th[data-col="2"]').click();
log("matrix focus", await page.locator("[data-matrix] [data-matrix]").count() ? "nested" : await page.locator(".matrix-wrap").evaluate((el) => el.dataset.focus || "none"));

// replay
await page.locator(".hero").scrollIntoViewIfNeeded();
await page.locator(".hero .replay").click();
await page.waitForTimeout(200);
log("replay path", await page.locator(".hero .trace-line").evaluate((el) => getComputedStyle(el).strokeDashoffset.slice(0, 12)));

// counters
await page.locator(".stats").scrollIntoViewIfNeeded();
await page.waitForTimeout(1200);
log("stat figure", await page.locator(".stats .fig").first().innerText());

// download filter
await page.goto("http://localhost:4173/download.html", { waitUntil: "networkidle" });
await page.locator('.seg button[data-os="win"]').click();
await page.waitForTimeout(250);
log("win rows visible", await page.locator("tr[data-os]:visible").count());
log("recommended row", await page.locator("tr.rec td.py").allInnerTexts());

// docs scrollspy
await page.goto("http://localhost:4173/docs.html", { waitUntil: "networkidle" });
await page.locator("#autofix").scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
log("doc nav active", await page.locator(".doc-nav a.active").innerText());

await browser.close();
log("errors", errors.length ? errors.join(" | ") : "none");
