import { GENERAL_EXAM, EXAM_SECTIONS, CERTAINTIES, examErrors, escapeHtml as esc, normalizeTerm, termKey } from "./clinical-value.js";
import { SPECIALTIES } from "./catalog.js";
import { LIMITS, examValueLimit } from './limits.js';

const clone = value => JSON.parse(JSON.stringify(value));
const certaintyNames = { unconfirmed: "Unconfirmed", provisional: "Suspected / provisional", differential: "Differential", confirmed: "Confirmed", refuted: "Refuted" };

export class ClinicTools {
    constructor (widget) {
        this.w = widget;
        this.permissions = String(widget.opts.clinicPermissions || "NONE").split(":");
        this.tableCatalog = !!widget.opts.ajaxId && (widget.opts.dxSource !== 'NONE' || widget.opts.complaints || widget.opts.examMode !== 'OFF' || this.permissions.some(permission=>permission!=='NONE'));
        this.custom = this.tableCatalog || !widget.opts.ajaxId;
        this.enabled = this.custom || !!widget.exam || widget.opts.examMode !== "OFF" || this.permissions.includes("EXAM_SETUP");
        this.definition = clone(GENERAL_EXAM);
        this.definition.version = 0;
        this.complaints = [];
        this.sequence = 0;
        this.termCache = new Map();
        this.examRoot = document.createElement("div");
        this.examRoot.className = "sk3-exam-root";
        this.examDialog = document.createElement("dialog");
        this.examDialog.className = "sk3-dialog sk3-exam-dialog";
        this.examDialog.setAttribute("aria-labelledby", widget.id + "_exam_title");
        this.examDialog.innerHTML = '<header class="sk3-exam-dialog-header"><div><h2 id="' + esc(widget.id) + '_exam_title">Initial general examination</h2><span class="sk3-exam-progress" aria-live="polite"></span></div><button type="button" class="sk3-chip" data-clinic="close-exam" aria-label="Close examination">Close</button></header>';
        this.examDialog.append(this.examRoot);
        this.examDialog.insertAdjacentHTML("beforeend", '<footer class="sk3-exam-dialog-footer"><span class="sk3-exam-mode"></span><button type="button" class="sk3-chip sk3-chip--go" data-clinic="confirm-exam">Done</button></footer>');
        widget.root.append(this.examDialog);
        this.gate = document.createElement("div"); this.gate.className = "sk3-exam-gate"; this.gate.hidden = true;
        this.gate.innerHTML = '<strong>Initial examination required</strong><p>Complete the examination before recording anatomy findings.</p><button type="button" class="sk3-chip sk3-chip--go" data-clinic="show-exam">Open examination</button>';
        widget.stage.append(this.gate);
        this.maintenanceRoot = document.createElement("div");
        this.maintenanceRoot.className = "sk3-maintenance";
        widget.root.querySelector(".sk3-panel").prepend(this.maintenanceRoot);
        this.renderMaintenance();
        widget.listen(widget.root, "click", event => this.onClick(event));
        widget.listen(widget.root, "change", event => this.onChange(event));
        widget.listen(widget.root, "input", event => this.onInput(event));
        this.ready = this.enabled ? this.load() : Promise.resolve();
        if (window.apex?.jQuery) {
            window.apex.jQuery(document).on("apexbeforepagesubmit.sk3-" + widget.id, (event, request) => {
                const name = String(request || '').toUpperCase();
                this.skipSubmitValidation = widget.opts.saveRequests ? !widget.opts.saveRequests.includes(name) : (widget.opts.skipValidationRequests || ['CANCEL', 'DELETE']).includes(name);
                widget.flushCommit();
                if (widget.disabled || widget.opts.readOnly || this.skipSubmitValidation) { return true; }
                const errors = this.validate();
                if (errors.length) { this.message(errors[0]); this.openExam(); return false; }
                return true;
            });
        }
    }

    async request (action, payload = {}) {
        const data = { x01: action, x02: payload.kind || "", x03: payload.query || "", x04: payload.area || "", x05: payload.part || "", x06: payload.global ? "GLOBAL" : "", x07: payload.specialty || this.w.specialty.id, x09: this.w.opts.clinicToken || "" };
        if (action === "CLINIC_CREATE" || action === "CLINIC_CONFIGURE") { data.p_clob_01 = JSON.stringify(payload); }
        const result = this.w.opts.clinicTransport ? await this.w.opts.clinicTransport(action, payload)
            : this.w.opts.ajaxId && window.apex ? await this.w.server(data) : await this.browserCatalog(action, payload);
        if (result.error) { throw Error(result.error); }
        return result;
    }

