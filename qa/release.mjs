import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LIMITS } from '../src/limits.js';
import { AREAS, DIAGNOSES, COMPLAINTS } from '../src/catalog.js';
import { GENERAL_EXAM } from '../src/clinical-value.js';

const read=file=>fs.readFileSync(file,'utf8');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function files(directory,excluded = new Set()) {
    return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
        if(excluded.has(entry.name)){return [];}
        const file=path.join(directory,entry.name);
        return entry.isDirectory()?files(file,excluded):[file];
    }).sort();
}
const sourceFiles=files('.',new Set(['node_modules','dist','out','.git']));
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,digest(file)]));
function build() {
    const result=spawnSync(process.execPath,['build.mjs'],{encoding:'utf8',env:{...process.env,APEX_APP_DIR:''}});
    assert.equal(result.status,0,result.stderr||result.stdout);
}
build();
const outputHashes=Object.fromEntries(files('dist').map(file=>[file,digest(file)]));
build();
assert.deepEqual(Object.fromEntries(files('dist').map(file=>[file,digest(file)])),outputHashes,'Build outputs must be deterministic');
assert.deepEqual(Object.fromEntries(files('.',new Set(['node_modules','dist','out','.git'])).map(file=>[file,digest(file)])),sourceHashes,'Build must leave sources unchanged');
console.log('ok   two builds produce identical output and leave sources unchanged');

