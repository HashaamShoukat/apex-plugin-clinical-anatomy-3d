// Dynamic Action: put the unified JSON into the configured Patient & Observations Item.
// The example item must exist and be selected in the plug-in configuration.
const payload = {patient:{name:'Demo patient (fictional)',mrn:'DEMO-001'},observations:[]};
apex.item('P402_PATIENT_JSON').setValue(JSON.stringify(payload));
await skeleton3d.get('P402_ANATOMY').refreshContext();
// For a saved snapshot, use the explicit Use current patient data action to amend it.
