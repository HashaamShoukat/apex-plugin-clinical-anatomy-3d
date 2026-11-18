// Build browser assets, database packages and the portable APEX installer under dist/.
// APEX_APP_DIR explicitly synchronizes an APEXlang application's plug-in metadata and browser assets.
import { build } from "esbuild";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { GENERAL_EXAM } from "./src/clinical-value.js";
import { AREAS, SPECIALTIES, DIAGNOSES, COMPLAINTS } from "./src/catalog.js";
import { LIMITS } from './src/limits.js';
import { OBSERVATION_PRESETS } from "./src/patient-contract.js";
import { buildSkeleton } from "./src/model.js";
import { packagePlugin } from "./tools/package-plugin.mjs";

const VERSION = JSON.parse(readFileSync("package.json", "utf8")).version;
const APP = process.env.APEX_APP_DIR ? process.env.APEX_APP_DIR.replace(/[\\/]+$/, "") + "/shared-components/plugins/item/skeleton3d" : null;
const BANNER = "/*! Clinical Anatomy 3D for Oracle APEX " + VERSION + " - (c) Hashaam Shoukat, MIT License. Includes three.js, (c) 2010-2024 three.js authors, MIT License. */";
const target = ["es2019", "chrome90", "firefox90", "safari14"];

mkdirSync("dist", { recursive: true });
const js = { entryPoints: ["src/skeleton3d.js"], bundle: true, format: "iife", charset: "ascii", target, legalComments: "none",
             banner: { js: BANNER }, define: { __SK3_VERSION__: JSON.stringify(VERSION) } };
await build({ ...js, outfile: "dist/skeleton3d.js" });
await build({ ...js, outfile: "dist/skeleton3d.min.js", minify: true, sourcemap: "external", sourcesContent: false });
copyFileSync("src/skeleton3d.css", "dist/skeleton3d.css");
await build({ entryPoints: ["src/skeleton3d.css"], outfile: "dist/skeleton3d.min.css", minify: true, charset: "ascii",
              target: ["chrome111", "firefox113", "safari16.2"] });

for (const [dir, files] of [["js", ["skeleton3d.js", "skeleton3d.min.js"]], ["css", ["skeleton3d.css", "skeleton3d.min.css"]]]) {
    if (APP) { mkdirSync(`${APP}/static-files/${dir}`, { recursive: true }); }
    for (const f of files) {
        if (APP) { copyFileSync(`dist/${f}`, `${APP}/static-files/${dir}/${f}`); }
        console.log(f.padEnd(24), (readFileSync(`dist/${f}`).length / 1024).toFixed(1) + " KB");
    }
}

const rd = f => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const anatomyLinks = JSON.parse(rd('src/anatomy-links.json'));
const modelLinks = new Set();
for (const sex of ['M','F']) {
    const model=buildSkeleton(sex);
    for (const mesh of model.meshes) { const d=mesh.userData; if(d.kind!=='dark')modelLinks.add(d.base+'|'+d.area+'|'+(d.side||'-'));mesh.geometry.dispose(); }
}
if (JSON.stringify([...modelLinks].sort())!==JSON.stringify(anatomyLinks)) { throw Error('Update src/anatomy-links.json to match the anatomy model.'); }
const specialtyLinks=SPECIALTIES.flatMap(s=>(s.areas || []).map(area=>s.id+'|'+area)).join(':');
const payloadValidation = rd("src/payload.plsql").replaceAll('@@EXAM_NOTE@@',String(LIMITS.examNote)).replaceAll('@@EXAM_TEXTAREA@@',String(LIMITS.examTextarea)).replaceAll('@@ANATOMY_LINKS@@',anatomyLinks.join(':')).replaceAll('@@SPECIALTY_LINKS@@',specialtyLinks).replace(/(c_area_codes constant varchar2\(2000\) := ')[^']*'/,
    (_, prefix) => prefix + AREAS.map(area => area.id).join(':') + "'");
const plsql = rd("src/skeleton3d.plsql").trimEnd().replace('c_max_rows constant pls_integer := 60;',
    declaration => declaration + '\n\n' + payloadValidation + '\n' + rd('src/patient-guard.plsql').replace('@@OBSERVATION_PRESETS_JSON@@',JSON.stringify(OBSERVATION_PRESETS).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))));
// file URLs carry a content hash, so browsers never keep an old copy after a rebuild
const hash = createHash("sha256").update(readFileSync("dist/skeleton3d.min.js")).update(readFileSync("dist/skeleton3d.min.css")).digest("hex").slice(0, 8);
const template = rd("plugin/plugin.template.apx").replaceAll("?v=@@VERSION@@", `?v=${VERSION}-${hash}`).replaceAll("@@VERSION@@", VERSION);
const apx = template.replace("@@SOURCE@@", "").replaceAll("@@PREFIX@@", "skeleton3d_pkg.");
writeFileSync("dist/plugin.apx", apx);
if (APP) {
    writeFileSync(`${APP}/plugin.apx`, apx);
    for (const f of ["attribute-groups.apx", "custom-attributes.apx", "events.apx", "static-files.apx"]) { writeFileSync(`${APP}/${f}`, rd(`plugin/${f}`)); }
}

// One starter definition feeds both the browser preview and Oracle fallback.
const asciiJson = JSON.stringify({ ...GENERAL_EXAM, version: 0 }).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
const sqlLiteral = value => "'" + String(value || '').replaceAll("'", "''").replace(/[\u007f-\uffff]/g,c=>"'||unistr('\\"+c.charCodeAt(0).toString(16).padStart(4,'0')+"')||'") + "'";
const seedRows = DIAGNOSES.map(row=>['DIAGNOSIS',row.code,row.label,row.system,row.areas.join(':'),row.k,'ALL',null])
    .concat(COMPLAINTS.map(row=>['COMPLAINT',row.id,row.name,'COMPLAINT',row.areas.join(':'),row.k,'ALL',(row.specialties || []).join(':')]));