    browserCatalog (action, payload) {
        const key = "skeleton3d-clinic-" + (window.apex?.env?.APP_ID || "demo");
        let store;
        try { store = JSON.parse(localStorage.getItem(key) || "null"); } catch (error) { store = null; }
        store = store || { terms: [], template: { ...clone(GENERAL_EXAM), version: 0 }, nextId: 1 };
        if (action === "CLINIC_LOAD") { return { template: store.template, version: store.template.version }; }
        if (action === "CLINIC_TERMS") {
            const areas = String(payload.area || "").split(":");
            return { rows: store.terms.filter(term => term.kind === payload.kind && [term.label, term.code].join(" ").toLowerCase().includes(String(payload.query || "").toLowerCase()) &&
                (!payload.specialty || payload.specialty === "ALL" || !term.specialty || term.specialty === "ALL" || term.specialty === payload.specialty) &&
                (!payload.area || term.links.some(link => areas.includes(link.area) && (payload.global || !link.part || link.part === payload.part)))).slice(0, 60) };
        }
        if (this.w.opts.readOnly) { throw Error("This item is read only."); }
        if (action === "CLINIC_CREATE") {
            const label = String(payload.label || "").trim().replace(/\s+/g, " ");
            if (!label || label.length > 400 || !this.permissions.includes("TERMS")) { throw Error("Provide a valid name for the clinic list."); }
            const specialty = payload.specialty || "ALL";
            let term = store.terms.find(row => row.kind === payload.kind && (row.specialty || "ALL") === specialty && row.label.toLowerCase() === label.toLowerCase());
            if (term && payload.code && term.code !== payload.code) { throw Error("This name already exists with a different code. Select the existing term."); }
            if (!term) { const id = store.nextId++; term = { id, label, source: "CUSTOM", system: payload.system || "CUSTOM", code: payload.code || (payload.kind === "DIAGNOSIS" ? "DX-" : "CP-") + String(id).padStart(16, "0"), specialty, kind: payload.kind, areas: [], links: [] }; store.terms.push(term); }
            if (!term.areas.includes(payload.area)) { term.areas.push(payload.area); }
            if (!term.links.some(link => link.area === payload.area && link.part === payload.part)) { term.links.push({ area: payload.area, part: payload.part || null }); }
            try { localStorage.setItem(key, JSON.stringify(store)); }
            catch (_) { throw Error('Browser storage is unavailable. Clinic changes were not saved. Enable storage or use the server clinic catalog.'); }
            return { rows: [term] };
        }
        if (action === "CLINIC_CONFIGURE") {
            if (!this.permissions.includes("EXAM_SETUP")) { throw Error("Exam configuration is disabled."); }
            if (payload.version !== store.template.version) { throw Error("The exam configuration changed. Reload before saving."); }
            store.template = { ...payload, version: store.template.version + 1 };
            try { localStorage.setItem(key, JSON.stringify(store)); }
            catch (_) { throw Error('Browser storage is unavailable. Examination changes were not saved. Enable storage or use the server clinic catalog.'); }
            return { template: store.template, version: store.template.version };
        }
        throw Error("Unsupported clinic operation.");
    }

    async load () {
        if (this.loading) { return; }
        this.loading = true;
        this.loaded = false;
        this.loadError = null;
        this.message('Loading examination...');
        this.renderExam();
        try {
            const result = await this.request("CLINIC_LOAD");
            if (this.w.destroyed) { return; }
            if (!result.template || !Array.isArray(result.template.fields) || !Number.isFinite(result.version)) { throw Error('The examination service returned an invalid form.'); }
            this.definition = { ...result.template, version: result.version };
            this.loaded = true;
            await this.loadComplaints();
            this.message('');
            this.w.patientContext?.prefill();
            this.w.patientContext?.render();
            this.renderExam();
            this.w.renderPanel();
        } catch (error) {
            if (this.w.destroyed) { return; }
            this.loadError = error.message;
            this.message('Unable to load the examination form. ' + error.message);
            this.renderExam();
        } finally { this.loading = false; this.updateGate(); }
    }

    async terms (kind, areas, query = "", part = "", global = false) {
        if (!this.custom) { return []; }
        if (kind === 'DIAGNOSIS' && this.w.opts.dxSource === 'NONE') { return []; }
        const payload = { kind, area: Array.isArray(areas) ? areas.join(":") : areas, query, part, global, specialty: this.w.specialty.id };
        const key = JSON.stringify(payload), cached = this.termCache.get(key);
        if (cached && cached.expires > Date.now()) { return cached.promise; }
        const promise = this.request('CLINIC_TERMS',payload).then(result => (result.rows || []).map(row => ({ ...normalizeTerm(row), areas: Array.isArray(row.areas) ? row.areas : String(row.areas || '').split(':'), links: row.links || [], k: row.keywords || '' })));
        if (this.termCache.size >= 100) { this.termCache.delete(this.termCache.keys().next().value); }
        this.termCache.set(key,{promise,expires:Date.now()+60000});
        try { return await promise; } catch (error) { if (this.termCache.get(key)?.promise === promise) { this.termCache.delete(key); } throw error; }
    }

