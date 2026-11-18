import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { readPayload } from '../src/payload.js';
import { GENERAL_EXAM } from '../src/clinical-value.js';
import { fillRequiredExam } from './exam-helpers.mjs';

const checks = [];
function check(name, result) {
    assert.ok(result, name);
    checks.push(name);
    console.log('ok   ' + name);
}
const duplicate = {v:2,sex:'M',sites:[{area:'THIGH',side:'L',bone:'FEMUR'},{area:'THIGH',side:'L',part:'FEMUR'}]};
assert.throws(() => readPayload(duplicate), /duplicates/);
assert.throws(() => readPayload({v:2,sex:'F',sites:[{area:'PROSTATE'}]}), /incompatible/);
check('payload rejects duplicate bone/part findings and incompatible anatomy', true);
for (const document of [
    {sites:[{area:'HEART',diagnoses:Array.from({length:101},(_,i)=>({code:String(i),label:'Example'}))}]},
    {sites:[{area:'HEART',markers:Array.from({length:101},(_,i)=>({id:String(i),kind:'POINT',points:[[0,1,0]]}))}]},
    {sites:[],exam:{answers:{extra:{value:'a'.repeat(2001)}}}},
    {sites:[],exam:{answers:Object.fromEntries(Array.from({length:101},(_,i)=>['extra'+i,{value:true}]))}},
    {sites:[],extra:'a'.repeat(1048576)}
]) { assert.throws(() => readPayload(document)); }
check('payload bounds apply to terms, markers, historical exam values and document size', true);
assert.equal(readPayload({sites:[{area:'HEART',pain:6.5}]}).sites[0].pain,6.5);
check('fractional pain is preserved', true);

