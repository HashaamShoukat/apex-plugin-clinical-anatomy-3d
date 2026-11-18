import { examErrors, escapeHtml as esc } from './clinical-value.js';
import { readContext, readContextOptions } from './patient-contract.js';
import { renderPatientSummary, renderPatientDetails, recordingFor } from './patient-summary.js';
import { normalizeSex } from './anatomy-contract.js';
export { readContext } from './patient-contract.js';

const copy = value => JSON.parse(JSON.stringify(value));

export class PatientContext {
    constructor (widget) {
        this.w = widget;
        this.sourceType = String(widget.opts.contextSourceType || 'ITEM').toUpperCase();
        this.requestId = 0;
        this.sourceBindings = [];
        this.root = document.createElement('div'); this.root.className = 'sk3-patient-context'; this.root.hidden = true;
        widget.root.prepend(this.root);
        this.dialogRoot = document.createElement('dialog');
        this.dialogRoot.className = 'sk3-dialog sk3-context-dialog';
        this.dialogRoot.setAttribute('aria-labelledby',widget.id+'_patient_details');
        widget.root.append(this.dialogRoot);
        try {
            if (!['NONE','ITEM','JSON','SQL','PLSQL'].includes(this.sourceType)) { throw Error('Choose a supported Patient Data Source. The JavaScript/API source was removed.'); }
            this.config = readContextOptions(widget.opts.contextOptions);
        }
        catch (error) { this.error = error.message; this.config = {}; this.configError = true; }
        for (const id of new Set([widget.opts.patientNameItem,widget.opts.patientMrnItem,this.sourceType === 'ITEM' ? widget.opts.contextSourceItem : ''].filter(Boolean))) {
            const element = document.getElementById(id);
            if (!element) { continue; }
            const refresh = () => { this.refresh(false); if (this.config.saveContext === true && !widget.opts.readOnly) { widget.commit(); } };
            if (window.apex?.jQuery) {
                const event = 'change.sk3Context'+widget.id;
                window.apex.jQuery(element).on(event,refresh); this.sourceBindings.push({element,event,refresh});
            } else { widget.listen(element,'change',refresh); }
        }
        widget.listen(widget.root,'click',event => {
            const action = event.target.closest('[data-patient]')?.dataset.patient;
            if (action === 'details') { renderPatientDetails(this); this.dialogRoot.showModal(); }
            if (action === 'close-details') { this.dialogRoot.close(); }
            if (action === 'retry') { this.reload(); }
        });
        this.refresh();
    }

    destroy () {
        this.requestId++;
        for (const binding of this.sourceBindings) { window.apex?.jQuery?.(binding.element).off(binding.event,binding.refresh); }
        this.dialogRoot.remove();
    }

    itemValue (id) {
        if (!id) { return ''; }
        return window.apex?.item ? window.apex.item(id).getValue() : document.getElementById(id)?.value || '';
    }

    refresh (silent = true) {
        if (this.configError) { this.render(); return; }
        try {
            const saved = this.w.recordContext;
            if (!saved && !this.overrideSet && (this.sourceError || this.w.opts.contextSourceError)) { throw Error(this.sourceError || this.w.opts.contextSourceError); }
            const value = this.overrideSet ? this.override : this.sourceType === 'NONE' ? null : this.sourceType === 'ITEM' && this.w.opts.contextSourceItem ? this.itemValue(this.w.opts.contextSourceItem) : this.w.opts.contextData;
            const source = saved || readContext(value);
            this.hasSource = !!source || (this.sourceType === 'ITEM' && !!(this.w.opts.patientNameItem || this.w.opts.patientMrnItem));
            this.data = source ? copy(source) : {patient:{},observations:[]};
            if (!saved && this.sourceType === 'ITEM') {
                for (const [key,item] of [['name',this.w.opts.patientNameItem],['mrn',this.w.opts.patientMrnItem]]) {
                    if (item && !this.data.patient[key] && this.itemValue(item) !== '') { this.data.patient[key] = String(this.itemValue(item)).slice(0,200); }
                }
            }
            this.error = null;
            this.prefill(silent);
        } catch (error) { this.error = error.message; this.data = null; }
        this.render();
    }

    async reload () {
        if (this.w.opts.readOnly || this.w.disabled) { return !this.error; }
        if (this.w.recordContext || this.w.sexMismatch || Object.values(this.w.exam?.answers || {}).some(answer => answer.prefill)) { return this.refreshSavedData(); }
        if (!['SQL','PLSQL'].includes(this.sourceType)) { this.refresh(); return !this.error; }
        const request = ++this.requestId;
        try {
            const result = await this.w.server({x01:'PATIENT_CONTEXT',pageItems:this.w.opts.contextItemsToSubmit || undefined});
            if (request !== this.requestId || this.w.destroyed) { return false; }
            if (result.error) { throw Error(result.error); }
            const data = readContext(result.contextData);
            this.w.opts.contextData = data; this.w.opts.contextSourceError = null;
            this.sourceError = null; this.overrideSet = false;
            this.refresh(false);
            if (this.config.saveContext === true && !this.w.opts.readOnly) { this.w.commit(); }
            return !this.error;
        } catch (error) {
            if (request !== this.requestId || this.w.destroyed) { return false; }
            this.sourceError = error.message; this.error = error.message; this.data = null;
            this.render(); return false;
        }
    }

