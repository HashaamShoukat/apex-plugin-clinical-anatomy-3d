import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {examErrors,normalizeMarker,GENERAL_EXAM,siteKey} from '../src/clinical-value.js';
import {LIMITS} from '../src/limits.js';

const checks=[],errors=[];
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('ok   '+name);};
const text={fields:[{id:'text',type:'text',label:'Text'}]};
assert.equal(examErrors(text,{text:{value:'x'.repeat(LIMITS.examText)}}).length,0);
assert.ok(examErrors(text,{text:{value:'x'.repeat(LIMITS.examText+1)}}).length);
assert.ok(examErrors(text,{retired:{value:'hidden'}}).some(error=>error.includes('Removed')));
assert.equal(examErrors({fields:[{id:'text',type:'textarea',label:'Text'}]},{text:{value:'x'.repeat(2000)}}).length,0);
const marker={kind:'POINT',points:[[0.123456789,1,0]],diagnosis:null};
assert.deepEqual(normalizeMarker(marker),marker);
assert.equal(siteKey({bone:'FEMUR',side:'L'}),'P|FEMUR|L');
check('limits, retired keys, optional marker fields and structure keys share their contracts',true);

const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',error=>errors.push(String(error)));
 async function open(options={}){
  await page.goto(pathToFileURL('demo/demo.html').href);
  await page.addScriptTag({path:'node_modules/jquery/dist/jquery.js'});
  await page.evaluate(({options,definition})=>{
   skeleton3d.get('P1_BODY').destroy();localStorage.clear();document.getElementById('P1_BODY').value='';
   const registrations={};
   const native=id=>({getValue:()=>document.getElementById(id)?.value || '',setValue:value=>{document.getElementById(id).value=value;}});
   window.apex={jQuery,env:{APP_ID:'REVIEW18'},item:id=>registrations[id]||native(id)};
   apex.item.create=(id,implementation)=>{registrations[id]={...native(id),...implementation};};
   window.patientResponse={patient:{id:'P1',mrn:'MR1',sex:'M'},observations:[{id:'pulse',value:90,unit:'beats/min',readOnly:true}]};
   window.catalogRows=[{id:901,source:'CUSTOM',code:'LOCAL-901',system:'LOCAL',label:'Local heart complaint',areas:['HEART'],links:[{area:'HEART'}]}];
   apex.server={plugin:(id,data,callbacks)=>callbacks.success(data.x01==='PATIENT_CONTEXT'?{contextData:window.patientResponse}:data.x01==='CLINIC_LOAD'?{template:definition,version:0}:{rows:window.catalogRows})};
   skeleton3d.init('P1_BODY',{modelTools:'ALL',...options});
  },{options,definition:{...GENERAL_EXAM,version:0}});
  await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.ready);
 }
 await open({specialty:'CARDIOLOGY',specialtySwitch:false});
 check('full anatomy, reveal and outside focus retain a fixed specialty',await page.evaluate(()=>{
  const a=skeleton3d.get('P1_BODY');a.widget.modelTools.reveal();a.focus('KIDNEY','L');a.setSpecialty('ALL');
  return a.widget.specialty.id==='CARDIOLOGY'&&a.select('KIDNEY','L')===null;
 }));
 check('every model mesh uses BVH raycasting',await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.model.meshes.every(mesh=>mesh.geometry.boundsTree)));
 await page.evaluate(()=>{const spacer=document.createElement('div');spacer.style.height='1200px';document.querySelector('.card').before(spacer);skeleton3d.get('P1_BODY').widget.workspace.fitViewport();});
 const height=await page.locator('.sk3-stage').evaluate(node=>node.getBoundingClientRect().height);
 await page.evaluate(()=>scrollTo(0,700));
 await page.waitForTimeout(100);
 check('scroll does not change a below-fold viewer height',await page.locator('.sk3-stage').evaluate((node,height)=>node.getBoundingClientRect().height===height,height));
 await open();
 check('invalid APEX setValue reports an error and allows the Dynamic Action to continue',await page.evaluate(()=>{
  const a=skeleton3d.get('P1_BODY');a.select('HEART');const before=JSON.stringify(a.value());let continued=false;
  apex.item('P1_BODY').setValue('{bad json');continued=true;
  const blocked=!apex.item('P1_BODY').getValidity().valid;
  const same=JSON.stringify(a.value())===before;
  apex.item('P1_BODY').setValue(before);
  return continued&&blocked&&same&&apex.item('P1_BODY').getValidity().valid;
 }));
 check('loading a record without sex resets to the configured default',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');a.load({sex:'F',sites:[]});a.load({sites:[{area:'HEART'}]});return a.widget.sex==='M';}));
 await open({sex:'U'});
 check('unconfirmed sex rejects prostate even when the payload omits sex',await page.evaluate(()=>{try{skeleton3d.get('P1_BODY').load({sites:[{area:'PROSTATE'}]});return false;}catch(_){return true;}}));
 await open();
 check('plain HTTP marker IDs stay unique in the same millisecond',await page.evaluate(()=>{
  const a=skeleton3d.get('P1_BODY');a.select('HEART');const w=a.widget,site=w.sites[0],now=Date.now;
  const cryptoDescriptor=Object.getOwnPropertyDescriptor(window,'crypto');
  try{Object.defineProperty(window,'crypto',{value:{},configurable:true});Date.now=()=>42;for(let i=0;i<20;i++)w.modelTools.addMarker(site,[[0,1,0]],'POINT');}
  finally{Date.now=now;Object.defineProperty(window,'crypto',cryptoDescriptor);}
  return new Set(site.markers.map(marker=>marker.id)).size===20;
 }));
 await page.locator('[data-pain="5"]').focus();await page.locator('[data-pain="5"]').press('Enter');
 check('pain edits retain keyboard focus',await page.evaluate(()=>document.activeElement.dataset.pain==='5'));
 await open({examMode:'OPTIONAL'});
 check('examination text and textarea controls match shared limits',await page.evaluate(()=>{
  const c=skeleton3d.get('P1_BODY').widget.clinic;c.definition.fields.push({id:'short_text',type:'text',label:'Short text'});c.renderExam();
  return c.examRoot.querySelector('[data-exam-value="short_text"]').maxLength===500&&c.examRoot.querySelector('textarea[data-exam-value]').maxLength===2000;
 }));
 check('retired answers are visible, block save and require explicit removal',await page.evaluate(()=>{
  const w=skeleton3d.get('P1_BODY').widget;w.exam={version:0,profile:w.clinic.definition.profile,answers:{retired:{value:'Historical'}}};w.clinic.renderExam();
  const shown=w.clinic.examRoot.textContent.includes('Historical')&&w.clinic.validate().some(error=>error.includes('Removed'));
  w.clinic.examRoot.querySelector('[data-clinic="remove-retired"]').click();return shown&&!('retired' in w.exam.answers);
 }));
 check('custom save request names receive client validation',await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;w.exam={version:0,profile:w.clinic.definition.profile,answers:{pulse:{value:999}}};return jQuery(document).triggerHandler('apexbeforepagesubmit',['COMPLETE_VISIT'])===false;}));
 await open({examMode:'OPTIONAL',contextSourceType:'SQL',contextOptions:{saveContext:true}});
 await page.evaluate(()=>{
  const w=skeleton3d.get('P1_BODY').widget;
  w.setValue({sex:'M',sites:[{area:'HEART'}],context:{patient:{id:'P1',mrn:'MR1',sex:'M'},observations:[{id:'pulse',value:70,unit:'beats/min',readOnly:true}]},exam:{version:0,profile:w.clinic.definition.profile,answers:{pulse:{value:70,note:'Keep this note',prefill:{source:'Supplied observation',locked:true}},weight:{value:72}}}},true);
 });
 await page.evaluate(()=>skeleton3d.get('P1_BODY').refreshContext());
 await page.waitForFunction(()=>skeleton3d.get('P1_BODY').value().context?.observations[0]?.value===90);
 check('explicit patient refresh updates saved snapshot and locked values while preserving clinician data',await page.evaluate(()=>{const value=skeleton3d.get('P1_BODY').value();return value.exam.answers.pulse.value===90&&value.exam.answers.pulse.note==='Keep this note'&&value.exam.answers.weight.value===72&&value.contextRefresh.note==='Patient data refreshed by application';}));
 check('patient refresh rejects switching identity',await page.evaluate(async()=>{const w=skeleton3d.get('P1_BODY').widget;const before=w.serialize();window.patientResponse.patient.id='P2';return await skeleton3d.get('P1_BODY').refreshContext()===false&&w.serialize()===before;}));
 check('changing to None has an explicit path to save without historical source claims',await page.evaluate(async()=>{const w=skeleton3d.get('P1_BODY').widget;w.patientContext.sourceType='NONE';await skeleton3d.get('P1_BODY').refreshContext();const v=skeleton3d.get('P1_BODY').value();return !v.context&&!v.exam.answers.pulse.prefill&&v.exam.answers.pulse.value===90;}));
 await open({sex:'F',sexLocked:true});
 check('sex correction remains amendable after removing incompatible findings',await page.evaluate(async()=>{const w=skeleton3d.get('P1_BODY').widget;w.setValue({sex:'M',sites:[{area:'PROSTATE'}]},true);w.removeSite(w.keyOf(w.sites[0]));w.patientContext.sourceType='NONE';await skeleton3d.get('P1_BODY').refreshContext();return !w.sexMismatch&&w.sex==='F'&&!w.sites.length;}));
 await open({ajaxId:'FAKE',dxSource:'TABLE',complaints:true,examMode:'OFF'});
 check('APEX default complaints come from the shared table and retain catalogue identity',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');const rows=a.complaints();a.complaint('LOCAL-901');return rows.length===1&&rows[0].name==='Local heart complaint'&&a.value().sites[0].complaints[0].id===901;}));
 check('removed patient source API is absent',await page.evaluate(()=>!('setContext' in skeleton3d.get('P1_BODY'))));
 check('painting many recorded sites uses the mesh index rather than repeated site scans',await page.evaluate(()=>{
  const w=skeleton3d.get('P1_BODY').widget;
  const byKey=new Map();for(const mesh of w.model.meshes){const d=mesh.userData;if(d.kind==='dark')continue;const site={area:d.area,part:d.part||d.base,partName:d.name,side:d.side||null,diagnoses:[],markers:[]};byKey.set(w.keyOf(site),site);}
  w.sites=[...byKey.values()];w.active=w.keyOf(w.sites[0]);let calls=0;const matches=w.matches;
  try{w.matches=function(...args){calls++;return matches.apply(this,args);};w.paint();}finally{w.matches=matches;}
  return w.sites.length>100&&calls<w.model.meshes.length*5;
 }));
 await page.emulateMedia({colorScheme:'dark'});
 check('APEX page theme follows the light page while System follows the dark OS',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');a.setTheme('apex');const light=a.widget.root.dataset.theme==='light';a.setTheme('auto');return light&&a.widget.root.dataset.theme==='dark';}));
 check('appearance choices survive widget recreation',await page.evaluate(async()=>{const a=skeleton3d.get('P1_BODY');a.setColorMode('NEON');a.setNeonColor('#ff5533');a.widget.sites=[];a.widget.commit();a.destroy();skeleton3d.init('P1_BODY',{});const w=skeleton3d.get('P1_BODY').widget;await w.clinic.ready;return w.appearance.mode==='NEON'&&w.appearance.color==='#ff5533'&&w.opts.theme==='auto';}));
 check('review regressions have no uncaught browser errors',errors.length===0);
}finally{await browser.close();fs.writeFileSync('qa/out/review-1.8.json',JSON.stringify({checks,errors},null,2)+'\n');}
console.log(checks.length+' review 1.8 checks passed');
