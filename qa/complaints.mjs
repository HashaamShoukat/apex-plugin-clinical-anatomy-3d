import { AREAS, SPECIALTIES, COMPLAINTS, complaintsForSpecialty } from '../src/catalog.js';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const check=(name,value)=>{assert.ok(value,name);console.log('ok   '+name);};
check('complaint IDs are unique',new Set(COMPLAINTS.map(c=>c.id)).size===COMPLAINTS.length);
check('every complaint has supported anatomical choices',COMPLAINTS.every(c=>c.areas.length&&c.areas.every(a=>AREAS.some(x=>x.id===a))));
check('specialty tags reference supported specialties',COMPLAINTS.every(c=>!c.specialties||c.specialties.every(id=>SPECIALTIES.some(s=>s.id===id))));
const counts=Object.fromEntries(SPECIALTIES.map(s=>[s.id,complaintsForSpecialty(s.id).length]));
check('every specialty has a useful complaint selection',Object.values(counts).every(count=>count>=5));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(pathToFileURL('demo/demo.html').href);
 await page.waitForFunction(()=>window.skeleton3d?.get('P1_BODY'));
 for(const specialty of SPECIALTIES){
  await page.evaluate(id=>{const a=skeleton3d.get('P1_BODY');a.clear();a.setSpecialty(id);},specialty.id);
  const ids=await page.locator('[data-complaint]').evaluateAll(nodes=>nodes.map(n=>n.dataset.complaint));
  check(specialty.name+' renders its complete filtered complaint list',ids.length===counts[specialty.id]&&complaintsForSpecialty(specialty.id).every(c=>ids.includes(c.id)));
 }
 await page.evaluate(()=>skeleton3d.get('P1_BODY').setSpecialty('PULMONOLOGY'));
 check('pulmonology includes respiratory symptoms and excludes urinary complaints',await page.locator('[data-complaint="COUGH"]').count()===1&&await page.locator('[data-complaint="DYSURIA"]').count()===0);
 await page.locator('.sk3-search-in').fill('wheezing');
 check('search uses the same specialty-filtered complaint catalog',await page.locator('[data-search-type="c"]').count()>0||await page.locator('.sk3-results').innerText().then(t=>t.includes('Wheezing')));
 await page.evaluate(()=>skeleton3d.get('P1_BODY').setSpecialty('GASTROENTEROLOGY'));
 await page.locator('[data-complaint="CONSTIPATION"]').click();
 check('standard mode saves the selected complaint with a stable code',await page.evaluate(()=>{const v=skeleton3d.get('P1_BODY').value();return v.v===2&&v.sites[0].complaints[0].code==='CONSTIPATION'&&v.sites[0].complaints[0].system==='COMPLAINT';}));
 const saved=await page.evaluate(()=>skeleton3d.get('P1_BODY').value());await page.evaluate(v=>skeleton3d.get('P1_BODY').load(v),saved);
 check('saved complaint restores visibly',await page.locator('.sk3-clinic-selected').innerText().then(t=>t.includes('Constipation')));
 await page.locator('[data-clinic="remove-complaint"]').click();
 check('selected complaint can be removed',await page.evaluate(()=>!skeleton3d.get('P1_BODY').value().sites[0].complaints?.length));
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');a.clear();a.setSpecialty('UROLOGY');});
 check('expanded complaint lists fit phone width',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 check('no browser errors',errors.length===0);
 fs.writeFileSync('qa/out/complaint-coverage.json',JSON.stringify({total:COMPLAINTS.length,counts,errors},null,2));
}finally{await browser.close();}