    snapshot () {
        if (this.w.recordContext) { return copy(this.w.recordContext); }
        return this.config.saveContext === true && this.hasSource && this.data && !this.error ? copy(this.data) : null;
    }

    async refreshSavedData () {
        const reason = 'Patient data refreshed by application';
        const w = this.w;
        if (w.opts.readOnly || w.disabled) { return false; }
        const fail = message => { w.clinic.message(message); return false; };
        const token = ++this.requestId;
        const before = w.serialize();
        try {
            let data;
            if (['SQL','PLSQL'].includes(this.sourceType)) {
                const result = await w.server({x01:'PATIENT_CONTEXT',pageItems:w.opts.contextItemsToSubmit || undefined});
                if (result.error) { throw Error(result.error); }
                data = readContext(result.contextData);
            } else { data = readContext(this.sourceType === 'NONE' ? null : this.sourceType === 'ITEM' ? this.itemValue(w.opts.contextSourceItem) : w.opts.contextData); }
            if (token !== this.requestId || w.destroyed || w.opts.readOnly || w.disabled) { return false; }
            if (w.serialize() !== before) { return fail('The assessment changed during refresh. Try again.'); }
            const old = w.recordContext?.patient || this.data?.patient || {};
            for (const key of ['id','encounterId','mrn']) {
                if (old[key] && data?.patient?.[key] && old[key] !== data.patient[key]) { return fail('The patient or encounter changed. Load the correct assessment before continuing.'); }
            }
            w.flushCommit();
            w.contextRefresh = {at:new Date().toISOString(),note:reason.trim(),previousSex:w.sex};
            this.refreshingPrefills = new Set(Object.keys(w.exam?.answers || {}).filter(id => w.exam.answers[id].prefill));
            for (const answer of Object.values(w.exam?.answers || {})) {
                if (answer.prefill) { if (data) { delete answer.value; } delete answer.prefill; }
            }
            w.recordContext = null; this.overrideSet = false; this.sourceError = null;
            w.opts.contextData = data; w.opts.contextSourceError = null;
            if (data?.patient?.sex != null) { w.opts.sex = normalizeSex(data.patient.sex); }
            if (w.sex !== normalizeSex(w.opts.sex)) {
                if (normalizeSex(w.opts.sex) !== 'M' && w.sites.some(site => site.area === 'PROSTATE')) {
                    w.sexMismatch = true;
                } else { w.sex = normalizeSex(w.opts.sex); w.sexMismatch = false; w.setSexQuiet(); }
            }
            this.refresh(false);
            if (this.config.saveContext === true && this.hasSource && !this.error) { w.recordContext = copy(this.data); }
            this.refreshingPrefills = null; w.clinic.renderExam(); w.commit();
            return true;
        } catch (error) { return fail(error.message); }
    }

    validationMessage () {
        if (this.w.sexMismatch) { return 'The recorded sex differs from the current patient. Remove incompatible findings, then refresh the patient source.'; }
        return this.error && (this.configError || this.config.patientDataRequired === true) ? 'Patient data: '+this.error : '';
    }

    prefill (silent = true) {
        const w = this.w, clinic = w.clinic;
        if (w.opts.ajaxId && !['ITEM','JSON','SQL','PLSQL'].includes(this.sourceType)) { return false; }
        if (!this.data || !clinic?.loaded || w.opts.readOnly || w.opts.examMode === 'OFF' || this.config.prefillExam === false) { return false; }
        if (w.exam && (w.exam.version !== clinic.definition.version || w.exam.profile !== clinic.definition.profile)) { return false; }
        w.flushCommit();
        let changed = false;
        for (const row of this.data.observations) {
            const id = row.examField || row.id, field = clinic.definition.fields.find(field=>field.id === id), old = w.exam?.answers?.[id];
            if (!field || ((old?.deferred || old?.note) && !this.refreshingPrefills?.has(id)) || (old?.value != null && old.value !== '') || row.value == null || row.value === '') { continue; }
            if (row.unit && field.unit && row.unit !== field.unit) { continue; }
            if (examErrors({fields:[{...field,required:false}],allowDeferred:false},{[id]:{value:row.value}}).length) { continue; }
            w.exam ||= {template:'GENERAL',version:clinic.definition.version,...(clinic.definition.profile ? {profile:clinic.definition.profile} : {}),answers:{}};
            const recording = recordingFor(this.data,row);
            const prefill = {source:recording.source || 'Supplied observation',...(recording.recordedBy ? {recordedBy:recording.recordedBy} : {}),...(recording.recordedAt ? {recordedAt:recording.recordedAt} : {}),locked:row.readOnly === true || this.config.lockPrefilled === true};
            w.exam.answers[id] = {...(old?.note ? {note:old.note} : {}),value:row.value,prefill};
            changed = true;
        }
        if (changed) { w.commit(silent); clinic.renderExam(); }
        return changed;
    }

    render () {
        if (this.error) {
            this.root.hidden = false;
            this.root.innerHTML = '<div class="sk3-context-error" role="status"><span>Patient data unavailable: '+esc(this.error)+'</span>'+(['SQL','PLSQL'].includes(this.sourceType) ? '<button type="button" class="sk3-chip" data-patient="retry">Retry</button>' : '')+'</div>';
            return;
        }
        renderPatientSummary(this);
    }
}
