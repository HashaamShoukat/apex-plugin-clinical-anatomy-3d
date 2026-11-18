import {chromium} from 'playwright-core';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PATIENT_PAYLOAD_EXAMPLE} from '../src/patient-contract.js';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[],errors=[];const check=(name,ok)=>{assert.ok(ok,name);results.push(name);console.log('ok   '+name);};
try{
 const page=await browser.newPage({viewport:{width:1366,height:768}});page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(pathToFileURL('demo/demo.html').href+'?tools=ALL&exam=OPTIONAL&scope=SUMMARY'+Date.now()+'&context='+encodeURIComponent(JSON.stringify(PATIENT_PAYLOAD_EXAMPLE)));
 await page.waitForFunction(()=>skeleton3d.get('P1_BODY').widget.clinic.loaded);
 check('paired blood pressure occupies one readable measurement card',await page.locator('[data-observation-group="blood_pressure"]').innerText().then(t=>t.replace(/\s/g,'').includes('126/78mmHg')));
 check('large payload uses six summary cards and offers all observations',await page.locator('.sk3-observation-grid>.sk3-observation').count()===6 && await page.getByRole('button',{name:/View all/}).isVisible());
 for(const width of [1366,1280,1024,390]){
  await page.setViewportSize({width,height:768});
  check('summary and viewer fit width '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const cells=await page.locator('.sk3-observation-grid>.sk3-observation').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().width));
  check('summary distributes cards across available space at '+width,Math.min(...cells)>140);
  await page.screenshot({path:'qa/out/patient-summary-'+width+'.png'});
 }
 await page.setViewportSize({width:1366,height:768});
 const y=await page.locator('.sk3-canvas').evaluate(e=>e.getBoundingClientRect().top);
 await page.locator('[data-patient="details"]').click();
 check('details include custom facts and all nonhidden observations',await page.locator('.sk3-context-dialog').innerText().then(t=>t.includes('Department')&&t.includes('General medicine')&&t.includes('Blood glucose')&&!t.includes('Your custom label')));
 check('details dialog leaves the model layout in place',Math.abs(await page.locator('.sk3-canvas').evaluate(e=>e.getBoundingClientRect().top)-y)<1);
 await page.screenshot({path:'qa/out/patient-summary-details.png'});
 await page.keyboard.press('Escape');check('details close with Escape',!await page.locator('.sk3-context-dialog').isVisible());
 await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');a.widget.opts.contextData={observations:[{id:'missing',label:'Awaiting value',value:null}]};a.widget.patientContext.refresh(false);});
 await page.locator('[data-patient="details"]').click();
 check('null observations stay available as Not recorded in details',await page.locator('.sk3-context-dialog').innerText().then(t=>t.includes('Awaiting value')&&t.includes('Not recorded')));
 await page.keyboard.press('Escape');
 // Mock the transport, retaining the real source/controller validation and UI.
 await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;w.patientContext.overrideSet=false;w.patientContext.sourceType='SQL';w.opts.contextSourceType='SQL';window.pending=[];w.server=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));window.one=w.patientContext.reload();window.two=w.patientContext.reload();pending[1].resolve({contextData:{patient:{name:'Newer patient'}}});});
 await page.waitForFunction(()=>document.querySelector('.sk3-patient-name')?.textContent==='Newer patient');
 await page.evaluate(async()=>{pending[0].resolve({contextData:{patient:{name:'Stale patient'}}});await one;});
 check('late source responses cannot overwrite newer patient data',await page.locator('.sk3-patient-name').innerText()==='Newer patient');
 await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;w.patientContext.config.patientDataRequired=true;window.fail=w.patientContext.reload();pending.at(-1).reject(Error('Example source failure'));});
 await page.waitForFunction(()=>document.querySelector('.sk3-context-error'));
 check('required source failures are visible and block editing with a retry action',await page.locator('[data-patient="retry"]').isVisible()&&await page.evaluate(()=>!skeleton3d.get('P1_BODY').widget.canEdit(false)));
 await page.locator('[data-patient="retry"]').click();await page.evaluate(()=>pending.at(-1).resolve({contextData:{patient:{name:'Recovered patient'}}}));
 await page.waitForFunction(()=>document.querySelector('.sk3-patient-name')?.textContent==='Recovered patient');
 check('retry restores valid patient data and editing',await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.canEdit(false)));
 check('patient summary workflow has no browser errors',errors.length===0);
}finally{fs.writeFileSync('qa/out/patient-summary-report.json',JSON.stringify({results,errors},null,2));await browser.close();}
