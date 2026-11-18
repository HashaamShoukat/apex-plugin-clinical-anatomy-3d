import examSeed from "./exam-seed.json" with {type:"json"};
import { LIMITS, examValueLimit } from './limits.js';
export const CERTAINTIES = ["unconfirmed", "provisional", "differential", "confirmed", "refuted"];
export const ASSESSMENTS = ["NOT_ASSESSED", "NORMAL", "ABNORMAL"];
export const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function siteKey (site) {
    const structure = site.part || site.bone;
    return (structure ? 'P|' + structure : 'A|' + site.area) + '|' + (site.side || '');
}

export function termKey (term) {
    return term.source === "CUSTOM" ? "CUSTOM|" + term.id : (term.system || "") + "|" + (term.code || "");
}

export function normalizeTerm (term, system = "ICD-10") {
    if (!term || !term.label) { return null; }
    const value = { label: String(term.label).slice(0, 400), system: String(term.system || system) };
    if (term.source === "CUSTOM") {
        if (!Number.isSafeInteger(Number(term.id)) || Number(term.id) <= 0) { return null; }
        Object.assign(value, { source: "CUSTOM", id: Number(term.id), system: String(term.system || "CUSTOM") });
        if (term.code) { value.code = String(term.code); }
        if (term.specialty) { value.specialty = String(term.specialty); }
    } else {
        if (!term.code) { return null; }
        value.code = String(term.code);
        if (term.source) { value.source = String(term.source); }
    }
    if (CERTAINTIES.includes(term.certainty)) { value.certainty = term.certainty; }
    return value;
}

export function normalizeMarker (marker) {
    const points = (marker.points || []).filter(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)).map(point => point.slice());
    if (!points.length) { return null; }
    return {
        ...(marker.id != null ? {id: String(marker.id)} : {}),
        kind: marker.kind === "AREA" ? "AREA" : "POINT",
        points: points.slice(0, 100),
        ...(marker.label != null ? {label: String(marker.label).slice(0, 120)} : {}),
        diagnosis: marker.diagnosis || null
    };
}

export function restoreClinicalSite (source, target) {
    target.complaints = (Array.isArray(source.complaints) ? source.complaints : []).map(term => normalizeTerm(term, "COMPLAINT")).filter(Boolean);
    target.markers = (Array.isArray(source.markers) ? source.markers : []).map(normalizeMarker).filter(Boolean);
    if (source.part) { target.part = String(source.part); target.partName = String(source.partName || source.part); }
    if (ASSESSMENTS.includes(source.assessment)) { target.assessment = source.assessment; }
}

export function serializeClinicalSite (source, target) {
    if (source.complaints && source.complaints.length) { target.complaints = source.complaints.map(term => ({ ...term })); }
    if (source.markers && source.markers.length) { target.markers = source.markers; }
    if (source.part) { target.part = source.part; target.partName = source.partName; }
    if (source.assessment) { target.assessment = source.assessment; }
}

export function hasClinicalData (sites, exam) {
    return !!exam || sites.some(site => site.part || site.assessment || site.markers?.length || site.complaints?.length || site.diagnoses.some(term => term.source === "CUSTOM" || term.certainty));
}

export const EXAM_SECTIONS = [
    {
        "id": "vitals",
        "title": "Vital signs",
        "description": "Record measurements with their units."
    },
    {
        "id": "examination",
        "title": "Physical examination",
        "description": "Document findings; explain any abnormal assessment."
    },
    {
        "id": "screening",
        "title": "Risks & individual needs",
        "description": "Record the outcome of your hospital’s approved screening tools."
    }
];

export const GENERAL_EXAM = examSeed;

export function examErrors (definition, answers = {}) {
    const errors = [];
    const known = new Set(definition.fields.map(field => field.id));
    for (const id of Object.keys(answers)) { if (!known.has(id)) { errors.push('Removed examination field: ' + id + '. Review and remove this answer before saving.'); } }
    for (const field of definition.fields) {
        const answer = answers[field.id] || {};
        if (typeof answer.value === 'string' && answer.value.length > examValueLimit(field)) { errors.push(field.label + ' is too long (maximum ' + examValueLimit(field) + ' characters).'); }
        if (typeof answer.note === 'string' && answer.note.length > LIMITS.examNote) { errors.push(field.label + ' note is too long.'); }
        if (answer.deferred) {
            if (!definition.allowDeferred || !String(answer.note || "").trim()) { errors.push(field.label + " requires an assessment or a reason for deferral."); }
        } else if (field.required && (answer.value === undefined || answer.value === null || String(answer.value).trim() === "" || (field.type === "checkbox" && answer.value !== true))) {
            errors.push(field.label + " is required.");
        } else if (field.type === "number" && answer.value != null && answer.value !== "" && (typeof answer.value !== "number" || !Number.isFinite(answer.value))) {
            errors.push(field.label + " must be numeric.");
        } else if (field.type === "checkbox" && answer.value != null && answer.value !== "" && typeof answer.value !== "boolean") {
            errors.push(field.label + " must be checked or unchecked.");
        } else if (field.type === "assessment" && answer.value && !["NORMAL", "ABNORMAL"].includes(answer.value)) {
            errors.push(field.label + " requires a valid assessment.");
        } else if (field.type === "select" && answer.value && !(field.options || []).some(option => option.value === answer.value)) {
            errors.push(field.label + " requires a valid selection.");
        } else if (field.type === "number" && answer.value !== undefined && answer.value !== "" && answer.value !== null &&
            ((field.min != null && Number(answer.value) < field.min) || (field.max != null && Number(answer.value) > field.max))) {
            errors.push(field.label + " is outside the configured entry range.");
        } else if (field.noteRequiredFor?.includes(answer.value) && !String(answer.note || "").trim()) {
            errors.push(field.label + " requires findings, an action or a reason in the note.");
        }
    }
    return errors;
}
