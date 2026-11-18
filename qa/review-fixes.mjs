import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {readPayload} from '../src/payload.js';
import {normalizeSex} from '../src/anatomy-contract.js';

const checks=[];
function check(name,result){assert.ok(result,name);checks.push(name);console.log('ok   '+name);}
for(const sex of ['',null,'U','Other','Unknown','invalid'])assert.equal(normalizeSex(sex),'U');
assert.equal(normalizeSex('Female'),'F');assert.equal(normalizeSex(' male '),'M');
for(const site of [{area:'HEART',bone:'FEMUR'},{area:'THIGH',side:'L',part:'MITRAL_VALVE'},{area:'THIGH',side:'L',bone:'FEMUR',part:'SCIATIC_NERVE'},{area:'KNEE',part:'PATELLA'}])assert.throws(()=>readPayload({sites:[site]}),/anatomical|different bones/);
assert.equal(readPayload({sex:'U',sites:[{area:'HEART'}]}).sex,'U');
assert.throws(()=>readPayload({sex:'U',sites:[{area:'PROSTATE'}]}),/incompatible/);
check('unknown sex and bone/part relationships are validated',true);

const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',error=>errors.push(error.stack||String(error)));
 async function open(options={}){
  await page.goto(pathToFileURL('demo/demo.html').href);
  await page.evaluate(options=>{skeleton3d.get('P1_BODY').destroy();document.getElementById('P1_BODY').value='';skeleton3d.init('P1_BODY',options);},options);
  await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.ready);
 }
 await open();
 check('API requires an explicit side and leaves the record unchanged otherwise',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');return a.select('KNEE')===null&&a.select('KNEE','bad')===null&&a.value().sites.length===0&&a.select('KNEE','R')==='Right knee'&&a.value().sites[0].side==='R';}));
 check('unknown API sex is explicit and hides sex-specific anatomy',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');a.clear();a.setSex('Other');return a.value().sex==='U'&&a.select('PROSTATE')===null&&!a.widget.sexWarning.hidden&&!a.widget.model.meshes.some(mesh=>mesh.userData.area==='PROSTATE');}));
 await open({sex:'F',sexLocked:true,sexSwitch:false});
 check('historical sex mismatch remains visible and blocks edits pending explicit amendment',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');a.select('HEART');a.setSex('M');const locked=a.widget.sex==='F';a.load({sex:'M',sites:[{area:'PROSTATE'}]});return locked&&a.widget.sexMismatch&&!!a.widget.patientContext.validationMessage()&&a.value().sites.length===1;}));
 check('runtime read-only mode removes the input from form submission',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY'),input=document.getElementById('P1_BODY');a.setReadOnly(true);const excluded=!input.hasAttribute('name');a.setReadOnly(false);return excluded&&input.name==='P1_BODY';}));
 await open({sex:'M',sexLocked:false,readOnly:true});
 check('read-only review restores the recorded sex from a historical record',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');a.load({sex:'F',sites:[{area:'KIDNEY',side:'L'}]});return a.widget.sex==='F'&&a.value().sites.length===1&&!a.widget.valueError&&a.select('HEART')===null;}));
 await open({contextSourceType:'SQL',contextSourceError:'Source unavailable'});
 check('optional patient-source outages warn and permit findings',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');return !a.widget.patientContext.validationMessage()&&a.select('HEART')==='Heart'&&document.querySelector('.sk3-context-error').textContent.includes('unavailable');}));
 await open({contextSourceType:'SQL',contextSourceError:'Source unavailable',contextOptions:{patientDataRequired:true}});
 check('required patient-source outages block recording',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');return a.select('HEART')===null&&!!a.widget.patientContext.validationMessage();}));
 await open({});
 check('clinic requests share an in-flight cache and refresh after expiry',await page.evaluate(async()=>{const c=skeleton3d.get('P1_BODY').widget.clinic;let calls=0;c.termCache.clear();c.w.opts.clinicTransport=async()=>{calls++;return {rows:[]};};await Promise.all([c.terms('DIAGNOSIS',['HEART']),c.terms('DIAGNOSIS',['HEART'])]);await c.terms('DIAGNOSIS',['HEART']);const cached=calls===1;for(const row of c.termCache.values())row.expires=0;await c.terms('DIAGNOSIS',['HEART']);return cached&&calls===2;}));
 check('failed clinic terms retain standard diagnoses and can retry',await page.evaluate(async()=>{const w=skeleton3d.get('P1_BODY').widget;w.clinic.termCache.clear();let calls=0;w.opts.clinicTransport=async()=>{calls++;throw Error('Temporary outage');};const rows=await w.dxFor(['HEART']);await w.dxFor(['HEART']);return rows.length>0&&calls===2&&w.root.querySelector('.sk3-clinic-status').textContent.includes('Standard suggestions remain available');}));
 await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.runSearch('I50'));
 await page.waitForFunction(()=>document.querySelector('.sk3-search-status').textContent.includes('Some results'));
 check('a failed clinic complaint search preserves standard diagnosis results',await page.locator('.sk3-results [data-res="d"]').count()>0);
 await open({clinicPermissions:'TERMS:EXAM_SETUP'});
 check('blocked browser storage reports failed saves without uncaught exceptions',await page.evaluate(async()=>{const c=skeleton3d.get('P1_BODY').widget.clinic,original=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new DOMException('Blocked','SecurityError');};try{let rejected=0;for(const [action,data] of [['CLINIC_CREATE',{kind:'DIAGNOSIS',label:'Fictional test',area:'HEART'}],['CLINIC_CONFIGURE',{...c.definition}]]){try{await c.request(action,data);}catch(error){if(error.message.includes('not saved'))rejected++;}}return rejected===2;}finally{Storage.prototype.setItem=original;}}));
 await page.emulateMedia({colorScheme:'dark'});
 await page.waitForFunction(()=>skeleton3d.get('P1_BODY').widget.root.dataset.theme==='dark');
 check('dark mode supplies readable controls and a dark viewer palette',await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget,s=getComputedStyle(w.root);return w.root.dataset.theme==='dark'&&s.getPropertyValue('--sk3-bg').trim()==='#1c2430'&&s.getPropertyValue('--sk3-fg').trim()==='#e5eaf1';}));
 await page.locator('.card').screenshot({path:'qa/out/review-fixes-dark.png'});
 await page.setViewportSize({width:390,height:844});
 check('dark phone layout fits the viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('.card').screenshot({path:'qa/out/review-fixes-mobile.png'});
 check('review fixes produce no browser exceptions',errors.length===0);
}finally{await browser.close();}
fs.mkdirSync('qa/out',{recursive:true});fs.writeFileSync('qa/out/review-fixes.json',JSON.stringify({checks,errors},null,2)+'\n');
console.log(checks.length+' review regression checks passed');