const installer=read('dist/plugin-installer.sql');
assert.equal(read('plugin/item_type_plugin_com_hashaam_skeleton_3d.sql'),installer,'Committed plug-in file matches the build');
const ids=JSON.parse(read('plugin/component-ids.json'));
const version=JSON.parse(read('package.json')).version;
assert.ok(installer.includes("p_version_identifier=>'"+version+"'"));
assert.equal([...installer.matchAll(/create_plugin_attribute\(/g)].length,Object.keys(ids.attributes).length);
assert.equal([...installer.matchAll(/create_plugin_file\(/g)].length,2);
assert.ok(!/p_attribute_sequence=>18\b|=>undefined|@@[A-Z_]+@@/.test(installer));
for(const name of ['workspace_id','application_id','owner'])assert.ok(installer.includes('p_default_'+name+'=>null'));
const attributes=[...installer.matchAll(/create_plugin_attribute\(([\s\S]*?)\n\);/g)].map(match=>match[1]);
for(const number of Object.keys(ids.attributes)) {
    const attribute=attributes.find(block=>new RegExp('p_attribute_sequence=>'+number+'\\b').test(block));
    assert.ok(attribute,'Missing attribute '+number);
    assert.ok(attribute.includes('p_id=>wwv_flow_imp.id('+ids.attributes[number]+')'),'Stable attribute ID '+number);
}
for(const number of ['23','27','28','29']) {
    assert.ok(attributes.find(block=>new RegExp('p_attribute_sequence=>'+number+'\\b').test(block)).includes('p_depending_on_attribute_id=>wwv_flow_imp.id('+ids.attributes['26']+')'));
}
const chunks=[...installer.matchAll(/begin\nwwv_flow_imp.g_varchar2_table := wwv_flow_imp.empty_varchar2_table;\n([\s\S]*?)end;\n\//g)];
for(const [,block] of chunks) {
    const file=block.match(/p_file_name=>'([^']+)'/)[1];
    const bytes=Buffer.from([...block.matchAll(/g_varchar2_table\(\d+\) := '([a-f0-9]+)'/g)].map(match=>match[1]).join(''),'hex');
    assert.deepEqual(bytes,fs.readFileSync('dist/'+path.basename(file)),'Embedded file '+file);
}
assert.equal(chunks.length,2);
assert.ok(!installer.includes("p_file_name=>'js/skeleton3d.js'"));
assert.ok(!installer.includes('skeleton3d#MIN#'));
assert.ok(fs.existsSync('dist/release/debug/skeleton3d.min.js.map'));
assert.ok(Buffer.byteLength(installer)<1900000,'Installer must remain below 1.9 MB');
console.log('ok   installer metadata, stable IDs, dependencies and two minified embedded assets match');

const clinic=read('dist/db/001_clinic_store.sql');
const payload=read('dist/db/skeleton3d_pkg.sql');
const definition=JSON.parse(clinic.match(/return q'~([\s\S]*?)~';/)[1]);
assert.deepEqual(definition,{...GENERAL_EXAM,version:0});
assert.ok(clinic.includes('\\u00b0C'));
assert.ok(clinic.includes("':"+AREAS.map(area=>area.id).join(':')+":'"));
assert.ok(payload.includes("'"+AREAS.map(area=>area.id).join(':')+"'"));
assert.ok(!/@@[A-Z_]+@@/.test(clinic+payload));
assert.ok(!read('src/organ-diagnoses.js').includes('B18.19'));
assert.ok(JSON.parse(read('src/catalog-seed.json')).diagnoses.some(row=>row.code==='B18.1'&&row.label==='Chronic viral hepatitis B without delta-agent'));
console.log('ok   starter exam, Unicode units and area lists are generated from shared catalogs');
assert.match(clinic,/create or replace package ca3d_clinic_api as/);
assert.match(clinic,/create or replace view ca3d_clinic_catalog_v as/);
assert.ok(!/create(?: or replace)? (?:table|index|view|package(?: body)?) sk3_/i.test(clinic),'Fresh installs must not create legacy clinic objects');
for(const file of ['src/skeleton3d.plsql','db/002_demo_records.sql','db/003_relational_store.sql']) {
    assert.ok(!/\bsk3_clinic_api\b/i.test(read(file)),'Runtime uses the CA3D API: '+file);
}
console.log('ok   clinic installation and runtime references use the CA3D object contract');


const callbacks=read('src/skeleton3d.plsql');
assert.match(callbacks,/replace\(l_json, '<', '\\u003c'\)/);
assert.match(callbacks,/if apex_application.g_x01='PATIENT_CONTEXT' then\s+json_header;/);
assert.match(callbacks,/mime_header\('application\/json; charset=utf-8',false\);\s+sys.htp.p\('Cache-Control: no-store'\)/);
assert.match(callbacks,/ca3d_clinic_api\.ajax[\s\S]*?exception when others then[\s\S]*?examination service is unavailable/);
assert.match(callbacks,/ca3d_clinic_api\.validate_value[\s\S]*?exception when others then[\s\S]*?p_result.message:='The examination and clinic validation service is unavailable/);
for(const procedure of ['render','ajax','validation']){
    const source=callbacks.slice(callbacks.indexOf('procedure '+procedure+' ('),callbacks.indexOf('end '+procedure+';'));
    assert.equal([...source.matchAll(/clinic_maintainer\(p_item\)/g)].length,1,procedure+' authorization evaluation count');
}
assert.match(payload,/when l_site.get_string\('bone'\) is not null then 'P\|'/);
assert.match(payload,/incompatible with the female model/);
assert.match(payload,/l_terms.get_size<=100/);
assert.match(payload,/check_text\(l_answer,'value',2000\)/);
console.log('ok   callback source guards cover headers, script escaping, service errors and authorization reuse');

const allowed=new Set(['README.md','LICENSE','THIRD_PARTY_NOTICES.md','apexplugin.json','plugin/item_type_plugin_com_hashaam_skeleton_3d.sql']);
for(const file of files('dist/release')) {
    const relative=path.relative('dist/release',file).replaceAll('\\','/');
    assert.ok(allowed.has(relative)||relative.startsWith('db/')||relative.startsWith('docs/')||relative.startsWith('debug/'),'Unexpected release file '+relative);
    if(!relative.endsWith('.png')) {
        assert.ok(!/docs\/(?:review-|improvements|release-|database-demos)/.test(relative),'Internal document '+relative);
        const text=read(file);
        assert.ok(!/qa\/out|SK3R_|CA3Q_|deployed in the example application/i.test(text),'Internal release detail '+relative);
        assert.ok(!/WKSP_[A-Z0-9]+/i.test(text),'Private deployment reference '+relative);
        if (process.env.CA3D_PRIVATE_PATTERN) assert.ok(!new RegExp(process.env.CA3D_PRIVATE_PATTERN,'i').test(text),'Private deployment reference '+relative);
        if (relative.endsWith('.sql')) { assert.ok(!/^\uFEFF/.test(text),'Byte-order mark '+relative); }
    }
}
assert.ok(fs.existsSync('dist/release/docs/images/clinical-anatomy.png'));
assert.ok(read('dist/release/THIRD_PARTY_NOTICES.md').includes('Redistribution clearance')||read('dist/release/THIRD_PARTY_NOTICES.md').includes('Permission to redistribute'));
assert.equal(JSON.parse(read('dist/release/apexplugin.json')).version,version);
console.log('ok   release file selection, metadata, screenshot, notices and privacy scan pass');
console.log('Release checks passed. Oracle installation and catalog licensing clearance require separate verification.');

assert.equal([...clinic.matchAll(/^\s*seed_term\(/gm)].length,DIAGNOSES.length+COMPLAINTS.length,'One seed row per diagnosis or complaint');
assert.ok(clinic.includes("then "+LIMITS.examTextarea+" else "+LIMITS.examText+" end"));
assert.ok(clinic.includes('SPECIALTY_FILTER')||clinic.includes('specialty_filter'));
assert.ok(!clinic.includes('create table ca3d_catalog_scopes'));
assert.ok(clinic.includes('drop table ca3d_catalog_scopes'));
assert.ok(clinic.includes('drop column canonical_term_id'));
assert.ok(!clinic.includes('function canonical_id'));
assert.ok(!/update ca3d_clinic_terms set active_yn='Y'/.test(clinic),'Term creation must not reactivate retired entries');
assert.ok(!/entry client/.test(read('plugin/custom-attributes.apx')));
assert.ok(!/setContext:/.test(read('src/skeleton3d.js')));
assert.equal([...installer.matchAll(/p_attribute_type=>'PAGE ITEMS'/g)].length,1);
assert.ok(fs.existsSync('dist/release/docs/integration-guide.md'));
console.log('ok   table catalogue seed, shared limits, patient API removal, item pickers and integration guide are packaged');
