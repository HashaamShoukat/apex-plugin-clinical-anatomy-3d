import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const checks=[],errors=[];const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('ok   '+name);};
const url=pathToFileURL('demo/demo.html').href;
const heartPoint=page=>page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget,m=w.model.meshes.find(m=>m.visible&&m.userData.area==='HEART'&&!m.userData.detail);m.geometry.computeBoundingBox();const p=m.geometry.boundingBox.getCenter(w.camera.position.clone()).applyMatrix4(m.matrixWorld).project(w.camera),r=w.canvas.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};});
try {
 const page=await browser.newPage({viewport:{width:1366,height:900}});page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url+'?tools=ALL&gesture=DOUBLE');await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.ready);
 let p=await heartPoint(page);await page.mouse.click(p.x,p.y);
 check('double-click configuration does not record on the first click',await page.evaluate(()=>skeleton3d.get('P1_BODY').value().sites.length===0));
 await page.mouse.click(p.x,p.y);
 check('the second click records the intended organ once',await page.evaluate(()=>skeleton3d.get('P1_BODY').value().sites.length===1&&skeleton3d.get('P1_BODY').value().sites[0].area==='HEART'));
 await page.evaluate(()=>skeleton3d.get('P1_BODY').clear());
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+35,p.y+12,{steps:5});await page.mouse.up();
 check('dragging never selects anatomy',await page.evaluate(()=>skeleton3d.get('P1_BODY').value().sites.length===0));
 await page.goto(url+'?tools=ALL');await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.ready);p=await heartPoint(page);await page.mouse.click(p.x,p.y);
 check('single-click selection remains the default',await page.evaluate(()=>skeleton3d.get('P1_BODY').value().sites[0]?.area==='HEART'));
 for(const [area,side,key] of [['LUNG','R','LUNG_MIDDLE_LOBE'],['LUNG','L','LUNG_SUPERIOR_LOBE'],['PANCREAS',null,'PANCREATIC_TAIL'],['STOMACH',null,'GASTRIC_FUNDUS'],['KNEE','L','BONE:PATELLA:L'],['HAND','R','BONE:METACARPAL1:R'],['HEAD',null,'BONE:FRONTAL:']]) {
  await page.evaluate(([area,side])=>skeleton3d.get('P1_BODY').load({v:2,sex:'M',sites:[{area,side,diagnoses:[]}]}),[area,side]);
  const before=await page.evaluate(()=>JSON.stringify(skeleton3d.get('P1_BODY').value()));
  await page.locator('[data-model="isolate"]').click();await page.locator('[data-model="explore-detail"]').click();
  if(area==='LUNG'&&side==='L'){check('left lung details exclude a middle lobe',await page.locator('[data-detail-part] option[value="LUNG_MIDDLE_LOBE"]').count()===0);}
  await page.locator('[data-detail-part]').selectOption(key);
  await page.waitForFunction(()=>!skeleton3d.get('P1_BODY').widget.anim);
  check('detail inspection supports '+area+(side?' '+side:''),await page.evaluate(key=>skeleton3d.get('P1_BODY').widget.modelTools.inspectedPart===key,key)&&await page.evaluate(()=>JSON.stringify(skeleton3d.get('P1_BODY').value()))===before);
  if(area==='KNEE') {
   await page.locator('[data-detail-part]').selectOption('ANTERIOR_CRUCIATE');await page.locator('[data-model="record-detail"]').click();
   check('joint structure findings retain area and laterality',await page.evaluate(()=>skeleton3d.get('P1_BODY').value().sites.some(s=>s.part==='ANTERIOR_CRUCIATE'&&s.side==='L'&&s.area==='KNEE')));
  }
  if(area==='HAND'){await page.locator('[data-model="record-detail"]').click();check('bone detail records a bone rather than an organ part',await page.evaluate(()=>skeleton3d.get('P1_BODY').value().sites.some(s=>s.bone==='METACARPAL1'&&s.side==='R'&&!s.part)));}
  if(area==='LUNG'&&side==='R'){await page.screenshot({path:'qa/out/lung-lobe-details.png'});}
 }
 const touch=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});touch.on('pageerror',e=>errors.push(String(e)));
 await touch.goto(url+'?tools=ALL&gesture=DOUBLE');await touch.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.ready);p=await heartPoint(touch);
 await touch.touchscreen.tap(p.x,p.y);check('double-tap mode does not record on the first touch',await touch.evaluate(()=>skeleton3d.get('P1_BODY').value().sites.length===0));
 await touch.evaluate(()=>{skeleton3d.get('P1_BODY').widget.selectionTap=null;});
 await touch.touchscreen.tap(p.x,p.y);await touch.touchscreen.tap(p.x,p.y);check('double-tap selects anatomy on touch screens',await touch.evaluate(()=>skeleton3d.get('P1_BODY').value().sites.length===1));
 check('selection and detail changes have no browser exceptions',errors.length===0);
}finally{fs.writeFileSync('qa/out/selection-details-report.json',JSON.stringify({checks,errors},null,2));await browser.close();}
