import { escapeHtml as esc } from './clinical-value.js';
import { PATIENT_FIELDS, PATIENT_LABELS } from './patient-contract.js';

const present = value => value != null && value !== '';
const valueText = value => value == null || value === '' ? 'Not recorded' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
export const recordingFor = (data,row={}) => Object.fromEntries(['source','recordedBy','recordedAt'].map(key=>[key,row[key] || data?.recording?.[key] || '']));
const flagged = row => row.highlight === true || (!!row.flag && row.flag.toUpperCase() !== 'NORMAL');
const sourceText = meta => [meta.source,meta.recordedBy,meta.recordedAt].filter(Boolean).join(' · ');
const visibleRows = context => (context.data?.observations || []).filter(row=>!row.hidden && (!context.config.observationIds || context.config.observationIds.includes(row.id)));

export function renderPatientSummary (context) {
    const {config,data}=context, patient=data?.patient || {}, fields=config.fields || PATIENT_FIELDS;
    const label=key=>config.labels?.[key] || PATIENT_LABELS[key];
    const keys=['mrn','id','age','sex','dateOfBirth','encounterId'].filter(key=>fields.includes(key)&&present(patient[key]));
    const name=fields.includes('name') ? patient.name : '';
    const allRows=fields.includes('observations') ? visibleRows(context) : [];
    const rows=allRows.filter(row=>present(row.value));
    const details=fields.includes('details') ? (patient.details || []) : [];
    context.root.hidden=!name&&!keys.length&&!allRows.length&&!details.length;
    if(context.root.hidden){context.root.replaceChildren();return;}
    const initials=String(name || '').trim().split(/\s+/).filter(Boolean).slice(0,2).map(word=>Array.from(word)[0]).join('').toUpperCase();
    const person=name?'<div class="sk3-patient-person"><span class="sk3-patient-avatar" aria-hidden="true">'+esc(initials)+'</span><strong class="sk3-patient-name">'+esc(name)+'</strong></div>':'';
    const meta=keys.map(key=>'<span class="sk3-patient-detail"><span>'+esc(label(key))+'</span><strong>'+esc(patient[key])+(key==='age'?' <small>years</small>':'')+'</strong></span>').join('');
    const groups=[], used=new Set(), systolic=rows.find(row=>row.id==='bp_systolic'), diastolic=rows.find(row=>row.id==='bp_diastolic');
    for(const row of rows){
        if(used.has(row.id))continue;
        if(['bp_systolic','bp_diastolic'].includes(row.id)&&systolic&&diastolic&&systolic.unit===diastolic.unit){
            used.add(systolic.id);used.add(diastolic.id);groups.push({label:'Blood pressure',rows:[systolic,diastolic],bp:true});
        }else{used.add(row.id);groups.push({label:row.label,rows:[row]});}
    }
    const shown=groups.slice(0,config.maxVisibleObservations || 6), remaining=groups.length-shown.length;
    const cards=shown.map(group=>{
        const first=group.rows[0], flags=[...new Set(group.rows.map(row=>row.flag).filter(Boolean))];
        const values=group.bp ? group.rows.map(row=>'<span data-observation="'+esc(row.id)+'">'+esc(valueText(row.value))+'</span>').join('<span class="sk3-bp-slash" aria-hidden="true">/</span>') : esc(valueText(first.value));
        const unit=first.unit ? ' <small>'+esc(first.unit)+'</small>' : '';
        const classes='sk3-observation'+(group.rows.some(flagged)?' is-highlighted':'');
        return '<div class="'+classes+'" role="listitem" '+(group.bp?'data-observation-group="blood_pressure"':'data-observation="'+esc(first.id)+'"')+' title="'+esc(sourceText(recordingFor(data,first)))+'"><span class="sk3-observation-label">'+esc(group.label)+'</span><strong class="sk3-observation-value">'+values+unit+'</strong>'+(flags.length?'<span class="sk3-observation-flag">'+esc(flags.join(' / '))+'</span>':group.bp?'<span class="sk3-observation-caption">Systolic / Diastolic</span>':'')+'</div>';
    }).join('');
    const sources=[...new Set(rows.map(row=>sourceText(recordingFor(data,row))).filter(Boolean))];
    const footer=sources.length===1?sources[0]:sources.length>1?'Supplied observations · Multiple recording sources':'';
    const hasDetails=allRows.length || details.length;
    context.root.innerHTML='<div class="sk3-patient-identity">'+person+'<div class="sk3-patient-meta">'+meta+'</div>'+(hasDetails?'<button type="button" class="sk3-chip sk3-patient-details-button" data-patient="details" aria-haspopup="dialog">'+(remaining?'View all '+rows.length+' observations':'Details')+'</button>':'')+'</div>'+(shown.length?'<div class="sk3-observation-grid" role="list" aria-label="Supplied observations">'+cards+'</div>':'')+(footer?'<div class="sk3-observation-footer" title="'+esc(footer)+'"><span>'+esc(footer)+'</span>'+(remaining?'<span>+'+remaining+' more measurements</span>':'')+'</div>':'');
}

export function renderPatientDetails (context) {
    const {config,data}=context, patient=data?.patient || {}, fields=config.fields || PATIENT_FIELDS;
    const identity=['name','mrn','id','age','sex','dateOfBirth','encounterId'].filter(key=>fields.includes(key)&&present(patient[key])).map(key=>'<div><dt>'+esc(config.labels?.[key] || PATIENT_LABELS[key])+'</dt><dd>'+esc(patient[key])+(key==='age'?' years':'')+'</dd></div>').join('');
    const custom=fields.includes('details')?(patient.details || []).map(row=>'<div><dt>'+esc(row.label)+'</dt><dd>'+esc(valueText(row.value))+(row.unit?' '+esc(row.unit):'')+'</dd></div>').join(''):'';
    const rows=fields.includes('observations')?visibleRows(context):[];
    context.dialogRoot.innerHTML='<header class="sk3-context-dialog-heading"><div><h2 id="'+esc(context.w.id)+'_patient_details">Patient & observations</h2><p>Supplied values and recording details</p></div><button type="button" class="sk3-chip" data-patient="close-details" aria-label="Close patient details">Close</button></header>'+
        '<div class="sk3-context-dialog-body">'+(identity||custom?'<dl class="sk3-patient-detail-list">'+identity+custom+'</dl>':'')+(rows.length?'<div class="sk3-observation-detail-list">'+rows.map(row=>{
            const recording=recordingFor(data,row), information=sourceText(recording);
            return '<section class="sk3-observation-detail"><div><h3>'+esc(row.label)+'</h3><strong>'+esc(valueText(row.value))+(row.unit?' <small>'+esc(row.unit)+'</small>':'')+'</strong></div>'+(row.flag?'<span class="sk3-observation-flag">'+esc(row.flag)+'</span>':'')+(information?'<p>'+esc(information)+'</p>':'')+(row.readOnly||config.lockPrefilled?'<p class="sk3-detail-muted">Supplied as read only for examination prefilling</p>':'')+(row.note?'<p>'+esc(row.note)+'</p>':'')+'</section>';
        }).join('')+'</div>':'')+'</div>';
}
