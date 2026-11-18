import {openPhoneControls} from './phone-helpers.mjs';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true,
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const errors = [], checks = [];
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('ok   '+name); };
try {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(String(e)));
    for (const [width,height] of [[1366,768],[1280,720],[1024,768]]) {
        await page.setViewportSize({width,height});
        await page.goto(pathToFileURL('demo/demo.html').href+'?tools=ALL');
        await page.evaluate(() => skeleton3d.get('P1_BODY').select('HEART'));
        await page.waitForFunction(() => !skeleton3d.get('P1_BODY').widget.anim);
        const original = await page.locator('.sk3-stage').boundingBox();
        const value = await page.evaluate(() => JSON.stringify(skeleton3d.get('P1_BODY').value()));
        check('viewer honors configured height on laptop '+width, Math.abs(original.height-await page.evaluate(()=>Number(skeleton3d.get('P1_BODY').widget.opts.height)||560))<2);
        check('inspection actions are below the viewer switches '+width, await page.locator('.sk3-stage [data-model="isolate"]').isVisible());
        await page.locator('[data-act="controls"]').click();
        await page.locator('.sk3-view-controls').waitFor({state:'visible'});
        const controls = await page.locator('.sk3-view-controls').boundingBox();
        check('controls open beside the model '+width, controls.x >= original.x+original.width && Math.abs(controls.y-original.y)<2);
        const after = await page.locator('.sk3-stage').boundingBox();
        check('expanded controls do not move or grow the viewer '+width, Math.abs(after.y-original.y)<1 && Math.abs(after.height-original.height)<1);
        await page.locator('[data-model-opacity="STRUCTURES"]').scrollIntoViewIfNeeded();
        check('last anatomy layer is reachable inside the controls '+width, await page.locator('[data-model-opacity="STRUCTURES"]').isVisible());
        await page.locator('[data-model="browser"]').click();
        await page.locator('[data-model-search]').fill('mitral');
        check('browser replaces controls on the right '+width, !await page.locator('.sk3-view-controls').isVisible() && await page.locator('.sk3-browser-drawer').isVisible());
        check('browser finds individual structures '+width, await page.locator('[data-model="structure"]').count()>0);
        await page.locator('[data-model-search]').fill('no-such-anatomy');
        check('browser gives an empty result message '+width, (await page.locator('.sk3-structure-results').innerText()).includes('No structures match'));
        await page.locator('[data-model-search]').fill('');
        await page.locator('.sk3-anatomy-tree > details').evaluateAll(nodes => nodes.forEach(node => node.open=true));
        check('fully expanded browser keeps the same viewer height '+width, (await page.locator('.sk3-stage').boundingBox()).height===original.height);
        await page.keyboard.press('Escape');
        check('Escape closes browser and returns focus '+width, !await page.locator('.sk3-browser-drawer').isVisible() && await page.locator('[data-model="browser"]').evaluate(el=>el===document.activeElement));
        await page.locator('[data-model="isolate"]').click();
        await page.locator('[data-model="explore-detail"]').click();
        await page.locator('[data-detail-part]').selectOption('MITRAL_VALVE');
        await page.waitForFunction(() => !skeleton3d.get('P1_BODY').widget.anim);
        check('detail controls stay in the viewer and leave room for the model '+width, await page.locator('.sk3-stage [data-detail-part]').isVisible() && (await page.locator('.sk3-canvas').boundingBox()).height>200);
        check('navigation preserves the clinical record '+width, await page.evaluate(() => JSON.stringify(skeleton3d.get('P1_BODY').value()))===value);
        if (width===1366) {
            await page.locator('[data-act="controls"]').click();
            await page.screenshot({path:'qa/out/compact-controls-laptop.png'});
            await page.locator('[data-model="browser"]').click();
            await page.locator('[data-model-search]').fill('heart');
            await page.screenshot({path:'qa/out/compact-browser-laptop.png'});
        }
        await page.locator('.sk3-stage [data-model="reveal"]').click();
        check('Full anatomy restores the model '+width, await page.evaluate(()=>!skeleton3d.get('P1_BODY').widget.modelTools.isolated));
    }
    await page.setViewportSize({width:390,height:844});
    await page.goto(pathToFileURL('demo/demo.html').href+'?tools=ALL');
    await openPhoneControls(page);
    await page.locator('[data-model="browser"]').click();
    await page.locator('[data-model-search]').fill('heart');
    check('phone browser uses a bounded pane without horizontal overflow', await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth) && (await page.locator('.sk3-browser-drawer').boundingBox()).height<=440);
    await page.screenshot({path:'qa/out/compact-browser-phone.png',fullPage:true});
    await page.goto(pathToFileURL('demo/demo.html').href);
    check('disabled model tools leave no empty controls or browser', !await page.locator('[data-act="controls"]').isVisible() && await page.locator('.sk3-browser-drawer').count()===0);
    check('layout changes produce no browser exceptions', errors.length===0);
} finally {
    fs.writeFileSync('qa/out/compact-layout-report.json',JSON.stringify({checks,errors},null,2));
    await browser.close();
}
console.log(checks.length+' compact layout checks passed');
