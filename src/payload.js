import { LIMITS } from './limits.js';
import { areaById } from './catalog.js';
import { ASSESSMENTS, CERTAINTIES, termKey, siteKey } from './clinical-value.js';
import { readContext } from './patient-contract.js';
import { validateSiteAnatomy } from './anatomy-contract.js';

// Validate before restoring anything so a bad record cannot erase the current one.
export function readPayload (input) {
    if (input === '' || input == null) { return { sites: [] }; }
    let serialized;
    try { serialized = typeof input === 'string' ? input : JSON.stringify(input); }
    catch (_) { throw Error('The anatomy value must contain valid JSON.'); }
    if (typeof serialized !== 'string') { throw Error('The anatomy value must contain valid JSON.'); }
    if (serialized.length > 1048576) { throw Error('The anatomy value exceeds 1048576 characters.'); }
    let document;
    try { document = JSON.parse(serialized); }
    catch (_) { throw Error('The anatomy value must contain valid JSON.'); }
    const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
    const require = (condition, path, message) => { if (!condition) { throw Error(path + ' ' + message); } };
    const text = (value, path, max) => {
        require(value == null || (typeof value === 'string' && value.length <= max), path, 'must be text of up to ' + max + ' characters.');
    };
    require(object(document), 'The anatomy value', 'must be an object.');
    if (document.contextRefresh != null) {
        require(object(document.contextRefresh),'contextRefresh','must be an object.');
        text(document.contextRefresh.at,'contextRefresh.at',100); text(document.contextRefresh.note,'contextRefresh.note',500);
        require(['M','F','U'].includes(document.contextRefresh.previousSex),'contextRefresh.previousSex','must be M, F or U.');
    }
    if (document.context != null) { document.context = readContext(document.context); }
    require(document.v == null || [1, 2].includes(document.v), 'v', 'must be a supported version (1 or 2).');
    require(document.sex == null || ['M', 'F', 'U'].includes(document.sex), 'sex', 'must be M, F or U (unconfirmed).');
    require(Array.isArray(document.sites), 'sites', 'must be an array.');
    require(document.sites.length <= 500, 'sites', 'supports up to 500 entries.');
    const siteKeys = new Set();
    for (const [index, site] of document.sites.entries()) {
        const path = 'sites[' + index + ']';
        require(object(site), path, 'must be an object.');
        require(!!areaById(site.area), path + '.area', 'must identify supported anatomy.');
        require(!document.sex || document.sex === 'M' || site.area !== 'PROSTATE', path + '.area', 'is incompatible with the female model.');
        require(site.side == null || ['L', 'R'].includes(site.side), path + '.side', 'must be L or R.');
        require(site.pain == null || (Number.isFinite(site.pain) && site.pain >= 0 && site.pain <= 10), path + '.pain', 'must be between 0 and 10.');
        for (const field of ['bone', 'part']) { text(site[field], path + '.' + field, 100); }
        require(!validateSiteAnatomy(site), path, validateSiteAnatomy(site));
        for (const field of ['boneName', 'partName', 'label']) { text(site[field], path + '.' + field, 400); }
        text(site.note, path + '.note', 2000);
        require(site.assessment == null || ASSESSMENTS.includes(site.assessment), path + '.assessment', 'has an unsupported finding state.');
        const key = siteKey(site);
        require(!siteKeys.has(key), path, 'duplicates another anatomical site.');
        siteKeys.add(key);
        const diagnosisKeys = new Set();
        for (const kind of ['diagnoses', 'complaints']) {
            require(site[kind] == null || Array.isArray(site[kind]), path + '.' + kind, 'must be an array.');
            require((site[kind] || []).length <= 100, path + '.' + kind, 'supports up to 100 entries.');
            const keys = new Set();
            for (const [termIndex, term] of (site[kind] || []).entries()) {
                const termPath = path + '.' + kind + '[' + termIndex + ']';
                require(object(term), termPath, 'must be an object.');
                text(term.label, termPath + '.label', 400);
                require(typeof term.label === 'string' && !!term.label.trim(), termPath + '.label', 'is required.');
                text(term.code, termPath + '.code', 60);
                text(term.system, termPath + '.system', 40);
                text(term.source, termPath + '.source', 40);
                text(term.specialty, termPath + '.specialty', 30);
                if (term.source === 'CUSTOM') {
                    require((typeof term.id === 'number' || typeof term.id === 'string') && Number.isSafeInteger(Number(term.id)) && Number(term.id) > 0,
                        termPath + '.id', 'must be a positive safe integer.');
                } else {
                    require(typeof term.code === 'string' && !!term.code.trim(), termPath + '.code', 'is required.');
                }
                require(term.certainty == null || CERTAINTIES.includes(term.certainty), termPath + '.certainty', 'has an unsupported value.');
                const termIdentity = termKey({ ...term, id: Number(term.id), system: term.system || (kind === 'diagnoses' ? 'ICD-10' : 'COMPLAINT') });
                require(!keys.has(termIdentity), termPath, 'duplicates another term.');
                keys.add(termIdentity);
                if (kind === 'diagnoses') { diagnosisKeys.add(termIdentity); }
            }
        }
        require(site.markers == null || Array.isArray(site.markers), path + '.markers', 'must be an array.');
        require((site.markers || []).length <= 100, path + '.markers', 'supports up to 100 entries.');
        const markerIds = new Set();
        for (const [markerIndex, marker] of (site.markers || []).entries()) {
            const markerPath = path + '.markers[' + markerIndex + ']';
            require(object(marker), markerPath, 'must be an object.');
            require(['POINT', 'AREA'].includes(marker.kind), markerPath + '.kind', 'must be POINT or AREA.');
            require(Array.isArray(marker.points) && marker.points.length >= (marker.kind === 'AREA' ? 3 : 1) && marker.points.length <= 100,
                markerPath + '.points', 'must contain 1-100 point coordinates or 3-100 outline coordinates.');
            require(marker.points.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)), markerPath + '.points', 'must contain finite XYZ coordinates.');
            text(marker.id, markerPath + '.id', 100);
            text(marker.label, markerPath + '.label', 120);
            text(marker.diagnosis, markerPath + '.diagnosis', 160);
            require(!marker.id || !markerIds.has(marker.id), markerPath + '.id', 'duplicates another finding.');
            markerIds.add(marker.id);
            require(marker.diagnosis == null || diagnosisKeys.has(marker.diagnosis), markerPath + '.diagnosis', 'must reference a diagnosis at this site.');
        }
    }
    if (document.exam != null) {
        require(object(document.exam), 'exam', 'must be an object.');
        text(document.exam.template,'exam.template',100);
        text(document.exam.profile,'exam.profile',100);
        require(document.exam.version == null || (Number.isSafeInteger(document.exam.version) && document.exam.version >= 0),'exam.version','must be a nonnegative safe integer.');
        require(document.exam.answers == null || object(document.exam.answers), 'exam.answers', 'must be an object.');
        require(Object.keys(document.exam.answers || {}).length <= 100, 'exam.answers', 'supports up to 100 entries.');
        for (const [id, answer] of Object.entries(document.exam.answers || {})) {
            require(/^[a-zA-Z][a-zA-Z0-9_]{0,127}$/.test(id),'exam.answers','contains an invalid field ID.');
            require(object(answer), 'exam.answers.' + id, 'must be an object.');
            require(answer.value == null || ['string', 'number', 'boolean'].includes(typeof answer.value), 'exam.answers.' + id + '.value', 'must be a scalar value.');
            if (typeof answer.value === 'string') { text(answer.value, 'exam.answers.' + id + '.value', LIMITS.examTextarea); }
            text(answer.note, 'exam.answers.' + id + '.note', LIMITS.examNote);
            require(answer.deferred == null || typeof answer.deferred === 'boolean', 'exam.answers.' + id + '.deferred', 'must be boolean.');
            if (answer.prefill != null) {
                require(object(answer.prefill), 'exam.answers.' + id + '.prefill', 'must be an object.');
                for (const key of ['source','recordedBy','recordedAt']) { text(answer.prefill[key], 'prefill.' + key, 120); }
                require(answer.prefill.locked == null || typeof answer.prefill.locked === 'boolean', 'prefill.locked', 'must be boolean.');
            }
        }
    }
    return document;
}