const seedSql = seedRows.map(row=>'            seed_term('+row.map(sqlLiteral).join(',')+');').join('\n');
const clinicStore = rd("src/clinic-store.template.sql")
    .replace('@@SHARED_CATALOG_MIGRATION@@',rd('src/shared-catalog-migration.sql'))
    .replace('@@CATALOG_SEED_SQL@@',seedSql)
    .replaceAll('@@EXAM_NOTE@@',String(LIMITS.examNote)).replaceAll('@@EXAM_TEXT@@',String(LIMITS.examText)).replaceAll('@@EXAM_TEXTAREA@@',String(LIMITS.examTextarea))
    .replace(/return q'~[\s\S]*?~';/, () => "return q'~" + asciiJson + "~';")
    .replace(/c_areas constant varchar2\(2000\) := '[^']*'/, () => "c_areas constant varchar2(2000) := ':" + AREAS.map(area => area.id).join(':') + ":'");
mkdirSync('dist/db', { recursive: true });
writeFileSync('dist/db/001_clinic_store.sql', clinicStore);
for (const file of ['install.sql', '002_demo_records.sql', '003_relational_store.sql']) { copyFileSync('db/' + file, 'dist/db/' + file); }

// the package with the same code: the plug-in's callbacks, compiled once instead of on every request

const sig = {
    render: "p_item in apex_plugin.t_item, p_plugin in apex_plugin.t_plugin, p_param in apex_plugin.t_item_render_param, p_result in out nocopy apex_plugin.t_item_render_result",
    ajax: "p_item in apex_plugin.t_item, p_plugin in apex_plugin.t_plugin, p_param in apex_plugin.t_item_ajax_param, p_result in out nocopy apex_plugin.t_item_ajax_result",
    validation: "p_item in apex_plugin.t_item, p_plugin in apex_plugin.t_plugin, p_param in apex_plugin.t_item_validation_param, p_result in out nocopy apex_plugin.t_item_validation_result"
};
writeFileSync("dist/db/skeleton3d_pkg.sql",
    `-- Clinical Anatomy 3D ${VERSION} - the plug-in's PL/SQL as a package (generated by build.mjs from src/skeleton3d.plsql).\n` +
    `-- Install it once in the application's parsing schema before importing the plug-in, whose callbacks are\n` +
    `-- SKELETON3D_PKG.RENDER / .AJAX / .VALIDATION. Safe to run again.\n` +
    `set define off\n\ncreate or replace package skeleton3d_pkg as\n` +
    `    function validate_payload(p_value in clob,p_specialty varchar2 default 'ALL',p_sex varchar2 default null) return varchar2;\n    function validate_patient(p_value clob,p_context clob,p_options varchar2 default '{}',p_definition clob default null) return varchar2;\n` +
    `    function patient_data(p_source_type in varchar2,p_source in varchar2) return clob;\n` +
    Object.entries(sig).map(([n, s]) => `    procedure ${n} (${s});\n`).join("") +
    `end skeleton3d_pkg;\n/\n\ncreate or replace package body skeleton3d_pkg as\n\n${plsql}\n\nend skeleton3d_pkg;\n/\n`);
writeFileSync("dist/VERSION", VERSION + "\n");
// The application build owns supporting scripts and package-body loaders.
console.log("plugin.apx".padEnd(24), `PL/SQL ${plsql.length} chars`);
packagePlugin(VERSION);
// Importable plug-in file under the standard APEX export name, committed like the other plug-in repositories.
copyFileSync('dist/plugin-installer.sql', 'plugin/item_type_plugin_com_hashaam_skeleton_3d.sql');

// A release folder contains only explicitly selected public deliverables.
const release = resolve('dist/release');
if (release !== resolve('dist', 'release') || !release.startsWith(resolve('dist') + (process.platform === 'win32' ? '\\' : '/'))) { throw Error('Unexpected release path'); }
rmSync(release, { recursive: true, force: true });
mkdirSync(release + '/db', { recursive: true });
mkdirSync(release + '/plugin', { recursive: true });
copyFileSync('dist/plugin-installer.sql', release + '/plugin/item_type_plugin_com_hashaam_skeleton_3d.sql');
for (const file of ['skeleton3d_pkg.sql','001_clinic_store.sql','002_demo_records.sql','003_relational_store.sql','install.sql']) { copyFileSync('dist/db/' + file, release + '/db/' + file); }
for (const file of ['README.md','LICENSE','THIRD_PARTY_NOTICES.md','apexplugin.json']) { copyFileSync(file, release + '/' + file); }
mkdirSync(release + '/docs/images',{recursive:true});
for (const file of ['configuration.md','clinic-workflow.md','patient-context.md','payload-contract.md','diagnosis-catalog.md','complaint-catalog.md','workspace-and-review.md','relational-storage.md','catalog-schema.md','detail-anatomy.md','integration-guide.md']) { copyFileSync('docs/'+file,release+'/docs/'+file); }
cpSync('docs/examples',release+'/docs/examples',{recursive:true});
for (const image of ['clinical-anatomy.png','neon-viewer.png']) { copyFileSync('docs/images/'+image,release+'/docs/images/'+image); }
mkdirSync(release+'/debug',{recursive:true});
copyFileSync('dist/skeleton3d.min.js.map',release+'/debug/skeleton3d.min.js.map');
