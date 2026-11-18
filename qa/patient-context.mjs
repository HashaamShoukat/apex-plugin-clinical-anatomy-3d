import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const context={patient:{name:'Demo patient <test>',mrn:'DEMO-001',age:42},observations:[
 {id:'bp_systolic',label:'Systolic BP',value:126,unit:'mmHg',source:'Nursing intake',recordedBy:'Demo nurse',recordedAt:'2026-11-17T09:15:00+03:00'},
 {id:'bp_diastolic',label:'Diastolic BP',value:78,unit:'mmHg',source:'Nursing intake'},
 {id:'pulse',label:'Pulse',value:82,unit:'beats/min',source:'Nursing intake'},
 {id:'temperature',label:'Temperature',value:36.8,unit:'\u00b0C',readOnly:true,source:'Nursing intake'},
 {id:'weight',label:'Weight',value:72,unit:'kg',highlight:true,flag:'Review',source:'Nursing intake'}
]};
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[],errors=[];
const check=(name,ok)=>{assert.ok(ok,name);results.push(name);console.log('ok   '+name);};
const url=pathToFileURL('demo/demo.html').href;
try {
 const page=await browser.newPage({viewport:{width:1366,height:900}});page.on('pageerror',e=>errors.push(String(e)));
 const open=async(data=context,options={})=>{
  await page.goto(url+'?tools=ALL&exam=OPTIONAL&scope=PATIENTCTX'+Date.now()+'&context='+encodeURIComponent(JSON.stringify(data))+'&contextOptions='+encodeURIComponent(JSON.stringify(options)));
  await page.waitForFunction(()=>skeleton3d.get('P1_BODY').widget.clinic.loaded);
 };
 await open();
 check('identity, MR number, age and nursing observations display safely',await page.locator('.sk3-patient-identity').innerText().then(t=>t.includes('Demo patient <test>')&&t.includes('DEMO-001')&&t.includes('42')) && await page.locator('.sk3-patient-context test').count()===0 && await page.locator('[data-observation]').count()===5);
 check('explicit highlight includes a visible flag',await page.locator('[data-observation="weight"].is-highlighted').innerText().then(t=>t.includes('Review')));
 check('empty exam values are prefilled with source provenance',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY').value().exam.answers;return a.pulse.value===82&&a.bp_systolic.value===126&&a.bp_systolic.prefill.recordedBy==='Demo nurse';}));
 check('identity snapshots are optional and off by default',await page.evaluate(()=>!skeleton3d.get('P1_BODY').value().context));
 check('vital prefills do not claim a complete physical examination',await page.locator('.sk3-topbar [data-clinic="show-exam"]').innerText().then(t=>!t.includes('Complete')));
 check('vital prefills do not bypass a required examination',await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;w.opts.examMode='REQUIRED';const blocked=w.clinic.isBlocked();w.opts.examMode='OPTIONAL';return blocked&&!w.exam.answers.general;}));
 await page.locator('.sk3-topbar [data-clinic="show-exam"]').click();
 check('prefilled exam fields are visibly identified',await page.locator('[data-exam-field="pulse"].is-prefilled .sk3-prefill-source').innerText().then(t=>t.includes('Nursing intake')));
 check('configured nursing values can be read only',await page.locator('[data-exam-value="temperature"]').isDisabled());
 await page.locator('[data-exam-value="pulse"]').fill('91');
 await page.evaluate(data=>{const w=skeleton3d.get('P1_BODY').widget;w.opts.contextData=data;w.patientContext.refresh(false);},context);
 check('refreshing context preserves clinician edits',await page.locator('[data-exam-value="pulse"]').inputValue()==='91' && await page.evaluate(()=>!skeleton3d.get('P1_BODY').value().exam.answers.pulse.prefill));
 await page.locator('[data-clinic="close-exam"]').first().click();
 const saved=await page.evaluate(()=>skeleton3d.get('P1_BODY').value());
 await page.evaluate(value=>skeleton3d.get('P1_BODY').load(value),saved);
 check('saved prefill provenance survives reload',await page.evaluate(()=>skeleton3d.get('P1_BODY').value().exam.answers.temperature.prefill.locked));
 await open(context,{fields:['mrn','observations'],observationIds:['pulse'],labels:{mrn:'Record'},prefillExam:false});
 check('visibility, labels and observation selection are configurable',await page.locator('.sk3-patient-identity').innerText().then(t=>t.includes('Record')&&!t.includes('Demo patient')&&!t.includes('Age')) && await page.locator('[data-observation]').count()===1);
 check('prefill can be disabled independently of display',await page.evaluate(()=>!skeleton3d.get('P1_BODY').value().exam));
 await open(context,{saveContext:true});
 check('patient summary has no separate refresh action or amendment dialog',await page.locator('[data-patient="use-current"],[data-patient="confirm-refresh"],[name="refresh-note"]').count()===0);
 await page.evaluate(()=>skeleton3d.get('P1_BODY').select('HEART'));
 const snapshot=await page.evaluate(()=>skeleton3d.get('P1_BODY').value());
 check('opted-in patient snapshot is saved with anatomy',snapshot.context.patient.mrn==='DEMO-001'&&snapshot.context.observations.length===5);
 await page.evaluate(()=>(()=>{const w=skeleton3d.get('P1_BODY').widget;w.opts.contextData={patient:{name:'Another patient',mrn:'OTHER'},observations:[]};w.patientContext.refresh(false);})());
 await page.evaluate(value=>skeleton3d.get('P1_BODY').load(value),snapshot);
 check('saved patient identity takes precedence when reopening records',await page.locator('.sk3-patient-identity').innerText().then(t=>t.includes('DEMO-001')&&!t.includes('Another patient')));
 await page.evaluate(()=>skeleton3d.get('P1_BODY').setReadOnly(true));
 const before=await page.evaluate(()=>JSON.stringify(skeleton3d.get('P1_BODY').value()));
 await page.evaluate(()=>skeleton3d.get('P1_BODY').refreshContext());
 check('read-only context refresh preserves the entire saved document',await page.evaluate(()=>JSON.stringify(skeleton3d.get('P1_BODY').value()))===before);
 await page.setViewportSize({width:390,height:844});
 check('patient summary fits a phone without horizontal page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'qa/out/patient-context-phone.png',fullPage:true});
 await page.setViewportSize({width:1366,height:900});
 await open({...context,observations:[{id:'temperature',label:'Temperature',value:98.6,unit:'F'}]});
 check('mismatched units are displayed without silently converting or prefilling',await page.locator('[data-observation="temperature"]').isVisible() && await page.evaluate(()=>!skeleton3d.get('P1_BODY').value().exam));
 await open(context,{saveContext:true});
 await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY');a.load({v:2,sites:[],exam:{template:'GENERAL',version:a.widget.clinic.definition.version,profile:a.widget.clinic.definition.profile,answers:{weight:{value:'',note:'Await repeat measurement'},pulse:{deferred:true,note:'Not measured'}}}});});
 check('prefill preserves documented deferrals and existing notes',await page.evaluate(()=>{const a=skeleton3d.get('P1_BODY').value().exam.answers;return a.pulse.deferred&&a.pulse.value===undefined&&a.weight.value==='';}));
 await page.locator('.sk3-topbar [data-clinic="show-exam"]').click();
 await page.screenshot({path:'qa/out/patient-prefill-exam.png',fullPage:true});
 await page.locator('[data-clinic="close-exam"]').first().click();
 await page.screenshot({path:'qa/out/patient-context-desktop.png'});
 const stable=await page.evaluate(()=>JSON.stringify(skeleton3d.get('P1_BODY').value()));
 const rejected=await page.evaluate(()=>{try{skeleton3d.get('P1_BODY').load({v:2,sites:[],context:{patient:{age:'bad'}}});return false;}catch(_){return true;}});
 check('invalid context rejects atomically without erasing the record',rejected&&await page.evaluate(()=>JSON.stringify(skeleton3d.get('P1_BODY').value()))===stable);
 await page.evaluate(()=>{const input=document.getElementById('P1_BODY'),preview=document.createElement('pre');preview.id='preview-test';document.body.append(preview);skeleton3d.attachJsonPreview('P1_BODY','preview-test');input.value='invalid JSON';input.dispatchEvent(new Event('change'));});
 check('malformed preview data gives feedback without a JavaScript exception',await page.locator('#preview-test').innerText().then(t=>t.includes('not valid JSON')));
 check('missing preview elements are harmless',await page.evaluate(()=>typeof skeleton3d.attachJsonPreview('MISSING','ABSENT')==='function'));
 check('patient context has no uncaught browser errors',errors.length===0);
}finally {fs.writeFileSync('qa/out/patient-context-report.json',JSON.stringify({results,errors},null,2));await browser.close();}
