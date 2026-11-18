// Drives the standalone demo like a doctor would and checks the item value: node qa/interact.mjs
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";

const out = "qa/out";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const url = pathToFileURL("demo/demo.html").href;
const errors = [];
let failed = 0;
const check = (name, ok, info) => { if (!ok) { failed++; } console.log((ok ? "ok   " : "FAIL ") + name + (ok || info === undefined ? "" : " -> " + JSON.stringify(info))); };

async function open (w, h, query) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: w < 600 });
    page.on("pageerror", e => errors.push(String(e)));
    page.on("console", m => { if (m.type() === "error") { errors.push(m.text()); } });
    await page.goto(url + (query || ""));
    await page.waitForTimeout(700);
    return page;
}
const value = page => page.evaluate(() => { const v = document.getElementById("P1_BODY").value; return v ? JSON.parse(v) : null; });
// where a bone is on the screen
const where = (page, bone, area) => page.evaluate(([b, a]) => {
    const w = skeleton3d.get("P1_BODY").widget;
    const m = w.model.meshes.find(x => x.userData.bone === b && (!a || x.userData.area === a));
    m.geometry.computeBoundingBox();
    const c = m.geometry.boundingBox.getCenter(m.geometry.boundingBox.min.clone()).applyMatrix4(m.matrixWorld).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height };
}, [bone, area || null]);
const clickBone = async (page, bone, area) => { const p = await where(page, bone, area); await page.mouse.click(p.x, p.y); await page.waitForTimeout(150); };

// ---------------------------------------------------------------- desktop
let p = await open(1280, 860);
check("model has more than 200 parts", await p.evaluate(() => skeleton3d.get("P1_BODY").widget.model.meshes.length) > 200);
await clickBone(p, "PATELLA_L");
let v = await value(p);
check("click on the left kneecap marks Left knee", v && v.sites.length === 1 && v.sites[0].label === "Left knee" && v.sites[0].area === "KNEE" && v.sites[0].side === "L", v);
check("suggestions for the knee are listed", await p.locator(".sk3-sug-b").count() >= 5);
await p.locator(".sk3-sug-b", { hasText: "Gonarthrosis, unspecified" }).click();
await p.locator('.sk3-nrs-b[data-pain="6"]').click();
await p.locator(".sk3-note").fill("worse on stairs");
await p.locator(".sk3-note").blur();
v = await value(p);
check("diagnosis, pain and note are in the value", v.sites[0].diagnoses[0].code === "M17.9" && v.sites[0].pain === 6 && v.sites[0].note === "worse on stairs", v);

await p.locator('[data-complaint="HEADACHE"]').click();
await p.waitForTimeout(600);
v = await value(p);
check("Headache marks the head at once", v.sites.length === 2 && v.sites[1].area === "HEAD" && !v.sites[1].side, v);
check("headache diagnoses are offered", await p.locator(".sk3-sug-b", { hasText: "Tension-type headache" }).count() === 1);

await p.locator('[data-complaint="SHOULDER_PAIN"]').click();
await p.waitForTimeout(300);
check("Shoulder pain asks which side", await p.locator(".sk3-ask").count() === 1 && await p.locator(".sk3-ask [data-cand]").count() === 3);
await p.screenshot({ path: `${out}/ask-side.png` });
await p.locator('.sk3-ask [data-cand="1"]').click();
await p.waitForTimeout(600);
v = await value(p);
check("Right shoulder added", v.sites.length === 3 && v.sites[2].label === "Right shoulder", v);

await p.locator(".sk3-search-in").fill("M54.5");
await p.waitForTimeout(200);
check("search finds M54.5", await p.locator('.sk3-res[data-res="d"]').count() === 1);
await p.locator('.sk3-res[data-res="d"]').first().click();
await p.waitForTimeout(600);
v = await value(p);
check("M54.5 goes to the lower back with the diagnosis", v.sites.length === 4 && v.sites[3].area === "LOWER_BACK" && v.sites[3].diagnoses[0].code === "M54.5", v);
await p.screenshot({ path: `${out}/desktop-marked.png` });

await p.locator(".sk3-search-in").fill("back pain");
await p.waitForTimeout(200);
check("search 'back pain' offers the complaint first", (await p.locator(".sk3-res").first().textContent()).includes("Back pain"));
await p.locator(".sk3-search-in").fill("collarbone");
await p.waitForTimeout(200);
check("search 'collarbone' finds the clavicle", await p.locator('.sk3-res[data-res="b"]', { hasText: "Clavicle" }).count() === 1);
await p.locator(".sk3-search-in").fill("");

// bone mode
await p.locator('[data-act="reset"]').click();
await p.waitForTimeout(600);
await p.locator('[data-seg="mode"] [data-val="BONE"]').click();
await clickBone(p, "FEMUR_L", "THIGH");
v = await value(p);
check("bone mode marks the left femur", v.sites.length === 5 && v.sites[4].bone === "FEMUR" && v.sites[4].side === "L" && /^Left femur/.test(v.sites[4].label), v.sites[4]);
check("femur gets hip, thigh and knee diagnoses", await p.evaluate(() => { const w = skeleton3d.get("P1_BODY").widget; return w.areasOf(w.sites[4]).sort().join(); }) === "HIP,KNEE,THIGH");

// remove
await p.locator('.sk3-site [data-act="remove"]').first().click();
v = await value(p);
check("remove takes a site out", v.sites.length === 4 && v.sites[0].area === "HEAD", v);

// male / female
await p.locator('[data-seg="sex"] [data-val="F"]').click();
await p.waitForTimeout(400);
v = await value(p);
check("female skeleton is saved with the marks", v.sex === "F" && v.sites.length === 4);
await p.screenshot({ path: `${out}/desktop-female.png` });
const saved = await p.evaluate(() => document.getElementById("P1_BODY").value);
await p.close();

// ---------------------------------------------------------------- read only, with a saved value
p = await open(1280, 860, "?ro=1&v=" + encodeURIComponent(saved));
check("read only shows the saved sites", await p.locator(".sk3-site").count() === 4 && await p.locator(".sk3-search-in").count() === 0 && await p.locator('[data-act="remove"]').count() === 0);
check("read only keeps the female skeleton", await p.evaluate(() => skeleton3d.get("P1_BODY").widget.sex) === "F");
await clickBone(p, "PATELLA_R");
check("read only: a click adds nothing", (await value(p)).sites.length === 4);
await p.screenshot({ path: `${out}/readonly.png` });
await p.close();

// ---------------------------------------------------------------- phone
p = await open(390, 844);
const box = await p.locator(".sk3-stage").boundingBox();
check("phone: the view fits the screen width", box.width <= 390 && box.width > 300 && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), box);
const pt = await where(p, "PATELLA_R");
await p.touchscreen.tap(pt.x, pt.y);
await p.waitForTimeout(300);
v = await value(p);
check("phone: a tap marks the right knee", v && v.sites[0].label === "Right knee", v);
await p.screenshot({ path: `${out}/phone.png`, fullPage: true });
await p.close();

check("no page errors", errors.length === 0, errors);
await browser.close();
console.log(failed ? failed + " check(s) FAILED" : "all checks passed");
process.exit(failed ? 1 : 0);