    async loadComplaints () {
        if (!this.tableCatalog || !this.w.opts.complaints) { return; }
        const specialty = this.w.specialty.id;
        const rows = await this.terms('COMPLAINT',this.w.availableAreas().map(area => area.id),'','',true);
        if (specialty !== this.w.specialty.id || this.w.destroyed) { return; }
        this.catalogComplaints = rows.map(row => ({...row,id:String(row.id),name:row.label,k:row.k || ''}));
    }

    message (text) {
        let status = this.w.root.querySelector(".sk3-clinic-status");
        if (!status) { status = document.createElement("div"); status.className = "sk3-clinic-status"; status.setAttribute("role", "alert"); this.w.root.append(status); }
        status.textContent = text;
        status.hidden = !text;
        if (text && this.loadError && !this.loaded) {
            const retry = document.createElement('button');
            retry.type = 'button'; retry.className = 'sk3-chip'; retry.dataset.clinic = 'retry-exam'; retry.textContent = 'Retry';
            status.append(' ', retry);
        }
    }

    renderMaintenance () {
        if (!this.maintenanceRoot) { return; }
        const terms = this.permissions.includes("TERMS"), setup = this.permissions.includes("EXAM_SETUP");
        this.maintenanceRoot.hidden = this.w.opts.readOnly || (!terms && !setup);
        if (this.maintenanceRoot.hidden) { return; }
        const site = this.w.sites.find(row => this.w.keyOf?.(row) === this.w.active);
        this.maintenanceRoot.innerHTML = `<div><span class="sk3-eyebrow">Shared clinic catalog</span><strong>${site ? esc(this.w.labelOf(site)) : "Select anatomy to add a diagnosis or complaint"}</strong><span class="sk3-maintenance-hint">${site ? esc(this.w.specialty.name) + " · Saved terms are reusable for this anatomy." : "Click the model, use search, or choose a structure in the anatomy browser."}</span></div><div class="sk3-clinic-actions">` +
            (terms ? `<button type="button" class="sk3-chip sk3-chip--go" data-clinic="new-diagnosis"${!site || !this.loaded ? " disabled" : ""}>+ Add diagnosis</button><button type="button" class="sk3-chip" data-clinic="new-complaint"${!site || !this.loaded ? " disabled" : ""}>+ Add complaint</button>` : "") +
            (setup ? `<button type="button" class="sk3-chip" data-clinic="configure-exam"${!this.loaded ? " disabled" : ""}>Configure examination</button>` : "") + `</div>`;
    }

    siteHtml (site, open) {
        let html = "";
        if (site.complaints?.length) {
            html += `<div class="sk3-row"><b>Complaints</b><ul class="sk3-clinic-selected">` + site.complaints.map((term, index) => `<li><span>${esc(term.label)}</span>` +
                (this.w.opts.readOnly ? "" : `<button type="button" class="sk3-ic" data-clinic="remove-complaint" data-index="${index}" aria-label="Remove ${esc(term.label)}">×</button>`) + `</li>`).join("") + `</ul></div>`;
        }
        if (!open || this.w.opts.readOnly || !this.custom) { return html; }
        html += `<div class="sk3-clinic-site"><div class="sk3-custom-complaints" aria-label="Clinic complaints"></div>`;
        return html + `</div>`;
    }

    certaintyHtml (term, index) {
        if (!this.w.modelTools?.enabled("CERTAINTY")) { return term.certainty ? `<small>${esc(certaintyNames[term.certainty] || term.certainty)}</small>` : ""; }
        if (this.w.opts.readOnly) { return `<small>${esc(certaintyNames[term.certainty] || "Certainty not recorded")}</small>`; }
        return `<select class="sk3-certainty" data-clinic-certainty="${index}" aria-label="Certainty for ${esc(term.label)}"><option value="">Certainty not recorded</option>` +
            CERTAINTIES.map(value => `<option value="${value}"${term.certainty === value ? " selected" : ""}>${certaintyNames[value]}</option>`).join("") + `</select>`;
    }

    async renderSite (site) {
        const target = this.w.body.querySelector(".sk3-custom-complaints");
        if (!target || !site) { return; }
        const sequence = ++this.sequence;
        try {
            const terms = await this.terms("COMPLAINT", [site.area], "", site.part || site.bone || "");
            if (sequence !== this.sequence || !target.isConnected) { return; }
            this.complaints = terms;
            target.innerHTML = terms.length ? `<div class="sk3-sug-t">Clinic complaints</div><div class="sk3-quick-l">` + terms.map((term, index) =>
                `<button type="button" class="sk3-chip" data-clinic="select-complaint" data-index="${index}">${esc(term.label)}</button>`).join("") + `</div>` : "";
        } catch (error) { target.textContent = error.message; }
    }

