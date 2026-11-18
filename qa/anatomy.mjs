// Integration checks for organ selection, specialty filtering and persisted values.
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

mkdirSync("qa/out", { recursive: true });

const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
});
const errors = [];
let count = 0;
const check = (name, result) => {
    assert.ok(result, name);
    count++;
    console.log("ok   " + name);
};
const url = pathToFileURL("demo/demo.html").href;
const value = page => page.evaluate(() => skeleton3d.get("P1_BODY").value());
const visibleAreas = page => page.evaluate(() => [...new Set(skeleton3d.get("P1_BODY").widget.model.meshes.filter(m => m.visible).map(m => m.userData.area))]);

async function open (query, mobile = false) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: mobile });
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(url + query);
    await page.waitForFunction(() => window.skeleton3d && skeleton3d.get("P1_BODY").widget.renderer);
    await page.waitForTimeout(200);
    return page;
}

// Project a main surface and drive the real raycaster through mouse/touch input.
async function clickOrgan (page, id, side, touch = false) {
    const point = await page.evaluate(([area, side]) => {
        const w = skeleton3d.get("P1_BODY").widget;
        const mesh = w.model.meshes.find(m => m.visible && m.userData.area === area && m.userData.side === side && !m.userData.detail);
        mesh.geometry.computeBoundingBox();
        const position = mesh.geometry.boundingBox.getCenter(w.camera.position.clone()).applyMatrix4(mesh.matrixWorld).project(w.camera);
        const rect = w.canvas.getBoundingClientRect();
        return { x: rect.left + (position.x + 1) * rect.width / 2, y: rect.top + (1 - position.y) * rect.height / 2 };
    }, [id, side]);
    if (touch) { await page.touchscreen.tap(point.x, point.y); }
    else { await page.mouse.click(point.x, point.y); }
    await page.waitForTimeout(150);
}

async function chooseArea (page, id) {
    const directory = page.locator(".sk3-anatomy");
    if (!await directory.evaluate(element => element.open)) { await directory.locator("summary").click(); }
    await page.locator(`[data-area="${id}"]`).click();
}

try {
    let page = await open("?specialty=UROLOGY");
    check("urology shows kidneys and bladder while hiding heart and eye", (await visibleAreas(page)).includes("KIDNEY") && (await visibleAreas(page)).includes("BLADDER") && !(await visibleAreas(page)).includes("HEART") && !(await visibleAreas(page)).includes("EYE"));
    await clickOrgan(page, "KIDNEY", "L");
    let v = await value(page);
    check("clicking a kidney records the patient's left kidney", v.sites.length === 1 && v.sites[0].area === "KIDNEY" && v.sites[0].side === "L" && !v.sites[0].bone);
    await page.locator('[data-pain="4"]').click();
    await page.locator(".sk3-note").fill("Follow-up observation");
    await chooseArea(page, "KIDNEY");
    await page.locator('[data-cand="1"]').click();
    v = await value(page);
    check("paired kidney selection keeps distinct left and right sites", v.sites.length === 2 && v.sites.some(s => s.side === "R"));
    const saved = await page.evaluate(() => document.getElementById("P1_BODY").value);

    await page.selectOption(".sk3-specialty", "CARDIOLOGY");
    await page.waitForTimeout(500);
    check("changing specialty preserves the complete item value", await page.evaluate(() => document.getElementById("P1_BODY").value) === saved);
    check("cardiology hides kidney meshes and kidney buttons", !(await visibleAreas(page)).includes("KIDNEY") && await page.locator('[data-area="KIDNEY"]').count() === 0);
    await page.locator(".sk3-search-in").fill("kidney");
    await page.waitForTimeout(100);
    check("specialty search excludes hidden organs", await page.locator('.sk3-res[data-id="KIDNEY"]').count() === 0);
    await page.locator(".sk3-search-in").fill("M17.9");
    await page.waitForTimeout(100);
    check("cardiology diagnosis search excludes knee diagnoses", await page.locator('.sk3-res[data-res="d"]').count() === 0);
    await page.locator(".sk3-search-in").fill("");
    await clickOrgan(page, "HEART", null);
    check("the real canvas selects the heart through the translucent ribs", (await value(page)).sites.some(s => s.area === "HEART"));

    await page.selectOption(".sk3-specialty", "ENT");
    await page.waitForTimeout(500);
    const entAreas = await visibleAreas(page);
    check("ENT includes ears, nose and throat while hiding eyes", ["EAR", "NOSE", "THROAT"].every(a => entAreas.includes(a)) && !entAreas.includes("EYE"));
    await chooseArea(page, "EAR");
    await page.locator('[data-cand="0"]').click();
    check("ENT supports left ear records", (await value(page)).sites.some(s => s.area === "EAR" && s.side === "L"));

    await page.selectOption(".sk3-specialty", "OPHTHALMOLOGY");
    await page.waitForTimeout(500);
    await clickOrgan(page, "EYE", "R");
    check("ophthalmology supports direct right eye selection", (await value(page)).sites.some(s => s.area === "EYE" && s.side === "R"));
    await page.selectOption(".sk3-specialty", "GASTROENTEROLOGY");
    check("an empty skeleton layer is disabled for gastroenterology", await page.locator('[data-seg="layer"] [data-val="SKELETON"]').isDisabled());
    await page.selectOption(".sk3-specialty", "ORTHOPEDICS");
    check("orthopedics shows the skeleton and disables an empty organ layer", await page.locator('[data-seg="layer"] [data-val="ORGANS"]').isDisabled() && !(await visibleAreas(page)).includes("HEART"));
    await page.close();

    page = await open("?specialty=UROLOGY&ro=1&v=" + encodeURIComponent(saved));
    v = await value(page);
    check("organ JSON reloads with pain, note and laterality", v.sites.length === 2 && v.sites[0].pain === 4 && v.sites[0].note === "Follow-up observation" && v.sites[0].side === "L");
    await clickOrgan(page, "BLADDER", null);
    check("read-only organ clicks preserve the saved record", await page.evaluate(() => document.getElementById("P1_BODY").value) === saved);
    await page.close();

    page = await open("?specialty=UROLOGY&sex=F&specialtySwitch=0", true);
    check("a fixed female urology preset omits the specialty selector and prostate", await page.locator(".sk3-specialty").count() === 0 && !(await visibleAreas(page)).includes("PROSTATE") && await page.locator('[data-area="PROSTATE"]').count() === 0);
    check("the mobile toolbar and anatomy fit without horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await clickOrgan(page, "KIDNEY", "R", true);
    check("touch selects the patient's right kidney", (await value(page)).sites.some(s => s.area === "KIDNEY" && s.side === "R"));
    await page.screenshot({ path: "qa/out/anatomy-phone.png", fullPage: true });
    await page.close();

    page = await open("?specialty=UNKNOWN&layer=UNKNOWN");
    check("unknown configuration falls back to General Medicine and Anatomy", await page.evaluate(() => {
        const w = skeleton3d.get("P1_BODY").widget;
        return w.specialty.id === "ALL" && w.layer === "ANATOMY";
    }));
    await page.close();
    check("no browser exceptions", errors.length === 0);
    console.log(count + " anatomy checks passed");
} finally {
    await browser.close();
}
