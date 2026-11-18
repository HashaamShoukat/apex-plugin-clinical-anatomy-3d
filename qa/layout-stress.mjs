import {openPhoneControls} from './phone-helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {chromium,firefox,webkit} from 'playwright-core';

const results=[],errors=[],consoleErrors=[];
const engine=process.env.QA_BROWSER || 'chromium';
assert.ok(['chromium','firefox','webkit'].includes(engine),'Unknown QA_BROWSER');
const artifact=name=>'qa/out/'+(engine==='chromium'?'':engine+'-')+name;
const browser=await ({chromium,firefox,webkit}[engine]).launch(engine==='chromium'?{executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']}:engine==='firefox'?{headless:true,firefoxUserPrefs:{'webgl.force-enabled':true,'webgl.disabled':false}}:{headless:true});
const check=(name,ok)=>{assert.ok(ok,name);results.push(name);console.log('ok   '+name);};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',error=>errors.push(error.stack||String(error)));
 page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 await page.goto(pathToFileURL('demo/demo.html').href+'?tools=ALL&exam=OPTIONAL');
 await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.ready);
 await page.evaluate(()=>skeleton3d.get('P1_BODY').load({v:2,sex:'F',sites:[
  {area:'HEART',assessment:'ABNORMAL',note:'Fictional layout test',pain:0,diagnoses:[{code:'I50.9',system:'ICD-10',label:'Heart failure, unspecified'}]},
  {area:'KIDNEY',side:'L',note:'Keep laterality'}, {area:'KNEE',side:'R',pain:4}
 ]}));
 const baseline=await page.evaluate(()=>JSON.stringify(skeleton3d.get('P1_BODY').value()));
 check('resizing cancels stale camera animations',await page.evaluate(async()=>{const w=skeleton3d.get('P1_BODY').widget;w.setView('back');w.home(false);const position=w.camera.position.clone();await new Promise(resolve=>setTimeout(resolve,500));return position.distanceTo(w.camera.position)<1e-8;}));
 check('neon colors can be changed without changing assessment data',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY'),before=JSON.stringify(a.value());a.setColorMode('NEON');a.setNeonColor('#ff55dd');return a.widget.appearance.mode==='NEON'&&a.widget.root.style.getPropertyValue('--sk3-neon')==='#ff55dd'&&JSON.stringify(a.value())===before;}));
 check('neon mode preserves normal and abnormal finding colors',await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget,mesh=w.model.meshes.find(mesh=>mesh.userData.area==='HEART');return mesh.material.color.getHexString()==='d93a2c'&&mesh.material.emissiveIntensity>0;}));
 check('invalid appearance input is rejected atomically',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');let rejected=0;for(const action of [()=>a.setNeonColor('url(javascript:test)'),()=>a.setColorMode('INVALID'),()=>a.setTheme('INVALID')]){try{action();}catch(_){rejected++;}}return rejected===3&&a.widget.appearance.color==='#ff55dd'&&a.widget.appearance.mode==='NEON';}));
 const sizes=[[1440,1000],[1024,768],[768,1024],[390,844],[844,390],[320,740],[1440,1000]];
 const specialties=['ALL','CARDIOLOGY','UROLOGY','ORTHOPEDICS','ENT','ALL','ALL'];
 const tints=['#36f5ff','#ff55dd','#b7ff40'];
 for(let round=0;round<3;round++){
  for(let index=0;index<sizes.length;index++){
   const [width,height]=sizes[index];await page.setViewportSize({width,height});await openPhoneControls(page);
   await page.locator('[data-appearance="mode"]').selectOption((round+index)%2?'CLINICAL':'NEON');
   await page.locator('[data-appearance="theme"]').selectOption(['light','dark','auto'][(round+index)%3]);
   await page.evaluate(tint=>skeleton3d.get('P1_BODY').setNeonColor(tint),tints[(round+index)%3]);
   await page.locator('.sk3-specialty').selectOption(specialties[index]);
   for(const layer of ['ANATOMY','SKELETON','ORGANS','ANATOMY']){
    const button=page.locator('[data-seg="layer"] [data-val="'+layer+'"]');if(await button.isEnabled())await button.click();
   }
   await page.locator('[data-seg="view"] [data-val="back"]').click();
   await page.locator('[data-seg="view"] [data-val="front"]').click();
   await page.locator('[data-act="controls"]').click();
   await page.locator('[data-model="close-controls"]').click();
   await page.locator('[data-model="browser"]').click();
   await page.locator('[data-model-search]').fill(index%2?'mitral':'');
   await page.locator('[data-model="close-browser"]').click();
   if(width>860){await page.locator('.sk3-divider').focus();await page.keyboard.press('Home');await page.keyboard.press('End');}
   await page.evaluate(index=>{const w=skeleton3d.get('P1_BODY').widget;w.workspace.setSplit([25,75,56][index%3]);},index);
   await page.evaluate(()=>skeleton3d.get('P1_BODY').setReadOnly(true));
   await page.locator('[data-clinic="show-exam"]').first().click();
   await page.keyboard.press('Escape');
   await page.evaluate(()=>skeleton3d.get('P1_BODY').setReadOnly(false));
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   check('layout cycle '+(round+1)+' at '+width+'x'+height,await page.evaluate(baseline=>{
    const w=skeleton3d.get('P1_BODY').widget,rect=w.viewport.getBoundingClientRect();
    return JSON.stringify(skeleton3d.get('P1_BODY').value())===baseline&&document.documentElement.scrollWidth<=innerWidth&&rect.width>100&&rect.height>=100&&Number.isFinite(w.camera.aspect)&&w.camera.aspect>0&&w.appearance.materials.size<200&&w.modelTools.materials.size<250;
   },baseline));
   if(round===2&&[0,3,6].includes(index))await page.locator('.card').screenshot({path:artifact('layout-stress-'+width+'-'+index+'.png')});
  }
 }
 // Use real input events for custom tint, including read-only review mode.
 await page.locator('[data-appearance="mode"]').selectOption('NEON');
 await page.locator('[data-appearance="tint"]').evaluate(input=>{input.value='#b7ff40';input.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.evaluate(()=>skeleton3d.get('P1_BODY').setReadOnly(true));
 await page.locator('[data-appearance="mode"]').selectOption('CLINICAL');await page.locator('[data-appearance="mode"]').selectOption('NEON');
 check('appearance controls remain available during read-only review',await page.evaluate(baseline=>skeleton3d.get('P1_BODY').widget.appearance.color==='#b7ff40'&&JSON.stringify(skeleton3d.get('P1_BODY').value())===baseline,baseline));
 await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;w.workspace.setSplit(56);w.home(false);});
 await page.locator('.card').screenshot({path:artifact('neon-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.home(false));await page.locator('.card').screenshot({path:artifact('neon-phone.png')});
 check('clinical colors restore after repeated neon switching',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');a.setColorMode('CLINICAL');const w=a.widget,m=w.model.meshes.find(mesh=>mesh.userData.kind==='bone'&&mesh.visible&&!w.sites.some(site=>w.matches(site,mesh.userData)));return w.appearance.materials.size===0&&(!m||m.material.emissiveIntensity===1); }));
 // Replace the widget repeatedly to catch stale handlers and disposed resources.
 await page.setViewportSize({width:1440,height:1000});
 for(let index=0;index<4;index++){
  check('destroy/reinitialize cycle '+(index+1),await page.evaluate(index=>{const a=skeleton3d.get('P1_BODY'),old=a.widget,value=a.value();a.destroy();document.getElementById('P1_BODY').value=JSON.stringify(value);const next=skeleton3d.init('P1_BODY',{colorMode:index%2?'NEON':'CLINICAL',modelTools:'ALL',examMode:'OPTIONAL'});return old.destroyed&&old.appearance.materials.size===0&&old.eventHandlers.length===0&&next.value().sites.length===3;},index));
  await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.ready);
 }
 check('layout and appearance stress produces no uncaught exceptions',errors.length===0);
 check('layout and appearance stress produces no console errors',consoleErrors.length===0);
}finally{
 fs.mkdirSync('qa/out',{recursive:true});fs.writeFileSync(artifact('layout-stress.json'),JSON.stringify({engine,results,errors,consoleErrors},null,2)+'\n');await browser.close();
}
console.log(results.length+' layout and appearance stress checks passed');