    dialog (title, content, action, buttonText) {
        this.dialogRoot?.remove();
        const dialog = document.createElement("dialog");
        dialog.className = "sk3-dialog";
        dialog.setAttribute("aria-label", title);
        dialog.innerHTML = `<h2>${esc(title)}</h2>${content}<p class="sk3-dialog-error" role="alert"></p><div class="sk3-dialog-actions"><button type="button" class="sk3-chip" data-clinic="close-dialog">Cancel</button><button type="button" class="sk3-chip sk3-chip--go" data-clinic="${action}">${esc(buttonText)}</button></div>`;
        this.w.root.append(dialog);
        this.dialogRoot = dialog;
        dialog.showModal();
        dialog.querySelector("input,select,button")?.focus();
    }

    addTermDialog (kind) {
        const site = this.w.sites.find(row => this.w.keyOf(row) === this.w.active);
        if (!site) { return; }
        this.creationSite = site;
        this.creationKind = kind;
        this.dialog("Add clinic " + kind.toLowerCase(), `<div class="sk3-dialog-context"><span class="sk3-eyebrow">Selected anatomy</span><strong>${esc(this.w.labelOf(site))}</strong></div><div class="sk3-term-fields"><label class="sk3-field-wide">Name <span aria-hidden="true">*</span><input class="sk3-input" name="clinic-label" maxlength="400" autocomplete="off" required></label>` +
            `<label>Specialty<select name="clinic-specialty">${SPECIALTIES.map(s => `<option value="${s.id}"${s.id === this.w.specialty.id ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label><label>Code<input name="clinic-code" maxlength="60" placeholder="Generated when blank"></label><label>Coding system<input name="clinic-system" maxlength="40" value="CUSTOM"></label></div>` +
            (site.part || site.bone ? `<label class="sk3-check"><input type="checkbox" name="clinic-part" checked> Limit to this anatomical part</label>` : ""), "save-term", "Save and select");
    }

    async saveTerm () {
        const button = this.dialogRoot.querySelector('[data-clinic="save-term"]');
        if (button.disabled) { return; }
        button.disabled = true;
        try {
            const site = this.creationSite;
            const result = await this.request("CLINIC_CREATE", { kind: this.creationKind, label: this.dialogRoot.querySelector('[name="clinic-label"]').value, area: site.area,
                specialty: this.dialogRoot.querySelector('[name="clinic-specialty"]').value, code: this.dialogRoot.querySelector('[name="clinic-code"]').value.trim(), system: this.dialogRoot.querySelector('[name="clinic-system"]').value.trim() || "CUSTOM",
                part: this.dialogRoot.querySelector('[name="clinic-part"]')?.checked ? site.part || site.bone : null });
            const term = normalizeTerm(result.rows[0]);
            this.termCache.clear();
            if (this.creationKind === "DIAGNOSIS") { this.w.addSite(site, term); }
            else { this.w.addComplaint(site, term); }
            this.dialogRoot.close();
            this.dialogRoot.remove();
            this.w.renderPanel();
        } catch (error) { this.dialogRoot.querySelector(".sk3-dialog-error").textContent = error.message; }
        finally { button.disabled = false; }
    }

    openExam () {
        if (this.w.opts.examMode === "OFF" && !this.w.exam) { return; }
        this.renderExam();
        if (!this.examDialog.open) { this.examDialog.showModal(); }
    }

    isBlocked () {
        return this.w.opts.examMode === "REQUIRED" && !this.w.opts.readOnly && this.validate().length > 0;
    }

    updateGate () {
        const blocked = this.isBlocked();
        this.w.root.classList.toggle("is-exam-blocked", blocked);
        if (this.gate) { this.gate.hidden = !blocked; }
        const button = this.w.root.querySelector('.sk3-topbar [data-clinic="show-exam"]');
        if (button) {
            button.hidden = this.w.opts.examMode === "OFF" && !this.w.exam;
            const complete = this.w.exam && !examErrors(this.definition,this.w.exam.answers || {}).length && !this.validate().length;
            button.textContent = "Initial examination" + (this.w.opts.readOnly && this.w.exam ? " · Recorded" : blocked ? " · Required" : complete ? " · Complete" : this.w.exam ? " · Recorded" : "");
            button.classList.toggle("is-required", blocked);
        }
    }

    renderExam () {
        const unavailable = this.enabled && !this.loaded && !this.w.opts.readOnly;
        this.examDialog.querySelector('[data-clinic="confirm-exam"]').disabled = unavailable;
        if (unavailable) {
            this.examRoot.innerHTML = '<p class="sk3-exam-error" role="alert">' + esc(this.loadError || 'The examination form is loading.') + '</p>' + (this.loadError ? '<button type="button" class="sk3-chip" data-clinic="retry-exam">Retry examination</button>' : '');
            this.examDialog.querySelector('.sk3-exam-progress').textContent = this.loadError ? 'Examination unavailable' : 'Loading examination';
            this.updateGate();
            return;
        }
        const scroll = this.examRoot.scrollTop;
        const answers = this.w.exam?.answers || {};
        const fields = this.definition.fields.slice();
        const retired = Object.keys(answers).filter(id => !fields.some(field => field.id === id));
        if (this.w.opts.readOnly) {
            for (const [id, answer] of Object.entries(answers)) {
                if (!fields.some(field => field.id === id)) { fields.push({ id, label: id.replace(/_/g, " "), type: typeof answer.value === "number" ? "number" : "text", section: "historical" }); }
            }
        }
        const fieldHtml = field => {
            const answer = answers[field.id] || {}, locked = answer.prefill?.locked, disabled = this.w.opts.readOnly || answer.deferred || locked ? " disabled" : "";
            const id = this.w.id + "_exam_" + field.id;
            const required = field.required && this.w.opts.examMode === "REQUIRED";
            const options = field.type === "assessment" ? [{ value: "NORMAL", label: "Normal" }, { value: "ABNORMAL", label: "Abnormal" }] : field.options || [];
            const pills = ["assessment", "select"].includes(field.type) && options.length <= 4;
            let input;
            if (pills) {
                input = '<div class="sk3-pills" role="radiogroup" aria-labelledby="' + esc(id) + '_label">' + options.map(option =>
                    '<label class="sk3-pill"><input type="radio" name="' + esc(id) + '" data-exam-value="' + esc(field.id) + '" value="' + esc(option.value) + '"' + (answer.value === option.value ? ' checked' : '') + disabled + '><span>' + esc(option.label) + '</span></label>').join('') + '</div>';
            } else if (field.type === "select") {
                input = '<select id="' + esc(id) + '" data-exam-value="' + esc(field.id) + '"' + disabled + '><option value="">Select an outcome</option>' + options.map(option => '<option value="' + esc(option.value) + '"' + (answer.value === option.value ? ' selected' : '') + '>' + esc(option.label) + '</option>').join('') + '</select>';
            } else if (field.type === "textarea") {
                input = '<textarea id="' + esc(id) + '" data-exam-value="' + esc(field.id) + '" rows="2" maxlength="' + examValueLimit(field) + '"' + disabled + '>' + esc(answer.value || '') + '</textarea>';
            } else if (field.type === "checkbox") {
                input = '<input id="' + esc(id) + '" data-exam-value="' + esc(field.id) + '" type="checkbox"' + (answer.value === true ? ' checked' : '') + disabled + '>';
            } else {
                input = '<input id="' + esc(id) + '" data-exam-value="' + esc(field.id) + '" type="' + (field.type === 'number' ? 'number' : 'text') + '" step="any"' + (field.min != null ? ' min="' + Number(field.min) + '"' : '') + (field.max != null ? ' max="' + Number(field.max) + '"' : '') + ' maxlength="' + examValueLimit(field) + '" value="' + esc(answer.value ?? '') + '"' + disabled + '>';
            }
            const hideNote = !pills && field.type !== "select" && !answer.deferred && !answer.note;
            return '<div class="sk3-exam-field' + (field.type === 'textarea' ? ' sk3-field-wide' : '') + (answer.prefill ? ' is-prefilled' : '') + '" data-exam-field="' + esc(field.id) + '"><div class="sk3-exam-field-head"><label id="' + esc(id) + '_label"' + (!pills ? ' for="' + esc(id) + '"' : '') + '>' + esc(field.label) + (field.unit ? ' <small>' + esc(field.unit) + '</small>' : '') + (required ? ' <span class="sk3-required" aria-label="required">*</span>' : '') + '</label>' +
                (this.definition.allowDeferred ? '<label class="sk3-check sk3-defer"><input type="checkbox" data-exam-defer="' + esc(field.id) + '"' + (answer.deferred ? ' checked' : '') + (this.w.opts.readOnly || locked ? ' disabled' : '') + '>Deferred</label>' : '') + '</div>' + input +
                (answer.prefill ? '<span class="sk3-prefill-source">Prefilled' + (locked ? ' · Read only' : '') + ' · ' + esc([answer.prefill.source,answer.prefill.recordedBy,answer.prefill.recordedAt].filter(Boolean).join(' · ')) + '</span>' : '') +
                '<input type="text" data-exam-note="' + esc(field.id) + '" maxlength="' + LIMITS.examNote + '" aria-label="Note for ' + esc(field.label) + '" value="' + esc(answer.note || '') + '"' + (hideNote ? ' hidden' : '') + (this.w.opts.readOnly ? ' disabled' : '') + '><div class="sk3-reason-picks" data-exam-reasons="' + esc(field.id) + '"></div></div>';
        };
        const groups = EXAM_SECTIONS.map(section => ({ ...section, fields: fields.filter(field => (field.section || "examination") === section.id) })).filter(section => section.fields.length);
        const other = fields.filter(field => field.section && !EXAM_SECTIONS.some(section => section.id === field.section));
        if (other.length) { groups.push({ id: "other", title: "Additional recorded assessment", description: "", fields: other }); }
        const stale = this.w.exam && (this.w.exam.version !== this.definition.version || (this.definition.profile && this.w.exam.profile !== this.definition.profile));
        this.examDialog.querySelector('h2').textContent = this.definition.title;
        this.examDialog.querySelector('.sk3-exam-mode').textContent = this.w.opts.readOnly ? "Read only" : this.w.opts.examMode === "REQUIRED" ? "Complete required fields before recording anatomy findings." : "Optional examination";
        this.examRoot.innerHTML = '<div class="sk3-exam"><p class="sk3-exam-error" role="alert"></p>' +
            (retired.length && !this.w.opts.readOnly ? '<div class="sk3-exam-stale"><strong>Removed examination fields</strong><ul>' + retired.map(id => '<li>' + esc(id) + ': ' + esc(JSON.stringify(answers[id])) + '</li>').join('') + '</ul><button type="button" class="sk3-chip" data-clinic="remove-retired">Remove these answers</button></div>' : '') +
            (stale && !this.w.opts.readOnly ? '<div class="sk3-exam-stale">Review this updated form before saving.<button type="button" class="sk3-chip" data-clinic="review-exam">I have reviewed the updated form</button></div>' : '') +
            groups.map(section => '<section class="sk3-exam-section" data-exam-section="' + section.id + '"><header><div><h3>' + esc(section.title) + '</h3></div></header><div class="sk3-exam-grid">' + section.fields.map(fieldHtml).join('') + '</div></section>').join('') + '</div>';
        this.examRoot.scrollTop = scroll;
        this.updateProgress();
    }

    updateProgress () {
        const required = this.definition.fields.filter(field => field.required);
        const answers = this.w.exam?.answers || {};
        const complete = required.filter(field => !examErrors({ ...this.definition, fields: [field] }, {[field.id]:answers[field.id] || {}}).length).length;
        for (const field of this.definition.fields) {
            const note = this.examRoot.querySelector('[data-exam-note="' + field.id + '"]');
            const answer = answers[field.id] || {};
            const needed = !!answer.deferred || !!field.noteRequiredFor?.includes(answer.value);
            if (note) {
                note.placeholder = answer.deferred ? 'Reason for deferral (required)' : answer.value === 'NOT_APPLICABLE' ? 'Reason for not applicable (required)' : needed ? 'Finding / action / reason (required)' : 'Finding / note (optional)';
                note.setAttribute('aria-required', String(needed));
            }
            const picks = this.examRoot.querySelector('[data-exam-reasons="' + field.id + '"]');
            if (picks) {
                const reasons = !needed || this.w.opts.readOnly || this.w.disabled ? [] : answer.deferred
                    ? ['Patient declined this assessment', 'Unable to assess at this time', 'Deferred to follow-up']
                    : answer.value === 'NOT_APPLICABLE' ? ['Not applicable to this visit', 'Not applicable to this care setting']
                    : ['UNKNOWN', 'UNABLE_TO_REPORT'].includes(answer.value) ? ['Information not available', 'Patient unable to self-report', 'Awaiting confirmation'] : [];
                picks.hidden = !reasons.length;
                picks.innerHTML = reasons.length ? '<span>Quick picks:</span>' + reasons.map(reason => '<button type="button" class="sk3-reason-link" data-clinic="exam-reason" data-field="' + esc(field.id) + '" data-reason="' + esc(reason) + '">' + esc(reason) + '</button>').join('') : '';
            }
        }
        this.examDialog.querySelector('.sk3-exam-progress').textContent = this.w.opts.examMode === "REQUIRED" ? complete + ' / ' + required.length + ' required complete' : this.w.opts.readOnly ? 'Recorded examination' : 'Record only what was assessed';
        this.updateGate();
    }

    validate () {
        if ((this.w.opts.examMode === "OFF" && !this.w.exam) || this.w.opts.readOnly || this.w.disabled) { return []; }
        if (!this.loaded) { return [this.loadError || "The initial examination form is still loading."]; }
        if (this.w.exam && (this.w.exam.version !== this.definition.version || (this.definition.profile && this.w.exam.profile !== this.definition.profile))) { return ["The examination form changed. Review the updated form before saving."]; }
        const definition = this.w.opts.examMode === "REQUIRED" ? this.definition : { ...this.definition, fields: this.definition.fields.map(field => ({ ...field, required: false })) };
        return examErrors(definition, this.w.exam?.answers || {});
    }

    readDraft () {
        if (!this.dialogRoot) { return; }
        this.draft.title = this.dialogRoot.querySelector('[name="exam-title"]').value.trim();
        this.draft.allowDeferred = this.dialogRoot.querySelector('[name="allow-deferred"]').checked;
        this.draft.fields = [...this.dialogRoot.querySelectorAll("[data-exam-config-row]")].map(row => {
            const field = { ...this.draft.fields.find(f => f.id === row.dataset.examConfigRow), id: row.dataset.examConfigRow, label: row.querySelector('[name="label"]').value.trim(), type: row.querySelector('[name="type"]').value,
                section: row.querySelector('[name="section"]').value, unit: row.querySelector('[name="unit"]').value.trim(), required: row.querySelector('[name="required"]').checked };
            if (field.type === "select") { field.options = row.querySelector('[name="options"]').value.split("\n").filter(s => s.trim()).map(s => { const i = s.indexOf("|"); return { value: (i < 0 ? s : s.slice(0, i)).trim(), label: (i < 0 ? s : s.slice(i + 1)).trim() }; }); }
            field.noteRequiredFor = row.querySelector('[name="note-values"]').value.split(",").map(s => s.trim()).filter(Boolean);
            for (const key of ["min", "max"]) { const v = row.querySelector(`[name="${key}"]`).value; if (v !== "") { field[key] = Number(v); } else { delete field[key]; } }
            return field;
        });
    }

    configureExam () {
        this.draft = this.draft || clone(this.definition);
        this.dialog("Configure initial examination", `<label>Form title<input class="sk3-input" name="exam-title" maxlength="120" value="${esc(this.draft.title)}"></label><label class="sk3-check"><input type="checkbox" name="allow-deferred"${this.draft.allowDeferred ? " checked" : ""}> Allow deferral with a documented reason</label>` +
            `<div class="sk3-config-banner">Changes apply to the shared form. Existing answers are preserved and require review when the form changes.<button type="button" class="sk3-chip" data-clinic="use-starter">Use clinical assessment starter</button></div><div class="sk3-exam-config">` + this.draft.fields.map(field => `<div data-exam-config-row="${esc(field.id)}"><label class="sk3-field-wide">Field label<input name="label" maxlength="120" value="${esc(field.label)}"></label><label>Section<select name="section">${EXAM_SECTIONS.map(s => `<option value="${s.id}"${(field.section || "examination") === s.id ? " selected" : ""}>${esc(s.title)}</option>`).join("")}</select></label><label>Type<select name="type">` +
                ["assessment", "select", "textarea", "number", "text", "checkbox"].map(type => `<option value="${type}"${field.type === type ? " selected" : ""}>${type}</option>`).join("") + `</select></label><label>Unit<input name="unit" maxlength="40" value="${esc(field.unit || "")}"></label><label>Minimum<input type="number" step="any" name="min" value="${esc(field.min ?? "")}"></label><label>Maximum<input type="number" step="any" name="max" value="${esc(field.max ?? "")}"></label><label class="sk3-field-wide">Choices — one VALUE|Label per line<textarea name="options" rows="2">${esc((field.options || []).map(o => o.value + "|" + o.label).join("\n"))}</textarea></label><label class="sk3-field-wide">Require a note for these values (comma-separated)<input name="note-values" value="${esc((field.noteRequiredFor || []).join(","))}"></label><label class="sk3-check"><input type="checkbox" name="required"${field.required ? " checked" : ""}> Required</label><button type="button" class="sk3-chip" data-clinic="remove-exam-field" data-field="${esc(field.id)}">Remove field</button></div>`).join("") + `</div><button type="button" class="sk3-chip" data-clinic="add-exam-field">Add field</button>`, "save-exam-config", "Save form");
    }

    async saveExamConfig () {
        this.readDraft();
        if (!this.draft.title || !this.draft.fields.length || this.draft.fields.length > 50 || this.draft.fields.some(field => !field.label || (field.type === "select" && (!field.options.length || field.options.some(o => !o.value || !o.label) || new Set(field.options.map(o => o.value)).size !== field.options.length)) || (field.min != null && field.max != null && field.min > field.max))) { this.dialogRoot.querySelector(".sk3-dialog-error").textContent = "Provide a title, 1–50 labelled fields, unique selection values and valid entry ranges."; return; }
        const button = this.dialogRoot.querySelector('[data-clinic="save-exam-config"]');
        button.disabled = true;
        try {
            const result = await this.request("CLINIC_CONFIGURE", this.draft);
            this.definition = result.template;
            this.dialogRoot.close(); this.dialogRoot.remove(); this.draft = null;
            this.w.commit(); this.renderExam();
        } catch (error) { this.dialogRoot.querySelector(".sk3-dialog-error").textContent = error.message; }
        finally { button.disabled = false; }
    }

    onClick (event) {
        const button = event.target.closest("[data-clinic]");
        if (!button) { return; }
        const action = button.dataset.clinic;
        if (action === 'retry-exam') { this.ready = this.load(); return; }
        if (action === "show-exam") { this.openExam(); return; }
        if (action === "close-exam") { this.examDialog.close(); return; }
        if (action === "confirm-exam") {
            const errors = this.validate();
            if (errors.length) { this.examRoot.querySelector(".sk3-exam-error").textContent = errors[0]; this.examRoot.scrollTop = 0; }
            else { this.examDialog.close(); }
            return;
        }
        if (this.w.opts.readOnly || this.w.disabled) { return; }
        if (action === 'remove-retired') {
            const ids = new Set(this.definition.fields.map(field => field.id));
            for (const id of Object.keys(this.w.exam?.answers || {})) { if (!ids.has(id)) { delete this.w.exam.answers[id]; } }
            this.w.commit(); this.renderExam(); return;
        }
        if (action === "exam-reason") {
            const note = this.examRoot.querySelector('[data-exam-note="' + button.dataset.field + '"]');
            if (note) {
                const reason = button.dataset.reason, current = note.value.trim();
                note.value = (current.includes(reason) ? current : current ? current + '; ' + reason : reason).slice(0, LIMITS.examNote);
                this.recordExam(button.dataset.field, "note", note.value);
                note.focus();
            }
            return;
        }
        const section = button.closest(".sk3-site");
        const site = this.w.sites.find(row => this.w.keyOf(row) === (section?.dataset.key || this.w.active));
        if (action === "new-diagnosis" || action === "new-complaint") { this.addTermDialog(action === "new-diagnosis" ? "DIAGNOSIS" : "COMPLAINT"); }
        if (action === "save-term") { this.saveTerm(); }
        if (action === "close-dialog") { this.dialogRoot.close(); this.dialogRoot.remove(); this.draft = null; }
        if (action === "select-complaint" && site) { this.w.addComplaint(site, this.complaints[Number(button.dataset.index)]); }
        if (action === "remove-complaint" && site) { this.w.checkpoint(); site.complaints.splice(Number(button.dataset.index), 1); this.w.commit(); this.w.renderPanel(); }
        if (action === "configure-exam") { this.draft = null; this.configureExam(); }
        if (action === "use-starter") { this.draft = { ...clone(GENERAL_EXAM), version: this.definition.version }; this.configureExam(); }
        if (action === "review-exam" && this.w.exam) { this.w.exam.version = this.definition.version; this.w.exam.profile = this.definition.profile; this.w.commit(); this.renderExam(); }
        if (action === "save-exam-config") { this.saveExamConfig(); }
        if (action === "add-exam-field") { this.readDraft(); this.draft.fields.push({ id: "field_" + Date.now().toString(36), label: "", type: "assessment", required: false }); this.configureExam(); }
        if (action === "remove-exam-field") { this.readDraft(); this.draft.fields = this.draft.fields.filter(field => field.id !== button.dataset.field); this.configureExam(); }
    }

    onChange (event) {
        if (this.w.opts.readOnly || this.w.disabled) { return; }
        const target = event.target;
        if (target.hasAttribute("data-clinic-certainty")) {
            const section = target.closest(".sk3-site");
            const site = this.w.sites.find(row => this.w.keyOf(row) === section.dataset.key);
            if (site?.diagnoses[Number(target.dataset.clinicCertainty)]) {
                this.w.checkpoint();
                const term = site.diagnoses[Number(target.dataset.clinicCertainty)];
                if (CERTAINTIES.includes(target.value)) { term.certainty = target.value; } else { delete term.certainty; }
                this.w.commit();
            }
        }
        if (target.hasAttribute("data-exam-defer")) { this.recordExam(target.dataset.examDefer, "deferred", target.checked); this.renderExam(); }
        if (target.hasAttribute("data-exam-value") && target.tagName === "SELECT") { this.recordExam(target.dataset.examValue, "value", target.value); this.updateProgress(); }
        if (target.hasAttribute("data-exam-value") && target.type === "radio" && target.checked) { this.recordExam(target.dataset.examValue, "value", target.value); }
        if (target.hasAttribute("data-exam-value") && target.type === "checkbox") { this.recordExam(target.dataset.examValue, "value", target.checked); }
    }

    recordExam (id, key, value, delayed = false) {
        this.w.exam = this.w.exam || { template: "GENERAL", version: this.definition.version, ...(this.definition.profile ? { profile: this.definition.profile } : {}), answers: {} };
        const answer = this.w.exam.answers[id] || {};
        if (answer.prefill?.locked && key !== 'note') { return; }
        if (key === 'value' && answer.value !== value) { delete answer.prefill; }
        answer[key] = value;
        this.w.exam.answers[id] = answer;
        if (delayed) { this.w.commitLater(); } else { this.w.commit(); }
        this.updateProgress();
    }

    onInput (event) {
        if (this.w.opts.readOnly || this.w.disabled) { return; }
        const target = event.target;
        if (target.hasAttribute("data-exam-note")) { this.recordExam(target.dataset.examNote, "note", target.value, true); }
        if (target.hasAttribute("data-exam-value") && (target.tagName === "TEXTAREA" || ["text", "number"].includes(target.type))) { this.recordExam(target.dataset.examValue, "value", target.value === "" ? "" : target.type === "number" ? Number(target.value) : target.value, true); }
    }
}
