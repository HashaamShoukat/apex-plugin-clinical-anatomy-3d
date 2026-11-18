import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const checks=[],errors=[];const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('ok   '+name);};
try {
 const page=await browser.newPage({hasTouch:true});page.on('pageerror',error=>errors.push(String(error)));
 for(const [width,height] of [[390,844],[375,667],[320,740]]){
  await page.setViewportSize({width,height});await page.goto(pathToFileURL('demo/demo.html').href+'?tools=ALL');
  await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.ready);
  await page.evaluate(()=>{const host=document.createElement('header');host.style.height='120px';host.textContent='Application header';document.body.prepend(host);const nav=document.createElement('nav');nav.id='phone-navigation';nav.textContent='Demo navigation';nav.style='position:fixed;bottom:0;left:0;right:0;height:68px;background:#fff;border-top:1px solid #aaa;z-index:100';document.body.append(nav);skeleton3d.get('P1_BODY').widget.workspace.fitViewport();});
  await page.waitForFunction(()=>{const w=skeleton3d.get('P1_BODY').widget;return w.workspace.phone&&!w.anim&&w.canvas.clientHeight>200;});
  check('controls start folded at '+width,await page.locator('.sk3-phone-tools').isVisible()&&!await page.locator('.sk3-phone-tools').evaluate(node=>node.open));
  const geometry=await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget,r=w.canvas.getBoundingClientRect(),footer=document.getElementById('phone-navigation').getBoundingClientRect();let top=Infinity,bottom=-Infinity;for(const mesh of w.model.meshes.filter(m=>m.visible)){mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const v=w.controls.target.clone().set(x,y,z).applyMatrix4(mesh.matrixWorld).project(w.camera);const sy=r.y+(1-v.y)*r.height/2;top=Math.min(top,sy);bottom=Math.max(bottom,sy);}}return {canvas:r.toJSON(),top,bottom,footer:footer.top,width:innerWidth,overflow:document.documentElement.scrollWidth};});
  check('whole body is visible above phone navigation at '+width,geometry.canvas.y<350&&geometry.top>=geometry.canvas.y-1&&geometry.bottom<geometry.footer-6);
  check('phone layout has no horizontal overflow at '+width,geometry.overflow<=geometry.width);
  const before=await page.evaluate(()=>JSON.stringify(skeleton3d.get('P1_BODY').value()));
  const summary=page.locator('.sk3-phone-tools > summary');await summary.focus();await page.keyboard.press('Enter');
  check('keyboard opens all phone controls at '+width,await page.locator('.sk3-search-in').isVisible()&&await page.locator('[data-appearance="mode"]').isVisible());
  await page.locator('[data-seg="layer"] [data-val="ORGANS"]').click();await page.locator('[data-seg="view"] [data-val="back"]').click();await page.locator('[data-appearance="theme"]').selectOption('light');await page.keyboard.press('Escape');
  check('Escape returns focus to the phone disclosure at '+width,!await page.locator('.sk3-phone-tools').evaluate(node=>node.open)&&await summary.evaluate(node=>node===document.activeElement));
  check('opening and changing view controls preserves clinical data at '+width,await page.evaluate(value=>JSON.stringify(skeleton3d.get('P1_BODY').value())===value,before));
  await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.home(false));await page.screenshot({path:'qa/out/phone-first-'+width+'.png'});
 }
 await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>skeleton3d.get('P1_BODY').widget.workspace.phone===false);
 check('desktop restores the original control locations',await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;return w.root.querySelector('.sk3-topbar').parentElement===w.root&&w.stage.querySelector('.sk3-viewer-header')&&w.root.querySelector('.sk3-phone-tools').hidden;}));
 check('responsive moves create no duplicate controls',await page.locator('.sk3-topbar').count()===1&&await page.locator('.sk3-search-in').count()===1&&await page.locator('[data-appearance="mode"]').count()===1);
 check('phone-first layout has no browser errors',errors.length===0);
} finally {fs.writeFileSync('qa/out/phone-first.json',JSON.stringify({checks,errors},null,2));await browser.close();}
console.log(checks.length+' phone-first checks passed');
