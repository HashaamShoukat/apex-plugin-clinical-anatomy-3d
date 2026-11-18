import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
const attributes=fs.readFileSync('plugin/custom-attributes.apx','utf8');
for(const id of ['08','09','10','13','14'])assert.ok(!attributes.includes('customAttribute attribute_'+id+' ('),'Retired attribute '+id);
assert.ok(!attributes.includes('name: Clinic Mode'));
assert.ok(!attributes.includes('name: Clinic Catalog Scope'));
assert.ok(!attributes.includes('name: Diagnosis Query'));
const checks=[],errors=[];
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('ok   '+name);};
check('Builder contains no catalogue mode, scope or external diagnosis SQL settings',true);
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(pathToFileURL('demo/demo.html').href);
 await page.evaluate(async()=>{
  skeleton3d.get('P1_BODY').destroy();localStorage.clear();document.getElementById('P1_BODY').value='';
  skeleton3d.init('P1_BODY',{clinicPermissions:'TERMS:EXAM_SETUP',clinicScope:'OLD_A',clinicMode:'STANDARD',examMode:'OPTIONAL'});
  await skeleton3d.get('P1_BODY').widget.clinic.ready;
 });
 await page.evaluate(()=>skeleton3d.get('P1_BODY').select('HEART'));
 await page.locator('[data-clinic="new-complaint"]').click();
 await page.locator('[name="clinic-label"]').fill('Fictional shared complaint');
 await page.locator('[name="clinic-code"]').fill('SHARED-CP-1');
 await page.locator('[data-clinic="save-term"]').click();
 await page.waitForFunction(()=>skeleton3d.get('P1_BODY').value().sites[0].complaints?.some(term=>term.code==='SHARED-CP-1'));
 check('Adding a complaint writes to and selects from the one shared base',true);
 await page.evaluate(async()=>{
  const c=skeleton3d.get('P1_BODY').widget.clinic;
  await c.request('CLINIC_CONFIGURE',{...c.definition,title:'Shared examination fixture'});
  const input=document.createElement('textarea');input.id='P2_BODY';input.hidden=true;
  const root=document.createElement('div');root.id='P2_BODY_SK3';root.className='sk3';document.body.append(input,root);
  skeleton3d.init('P2_BODY',{clinicScope:'OLD_B',clinicMode:'CUSTOM',examMode:'OPTIONAL'});
  await skeleton3d.get('P2_BODY').widget.clinic.ready;
 });
 check('Another item sees the same complaint regardless of retired settings',await page.evaluate(async()=>{
  const terms=await skeleton3d.get('P2_BODY').widget.clinic.terms('COMPLAINT',['HEART']);
  const selected=skeleton3d.get('P1_BODY').value().sites[0].complaints.find(term=>term.code==='SHARED-CP-1');
  return terms.some(term=>term.id===selected.id&&term.code===selected.code);
 }));
 check('All items load the same shared examination definition',await page.evaluate(()=>skeleton3d.get('P2_BODY').widget.clinic.definition.title==='Shared examination fixture'));
 check('Shared selection does not grant maintenance rights',await page.evaluate(async()=>{
  const c=skeleton3d.get('P2_BODY').widget.clinic;
  try{await c.request('CLINIC_CREATE',{kind:'DIAGNOSIS',label:'Denied fixture',area:'HEART'});return false;}catch(_){return c.permissions.includes('NONE');}
 }));
 check('Retired scope options create no separate browser catalogue',await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('skeleton3d-clinic-')).join(',')==='skeleton3d-clinic-demo'));
 check('Shared-catalogue flow has no browser exceptions',errors.length===0);
}finally{await browser.close();fs.writeFileSync('qa/out/shared-catalog.json',JSON.stringify({checks,errors},null,2)+'\n');}
