const object = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const scalar = value => value == null || typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value);
const text = (value,name,max=200) => {
    if (value == null) { return ''; }
    if (typeof value !== 'string' || value.length>max) { throw Error(name+' must be text of up to '+max+' characters.'); }
    return value;
};
const parse = (value,name) => {
    try { return typeof value === 'string' ? JSON.parse(value) : JSON.parse(JSON.stringify(value)); }
    catch (_) { throw Error(name+' must contain valid JSON.'); }
};

export const PATIENT_FIELDS = ['name','mrn','id','age','sex','dateOfBirth','encounterId','details','observations'];
export const PATIENT_LABELS = {name:'Patient',mrn:'MR number',id:'Patient ID',age:'Age',sex:'Sex',dateOfBirth:'Date of birth',encounterId:'Visit'};
export const OBSERVATION_PRESETS = {
    bp_systolic:{label:'Systolic BP',unit:'mmHg'}, bp_diastolic:{label:'Diastolic BP',unit:'mmHg'},
    pulse:{label:'Pulse',unit:'beats/min'}, respiratory_rate:{label:'Respiratory rate',unit:'breaths/min'},
    temperature:{label:'Temperature',unit:'\u00b0C'}, spo2:{label:'Oxygen saturation',unit:'%'},
    weight:{label:'Weight',unit:'kg'}, height:{label:'Height',unit:'cm'},
    bmi:{label:'BMI',unit:'kg/m\u00b2'}, glucose:{label:'Blood glucose',unit:'mmol/L'}, pain:{label:'Pain score',unit:'/10'}
};

export function readContextOptions (input) {
    const config = input == null || input === '' ? {} : parse(input,'Display & Prefill Options');
    if (!object(config)) { throw Error('Display & Prefill Options must be a JSON object. Leave {} for defaults.'); }
    const allowed = ['fields','labels','observationIds','prefillExam','lockPrefilled','saveContext','maxVisibleObservations','patientDataRequired'];
    for (const key of Object.keys(config)) { if (!allowed.includes(key)) { throw Error('Unknown Display & Prefill Option: '+key+'.'); } }
    if (config.fields != null && (!Array.isArray(config.fields) || config.fields.some(key=>!PATIENT_FIELDS.includes(key)))) { throw Error('fields must be an array of supported patient fields.'); }
    if (config.observationIds != null && (!Array.isArray(config.observationIds) || config.observationIds.some(id=>!identifier(id)))) { throw Error('observationIds must be an array of observation IDs.'); }
    if (config.labels != null) {
        if (!object(config.labels)) { throw Error('labels must be an object.'); }
        for (const [key,value] of Object.entries(config.labels)) {
            if (!own(PATIENT_LABELS,key)) { throw Error('Unknown patient label: '+key+'.'); }
            text(value,'labels.'+key,120);
        }
    }
    for (const key of ['prefillExam','lockPrefilled','saveContext','patientDataRequired']) { if (config[key] != null && typeof config[key] !== 'boolean') { throw Error(key+' must be true or false.'); } }
    if (config.maxVisibleObservations != null && (!Number.isInteger(config.maxVisibleObservations) || config.maxVisibleObservations<1 || config.maxVisibleObservations>12)) { throw Error('maxVisibleObservations must be an integer from 1 to 12.'); }
    return config;
}

