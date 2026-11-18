import { chromium } from "playwright-core";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const compiled = await build({ entryPoints: ["src/catalog.js"], bundle: true, write: false, format: "esm" });
const { AREAS, DIAGNOSES } = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].contents).toString("base64"));
const organs = AREAS.filter(area => area.organ);
assert.equal(new Set(DIAGNOSES.map(row => row.code)).size, DIAGNOSES.length, "diagnosis codes are unique");
for (const organ of organs) {
    assert.ok(DIAGNOSES.some(row => row.areas.includes(organ.id)), organ.id + " has diagnosis coverage");
}
for (const row of DIAGNOSES) {
    assert.ok(row.areas.every(id => AREAS.some(area => area.id === id)), "known areas for " + row.code);
}
console.log("ok   " + DIAGNOSES.length + " unique diagnoses cover all " + organs.length + " organ areas");

mkdirSync("qa/out", { recursive: true });
const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
});
const errors = [];
let checks = 0;
const check = (name, value) => {
    assert.ok(value, name);
    checks++;
    console.log("ok   " + name);
};
const url = pathToFileURL("demo/demo.html").href;

try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", error => errors.push(String(error)));
    await page.goto(url + "?specialty=CARDIOLOGY");
    await page.waitForFunction(() => window.skeleton3d && skeleton3d.get("P1_BODY"));
    await page.locator('[data-area="HEART"]').click();
    await page.locator(".sk3-sug-b").first().waitFor();
    check("heart selection offers diagnoses", await page.locator(".sk3-sug-b").count() >= 5);
    await page.locator(".sk3-sug-f").fill("failure");
    await page.locator(".sk3-sug-b", { hasText: "I50.9" }).click();
    const heartValue = await page.evaluate(() => skeleton3d.get("P1_BODY").value());
    check("heart diagnosis saves its code, title and coding system", heartValue.sites[0].diagnoses.some(row => row.code === "I50.9" && row.label === "Heart failure, unspecified" && row.system === "ICD-10"));

    await page.locator(".sk3-sug-f").fill("zzzz-no-such-diagnosis");
    check("empty filters show their own message", await page.locator(".sk3-sug-l").innerText().then(value => value.includes("No diagnoses match this filter.")));
    check("a filter remains available when no rows match", await page.locator(".sk3-sug-f").isVisible());
    await page.locator(".sk3-sug-f").fill("");
    check("clearing the filter restores available diagnoses", await page.locator(".sk3-sug-b").count() > 0);

    await page.locator(".sk3-search-in").fill("N20.0");
    await page.waitForTimeout(100);
    check("cardiology excludes renal diagnoses from search", await page.locator('.sk3-res[data-res="d"]').count() === 0);
    await page.locator(".sk3-search-in").fill("");

    const saved = JSON.stringify(heartValue);
    await page.goto(url + "?specialty=CARDIOLOGY&ro=1&v=" + encodeURIComponent(saved));
    check("saved heart diagnoses reload in read-only mode", await page.locator(".sk3-dx").innerText().then(value => value.includes("I50.9") && value.includes("Heart failure, unspecified")));
    await page.goto(url);
    for (const organ of organs) {
        await page.evaluate(id => {
            const api = skeleton3d.get("P1_BODY");
            api.clear();
            api.select(id, "L");
        }, organ.id);
        await page.locator(".sk3-sug-b").first().waitFor();
    }
    check("all 25 selectable organs render populated diagnosis lists", true);

    await page.evaluate(() => {
        const api = skeleton3d.get("P1_BODY");
        api.clear();
        api.select("VENA_CAVA");
        return api.widget.dxFor(["VENA_CAVA"]).then(rows => {
            for (const row of rows) { api.select("VENA_CAVA", null, row); }
        });
    });
    check("fully selected catalogs explain why no choices remain", await page.locator(".sk3-sug-l").innerText().then(value => value.includes("already selected")));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
        const api = skeleton3d.get("P1_BODY");
        api.clear();
        api.setSpecialty("CARDIOLOGY");
        api.select("HEART");
    });
    await page.locator(".sk3-sug-b").first().waitFor();
    check("mobile heart diagnoses fit the page", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: "qa/out/heart-diagnoses-phone.png", fullPage: true });
    check("no browser exceptions", errors.length === 0);
    console.log(checks + " diagnosis interaction checks passed");
} finally {
    await browser.close();
}