const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const browserErrors = [];
try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',error=>browserErrors.push(String(error)));
    async function open(options = {}) {
        await page.goto(pathToFileURL('demo/demo.html').href);
        await page.addScriptTag({path:'node_modules/jquery/dist/jquery.js'});
        await page.evaluate(({options,definition}) => {
            skeleton3d.get('P1_BODY').destroy();
            const itemInput=document.getElementById('P1_BODY'); itemInput.value='';
            const specialty=document.createElement('input');specialty.id='P1_SPECIALTY';specialty.value='ALL';document.body.prepend(specialty);
            const registrations={};
            function nativeItem(id) {
                const node=document.getElementById(id);
                return {node,getValue:()=>node.value,setValue:(value,display,suppress)=>{node.value=value;if(!suppress){jQuery(node).trigger('change');}}};
            }
            window.apex={jQuery,env:{APP_ID:'TEST'},item:id=>registrations[id] || nativeItem(id)};
            apex.item.create=(id,implementation)=>{
                const native=nativeItem(id);
                registrations[id]={...native,...implementation,setValue(value,display,suppress){
                    if(implementation.setValue){implementation.setValue(value,display,suppress);}else{native.node.value=value;}
                    if(!suppress){jQuery(native.node).trigger('change');}
                }};
            };
            window.$s=(id,value,display,suppress)=>apex.item(id).setValue(value,display,suppress);
            window.testChanges=0;window.testPluginChanges=0;
            jQuery(itemInput).on('change.test',()=>window.testChanges++).on('skeleton3dchange.test',()=>window.testPluginChanges++);
            const opts={modelTools:'ALL',height:620,...options};
            if(options.failExam){
                let attempts=0;
                opts.clinicTransport=async action=>action==='CLINIC_LOAD' ? (++attempts===1 ? {error:'The examination service is unavailable.'} : {template:definition,version:definition.version}) : {rows:[]};
            }
            skeleton3d.init('P1_BODY',opts);
        },{options,definition:{...GENERAL_EXAM,version:0}});
        await page.waitForFunction(()=>!!skeleton3d.get('P1_BODY')?.widget.model);
        await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.ready);
    }
    await open({specialtyItem:'P1_SPECIALTY'});
    check('APEX Set Value updates specialty through jQuery change',await page.evaluate(()=>{$s('P1_SPECIALTY','CARDIOLOGY');return skeleton3d.get('P1_BODY').widget.specialty.id==='CARDIOLOGY'&&testChanges===0;}));
    check('native specialty changes also work',await page.evaluate(()=>{const input=document.getElementById('P1_SPECIALTY');input.value='UROLOGY';input.dispatchEvent(new Event('change',{bubbles:true}));return skeleton3d.get('P1_BODY').widget.specialty.id==='UROLOGY';}));
    await page.evaluate(()=>{const spacer=document.createElement('div');spacer.id='test-spacer';spacer.style.height='1600px';document.querySelector('.card').before(spacer);skeleton3d.get('P1_BODY').widget.workspace.fitViewport();});
    check('below-fold items retain configured height',await page.locator('.sk3-stage').evaluate(node=>node.getBoundingClientRect().height>=619));
    const stageHeight=await page.locator('.sk3-stage').evaluate(node=>node.getBoundingClientRect().height);
    await page.locator('.sk3-stage').scrollIntoViewIfNeeded();
    check('scrolling preserves the workspace height',await page.locator('.sk3-stage').evaluate((node,height)=>Math.abs(node.getBoundingClientRect().height-height)<1,stageHeight));
    await page.evaluate(()=>{document.getElementById('test-spacer').remove();scrollTo(0,0);});
    check('destroy removes specialty hooks and APEX widget closures',await page.evaluate(()=>{skeleton3d.get('P1_BODY').destroy();return !(jQuery._data(document.getElementById('P1_SPECIALTY'),'events')?.change?.length)&&!apex.item('P1_BODY').getValidity;}));

    await open();
    check('bone and anatomy-browser paths reuse a single site',await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;w.addSite({area:'THIGH',side:'L',bone:'FEMUR',boneName:'Femur'});w.addSite({area:'THIGH',side:'L',part:'FEMUR',partName:'Femur'});return w.sites.length===1;}));
    check('NULL and empty query codes are excluded',await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;const rows=w.normalize([{code:null,label:'Null'},{label:'Missing'},{code:' ',label:'Blank'},{code:'X',label:null},{code:'I50.9',label:'Example'}]);return rows.length===1&&rows[0].code==='I50.9';}));
    await page.evaluate(()=>skeleton3d.get('P1_BODY').load({v:2,sex:'M',sites:[{area:'PROSTATE',note:'Retain until explicitly removed'}]}));
    check('switching sex preserves and explains incompatible findings',await page.evaluate(()=>{const api=skeleton3d.get('P1_BODY');api.setSex('F');return api.widget.sex==='M'&&api.value().sites[0].note==='Retain until explicitly removed'&&api.widget.root.querySelector('.sk3-clinic-status').textContent.includes('prostate');}));
    await page.evaluate(()=>{skeleton3d.get('P1_BODY').clear();skeleton3d.get('P1_BODY').setSex('F');});
    check('sex switching works after incompatible findings are removed',await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.sex==='F'));
    await open({sex:'F'});
    check('sex-less and stale selections respect the configured female model',await page.evaluate(()=>{const api=skeleton3d.get('P1_BODY');let rejected=false;try{api.load({sites:[{area:'PROSTATE'}]});}catch(_){rejected=true;}return rejected&&api.widget.addSite({area:'PROSTATE'})===null&&api.value().sites.length===0;}));
    await page.evaluate(()=>skeleton3d.get('P1_BODY').load({sites:[{area:'HEART',pain:6.5}]}));
    check('loading retains fractional pain',await page.evaluate(()=>skeleton3d.get('P1_BODY').value().sites[0].pain===6.5));

    await open({examMode:'REQUIRED',failExam:true,skipValidationRequests:['CANCEL','DELETE','EXPORT','UNRELATED']});
    check('failed examination load offers retry and retains Required gating',await page.locator('.sk3-clinic-status [data-clinic="retry-exam"]').isVisible()&&await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.isBlocked()));
    check('examination load failure has an examination-specific message',await page.locator('.sk3-clinic-status').innerText().then(text=>text.includes('examination')&&!text.includes('diagnoses')));
    for(const request of ['CANCEL','DELETE','EXPORT','UNRELATED']){
        check(request+' explicitly skips incomplete examination',await page.evaluate(request=>jQuery(document).triggerHandler('apexbeforepagesubmit',[request])!==false&&apex.item('P1_BODY').getValidity().valid,request));
    }
    check('SAVE checks the incomplete examination',await page.evaluate(()=>jQuery(document).triggerHandler('apexbeforepagesubmit',['SAVE'])===false&&!apex.item('P1_BODY').getValidity().valid));
    await page.evaluate(()=>{apex.item('P1_BODY').disable();});
    check('disabled examination allows saving',await page.evaluate(()=>jQuery(document).triggerHandler('apexbeforepagesubmit',['SAVE'])!==false&&apex.item('P1_BODY').getValidity().valid));
    await page.evaluate(()=>{apex.item('P1_BODY').enable();const dialog=document.querySelector('.sk3-exam-dialog');if(dialog.open)dialog.close();});
    await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.openExam());
    check('submission feedback retains an accessible Retry action',await page.locator('.sk3-exam-dialog [data-clinic="retry-exam"]').isVisible());
    await page.locator('.sk3-exam-dialog [data-clinic="retry-exam"]').click();
    await page.waitForFunction(()=>skeleton3d.get('P1_BODY').widget.clinic.loaded);
    check('successful retry loads the examination definition',await page.evaluate(()=>skeleton3d.get('P1_BODY').widget.clinic.loaded));
    await fillRequiredExam(page);
    check('completed retry unlocks required anatomy recording',await page.evaluate(()=>!skeleton3d.get('P1_BODY').widget.clinic.isBlocked()));
    await page.locator('[data-clinic="close-exam"]').first().click();
    await open({examMode:'REQUIRED',failExam:true});
    await page.locator('.sk3-clinic-status [data-clinic="retry-exam"]').click();
    await page.waitForFunction(()=>skeleton3d.get('P1_BODY').widget.clinic.loaded);
    check('Retry button recovers from a transient examination failure',true);
    await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;w.opts.examMode='OPTIONAL';w.exam={version:w.clinic.definition.version,profile:w.clinic.definition.profile,answers:{pulse:{value:999}}};});
    check('Optional range errors affect save requests only',await page.evaluate(()=>jQuery(document).triggerHandler('apexbeforepagesubmit',['DELETE'])!==false&&jQuery(document).triggerHandler('apexbeforepagesubmit',['SAVE'])===false));

    await open({examMode:'OPTIONAL',contextData:{observations:[{id:'pulse',value:82,unit:'beats/min'}]}});
    check('automatic prefill remains clean and produces no change events or undo entries',await page.evaluate(()=>skeleton3d.get('P1_BODY').value().exam.answers.pulse.value===82&&testChanges===0&&testPluginChanges===0&&!apex.item('P1_BODY').isChanged()&&skeleton3d.get('P1_BODY').widget.modelTools.undoValues.length===0));
    check('explicit context updates emit one change and mark the record dirty',await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;w.opts.contextData={observations:[{id:'temperature',value:36.8,unit:'\u00b0C'}]};w.patientContext.refresh(false);return testChanges===1&&testPluginChanges===1&&apex.item('P1_BODY').isChanged();}));
    await page.evaluate(()=>{const api=skeleton3d.get('P1_BODY');api.select('HEART');testChanges=0;api.widget.modelTools.undoValues=[];});
    await page.locator('.sk3-note').focus();
    await page.locator('.sk3-note').pressSequentially('Follow up',{delay:12});
    check('typing batches change events and undo history',await page.evaluate(()=>testChanges===0&&skeleton3d.get('P1_BODY').widget.modelTools.undoValues.length===0));
    await page.waitForFunction(()=>window.testChanges===1);
    check('typing pause commits the complete note once',await page.evaluate(()=>JSON.parse(apex.item('P1_BODY').getValue()).sites[0].note==='Follow up'&&skeleton3d.get('P1_BODY').widget.modelTools.undoValues.length===1));
    await page.locator('.sk3-note').fill('Final note');await page.locator('.sk3-note').blur();
    check('blur flushes the pending note',await page.evaluate(()=>JSON.parse(document.getElementById('P1_BODY').value).sites[0].note==='Final note'));
    check('APEX setValue emits the plug-in event once and respects suppression',await page.evaluate(()=>{testChanges=0;testPluginChanges=0;apex.item('P1_BODY').setValue(JSON.stringify({sites:[{area:'HEART'}]}));const result=testChanges===1&&testPluginChanges===1;apex.item('P1_BODY').setValue(JSON.stringify({sites:[]}),null,true);return result&&testChanges===1&&testPluginChanges===1;}));

    await open();
    await page.locator('[data-model="browser"]').click();
    await page.locator('[data-model-search]').fill('mitral');
    await page.locator('[data-model="structure"]').first().click();
    check('anatomy inspection leaves the patient record untouched',await page.evaluate(()=>skeleton3d.get('P1_BODY').value().sites.length===0));
    await page.locator('[data-model="record-structure"]').click();
    check('explicit structure recording adds the finding',await page.evaluate(()=>skeleton3d.get('P1_BODY').value().sites.length===1));
    await page.locator('[data-model="close-browser"]').click();
    check('hover raycasts are limited to one per animation frame',await page.evaluate(async()=>{const w=skeleton3d.get('P1_BODY').widget;const original=w.onHover;let hits=0;w.onHover=()=>hits++;for(let i=0;i<20;i++){w.canvas.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:30+i,clientY:30}));}await new Promise(requestAnimationFrame);w.onHover=original;return hits===1;}));
    check('label rendering reuses bounds and DOM nodes',await page.evaluate(()=>{const tools=skeleton3d.get('P1_BODY').widget.modelTools;tools.showLabels=true;tools.renderOverlay();const node=tools.overlay.firstChild;let recalculations=0;const geometries=new Set(tools.w.model.meshes.map(mesh=>mesh.geometry));const originals=new Map();for(const geometry of geometries){originals.set(geometry,geometry.computeBoundingBox);geometry.computeBoundingBox=function(){recalculations++;return originals.get(geometry).call(this);};}tools.renderOverlay();const result=recalculations===0&&node===tools.overlay.firstChild;for(const [geometry,original] of originals){geometry.computeBoundingBox=original;}return result;}));
    check('markers reuse geometry and remain stable across hover paints',await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget,tools=w.modelTools,site=w.sites[0];tools.addMarker(site,[[0,1,0]],'POINT');tools.addMarker(site,[[.01,1,0]],'POINT');const markers=tools.markerGroup.children.filter(node=>node.isMesh),first=markers[0];w.paint();return markers.length===2&&markers.every(node=>node.geometry===first.geometry&&node.material===first.material)&&tools.markerGroup.children[0]===first;}));
    await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;w.hit=()=>w.model.meshes.find(mesh=>mesh.userData.area==='HEART').userData;w.viewport.style.width='100px';w.onHover({clientX:1,clientY:1});});
    check('narrow tooltip has a nonnegative horizontal position',await page.locator('.sk3-tip').evaluate(node=>parseFloat(node.style.left)>=0));
    check('organ focus positions the camera relative to its depth',await page.evaluate(()=>{const w=skeleton3d.get('P1_BODY').widget;let result;w.moveTo=(position,target)=>{result=Math.abs(position.z-target.z);};w.focusSite({area:'HEART'});return result>=.55;}));

    await page.goto(pathToFileURL('demo/demo.html').href+'?specialty=CARDIOLOGY&tools=ALL');
    await page.evaluate(()=>skeleton3d.get('P1_BODY').load({v:2,sex:'M',sites:[{area:'HEART',note:'Fictional example for documentation',assessment:'ABNORMAL',diagnoses:[]}]}));
    await page.waitForFunction(()=>!!skeleton3d.get('P1_BODY').widget.model);
    if (process.env.UPDATE_DOC_IMAGES === '1') {
        fs.mkdirSync('docs/images',{recursive:true});
        await page.locator('.card').screenshot({path:'docs/images/clinical-anatomy.png'});
    }
    check('browser regression checks have no uncaught exceptions',browserErrors.length===0);
} finally { await browser.close(); }
fs.mkdirSync('qa/out',{recursive:true});
fs.writeFileSync('qa/out/publishing-fixes.json',JSON.stringify({checks,browserErrors},null,2)+'\n');
console.log(checks.length+' publishing and defect regression checks passed');