export function readContext (input) {
    if (input == null || input === '') { return null; }
    const data = parse(input,'Patient data');
    if (!object(data) || JSON.stringify(data).length>32767) { throw Error('Patient data must be one JSON object of up to 32767 characters.'); }
    const result = {patient:{},observations:[]};
    if (data.patient != null && !object(data.patient)) { throw Error('patient must be an object.'); }
    for (const key of ['name','mrn','id','sex','dateOfBirth','encounterId']) {
        if (data.patient?.[key] != null) { result.patient[key] = text(data.patient[key],'patient.'+key,['name','mrn'].includes(key)?200:100); }
    }
    if (data.patient?.age != null) {
        if (!Number.isFinite(data.patient.age) || data.patient.age<0 || data.patient.age>150) { throw Error('Patient age must be a number between 0 and 150.'); }
        result.patient.age = data.patient.age;
    }
    if (data.patient?.details != null) {
        if (!Array.isArray(data.patient.details) || data.patient.details.length>12) { throw Error('Patient details supports up to 12 entries.'); }
        const seen = new Set();
        result.patient.details = data.patient.details.map(row=>{
            if (!object(row) || !identifier(row.id) || seen.has(row.id) || !own(row,'value') || !scalar(row.value)) { throw Error('Patient details require unique IDs and scalar values.'); }
            seen.add(row.id);
            if (typeof row.value === 'string') { text(row.value,'Patient detail value',400); }
            return {id:row.id,label:text(row.label == null || row.label==='' ? row.id : row.label,'Patient detail label',120),value:row.value,...(row.unit != null ? {unit:text(row.unit,'Patient detail unit',40)} : {})};
        });
    }
    if (data.recording != null) {
        if (!object(data.recording)) { throw Error('recording must be an object.'); }
        result.recording = {};
        for (const key of ['source','recordedBy','recordedAt']) { if (data.recording[key] != null) { result.recording[key] = text(data.recording[key],'recording.'+key,120); } }
    }
    if (data.observations != null && (!Array.isArray(data.observations) || data.observations.length>40)) { throw Error('Patient data supports up to 40 observations.'); }
    const seen = new Set();
    for (const row of data.observations || []) {
        if (!object(row) || !identifier(row.id) || seen.has(row.id)) { throw Error('Observations require unique alphanumeric IDs.'); }
        if (!own(row,'value') || !scalar(row.value)) { throw Error('Observation values must be text, finite numbers, booleans or null.'); }
        seen.add(row.id);
        if (typeof row.value === 'string') { text(row.value,'Observation value',200); }
        const preset = OBSERVATION_PRESETS[row.id] || {};
        const observation = {id:row.id,label:text(row.label == null || row.label==='' ? preset.label || row.id : row.label,'Observation label',120),value:row.value};
        if (row.unit == null && preset.unit) { observation.unit = preset.unit; }
        for (const key of ['unit','flag','source','recordedBy','recordedAt','examField','note']) {
            if (row[key] != null) { observation[key] = text(row[key],key,key === 'note' ? 500 : ['unit','flag'].includes(key)?40:120); }
        }
        for (const key of ['highlight','readOnly','hidden']) {
            if (row[key] != null) {
                if (typeof row[key] !== 'boolean') { throw Error(key+' must be boolean.'); }
                observation[key] = row[key];
            }
        }
        result.observations.push(observation);
    }
    return result;
}

export const PATIENT_PAYLOAD_EXAMPLE = {
    patient:{name:'Demo patient (fictional)',mrn:'DEMO-CA3D-001',id:'DEMO-001',age:42,sex:'Male',dateOfBirth:'1984-03-10',encounterId:'VISIT-DEMO-001',details:[{id:'department',label:'Department',value:'General medicine'},{id:'room',label:'Room',value:'A12'}]},
    recording:{source:'Nursing intake (demo)',recordedBy:'Demo nurse',recordedAt:'2026-11-17T09:15:00+03:00'},
    observations:[
        {id:'bp_systolic',label:'Systolic BP',value:126,unit:'mmHg',examField:'bp_systolic'},
        {id:'bp_diastolic',label:'Diastolic BP',value:78,unit:'mmHg',examField:'bp_diastolic'},
        {id:'pulse',label:'Pulse',value:82,unit:'beats/min',examField:'pulse'},
        {id:'temperature',label:'Temperature',value:36.8,unit:'\u00b0C',examField:'temperature',readOnly:true},
        {id:'weight',label:'Weight',value:72,unit:'kg',examField:'weight',flag:'Review',highlight:true,note:'Example review flag supplied by the source.'},
        {id:'height',label:'Height',value:175,unit:'cm',examField:'height'},
        {id:'spo2',label:'Oxygen saturation',value:98,unit:'%',examField:'spo2'},
        {id:'respiratory_rate',label:'Respiratory rate',value:16,unit:'breaths/min',examField:'respiratory_rate'},
        {id:'bmi',label:'BMI',value:23.5,unit:'kg/m\u00b2'},
        {id:'glucose',label:'Blood glucose',value:5.2,unit:'mmol/L'},
        {id:'pain',label:'Pain score',value:2,unit:'/10'},
        {id:'custom_observation',label:'Your custom label',value:'Your supplied value',unit:'',source:'Your source',recordedBy:'Your recorder',recordedAt:'2026-11-17T09:15:00+03:00',flag:'',highlight:false,readOnly:false,hidden:true,note:'Optional note',examField:'your_configured_exam_field'}
    ]
};
