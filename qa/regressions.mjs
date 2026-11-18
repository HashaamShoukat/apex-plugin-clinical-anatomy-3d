import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
const check = (name, passed, details) => {
    results.push({ name, passed: !!passed, ...(passed ? {} : { details }) });
    console.log((passed ? 'ok   ' : 'FAIL ') + name);
};
const sample = note => ({ v: 2, sex: 'F', sites: [{ area: 'KIDNEY', side: 'L', note, diagnoses: [] }] });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || String(error)));
    await page.goto(pathToFileURL('demo/demo.html').href + '?tools=ALL');
    await page.waitForFunction(() => !!window.skeleton3d?.get('P1_BODY')?.widget.model);
    for (const [name, invalid] of [
        ['malformed JSON', '{'],
        ['unsupported version', { v: 99, sites: [] }],
        ['non-array sites', { v: 2, sites: {} }],
        ['unknown anatomy', { v: 2, sites: [{ area: 'FORGED', diagnoses: [] }] }],
        ['duplicate sites', { v: 2, sites: [{ area: 'HEART' }, { area: 'HEART' }] }],
        ['invalid pain', { v: 2, sites: [{ area: 'HEART', pain: 11 }] }],
        ['null marker', { v: 2, sites: [{ area: 'HEART', markers: [null] }] }],
        ['non-array marker points', { v: 2, sites: [{ area: 'HEART', markers: [{ points: {} }] }] }],
        ['invalid certainty', { v: 2, sites: [{ area: 'HEART', diagnoses: [{ code: 'A', label: 'A', certainty: 'FORGED' }] }] }]
    ]) {
        const outcome = await page.evaluate(([good, bad]) => {
            const api = skeleton3d.get('P1_BODY'); api.load(good);
            const before = JSON.stringify(api.value());
            let rejected = false;
            try { api.load(bad); } catch (_) { rejected = true; }
            return { rejected, preserved: before === JSON.stringify(api.value()) };
        }, [sample('Retain this finding'), invalid]);
        check(name + ' is rejected atomically', outcome.rejected && outcome.preserved, outcome);
    }
    check('loading another record clears undo and unfinished outline', await page.evaluate(([first, second]) => {
        const api = skeleton3d.get('P1_BODY'), w = api.widget;
        api.load(first); api.select('HEART');
        w.modelTools.draft = [[0, 1, 0]]; w.modelTools.draftTarget = { area: 'HEART' };
        api.load(second);
        return w.modelTools.undoValues.length === 0 && w.modelTools.draft.length === 0 && !w.modelTools.draftTarget;
    }, [sample('Record A'), sample('Record B')]));
    check('loading emits the plugin change event once', await page.evaluate(value => {
        let count = 0;
        const input = document.getElementById('P1_BODY');
        const handler = () => count++;
        input.addEventListener('skeleton3dchange', handler);
        skeleton3d.get('P1_BODY').load(value);
        input.removeEventListener('skeleton3dchange', handler);
        return count === 1;
    }, sample('Changed record')));
    await page.evaluate(() => {
        const api = skeleton3d.get('P1_BODY'); api.load(''); api.widget.opts.maxSites = 1;
        api.widget.choose('Knee', api.widget.candidatesFor(['KNEE']));
    });
    await page.locator('[data-cand="both"]').click();
    check('Both respects the site limit without partial selection', await page.evaluate(() => {
        const api = skeleton3d.get('P1_BODY'), ok = api.value().sites.length === 0 && !!api.widget.pending;
        api.widget.opts.maxSites = 0;
        return ok && document.querySelector('.sk3-clinic-status').textContent.includes('No more sites');
    }));
    check('opacity cache stays bounded after repeated slider changes', await page.evaluate(() => {
        const w = skeleton3d.get('P1_BODY').widget;
        for (let opacity = 1; opacity <= 100; opacity++) { w.modelTools.opacity.ORGANS = opacity / 100; w.paint(); }
        return w.modelTools.materials.size < 250;
    }));
    check('marker creation enforces the load contract point limit', await page.evaluate(() => {
        const api = skeleton3d.get('P1_BODY'); api.select('HEART');
        const site = api.widget.sites[0];
        api.widget.modelTools.addMarker(site, Array.from({ length: 101 }, () => [0,1,0]), 'AREA');
        return !site.markers.length;
    }));
    check('cross-section excludes clipped anatomy from hit testing', await page.evaluate(() => {
        const w = skeleton3d.get('P1_BODY').widget;
        w.setLayer('ORGANS'); w.home(false);
        w.modelTools.crossSection = true; w.modelTools.section.constant = -100;
        w.renderer.localClippingEnabled = true; w.paint();
        const mesh = w.model.meshes.find(mesh => mesh.visible && mesh.userData.area === 'HEART');
        mesh.geometry.computeBoundingBox();
        const point = mesh.geometry.boundingBox.getCenter(mesh.geometry.boundingBox.min.clone()).applyMatrix4(mesh.matrixWorld).project(w.camera);
        const rect = w.canvas.getBoundingClientRect();
        const hit = w.hit({ clientX: rect.left + (point.x + 1) / 2 * rect.width, clientY: rect.top + (1 - point.y) / 2 * rect.height });
        w.modelTools.crossSection = false; w.paint();
        return hit === null;
    }));
    check('late search response cannot replace current complaint identities', await page.evaluate(async () => {
        const w = skeleton3d.get('P1_BODY').widget;
        const original = w.clinic.terms;
        const pending = {};
        w.clinic.terms = (kind, areas, query) => kind === 'COMPLAINT' ? new Promise(resolve => { pending[query] = resolve; }) : Promise.resolve([]);
        try {
            w.runSearch('first'); await new Promise(resolve => setTimeout(resolve, 10));
            w.runSearch('second'); await new Promise(resolve => setTimeout(resolve, 10));
            pending.second([{ label: 'Second complaint', code: 'SECOND', areas: ['HEART'] }]);
            await new Promise(resolve => setTimeout(resolve, 10));
            pending.first([{ label: 'First complaint', code: 'FIRST', areas: ['HEART'] }]);
            await new Promise(resolve => setTimeout(resolve, 10));
            return w.searchComplaints[0].code === 'SECOND';
        } finally { w.clinic.terms = original; w.closeResults(); }
    }));
    check('PNG export uses finite coordinates for finding labels', await page.evaluate(() => {
        const w = skeleton3d.get('P1_BODY').widget;
        w.modelTools.overlay.innerHTML = '<span style="--sk3-label-x:50px;--sk3-label-y:80px">QA annotation</span>';
        const originalText = CanvasRenderingContext2D.prototype.fillText;
        const originalClick = HTMLAnchorElement.prototype.click;
        let found = false;
        CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...args) {
            if (text === 'QA annotation') { found = Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0; }
            return originalText.call(this, text, x, y, ...args);
        };
        HTMLAnchorElement.prototype.click = () => {};
        try { w.modelTools.exportImage(); }
        finally { CanvasRenderingContext2D.prototype.fillText = originalText; HTMLAnchorElement.prototype.click = originalClick; }
        return found;
    }));
    check('public cleanup disposes widget resources', await page.evaluate(() => {
        const api = skeleton3d.get('P1_BODY');
        if (!api.destroy) { return false; }
        const w = api.widget; api.destroy();
        return skeleton3d.get('P1_BODY') === null && w.destroyed && w.modelTools.materials.size === 0;
    }));
    const fallback = await browser.newPage();
    await fallback.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            return type.startsWith('webgl') ? null : getContext.call(this, type, ...args);
        };
    });
    const fallbackErrors = [];
    fallback.on('pageerror', error => fallbackErrors.push(String(error)));
    await fallback.goto(pathToFileURL('demo/demo.html').href + '?tools=ALL');
    await fallback.waitForTimeout(200);
    check('WebGL failure preserves a usable item with all tools enabled', await fallback.evaluate(() => !!window.skeleton3d?.get('P1_BODY')));
    check('WebGL fallback search records anatomy', await fallback.evaluate(() => {
        const api = window.skeleton3d?.get('P1_BODY');
        return !!api && api.select('KNEE', 'R') === 'Right knee';
    }));
    await fallback.locator('[data-model="browser"]').click();
    await fallback.locator('[data-model-search]').fill('heart');
    await fallback.locator('[data-model="reveal"]').first().click();
    check('WebGL fallback supports browser search and reveal controls', fallbackErrors.length === 0, fallbackErrors);
    check('WebGL fallback has no uncaught exceptions', fallbackErrors.length === 0, fallbackErrors);
    check('normal browser has no uncaught exceptions', errors.length === 0, errors);
} finally { await browser.close(); }
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync('qa/out/regression-report.json', JSON.stringify(results, null, 2));
assert.equal(results.filter(result => !result.passed).length, 0, 'Regression checks failed');
console.log(results.length + ' regression checks passed');
