declare
  l_payload clob;
begin
  select json_object(
  'patient' value json_object(
    'name' value :P402_PATIENT_NAME, 'mrn' value :P402_MRN,
    'id' value 'DEMO-001', 'age' value 42, 'sex' value 'Male',
    'dateOfBirth' value '1984-03-10', 'encounterId' value 'VISIT-DEMO-001',
    'details' value json_array(json_object('id' value 'department', 'label' value 'Department', 'value' value 'General medicine'))),
  'recording' value json_object('source' value 'Nursing intake (demo)',
    'recordedBy' value 'Demo nurse', 'recordedAt' value '2026-11-17T09:15:00+03:00'),
  'observations' value json_query(q'~[{"id":"bp_systolic","label":"Systolic BP","value":126,"unit":"mmHg","examField":"bp_systolic"},{"id":"bp_diastolic","label":"Diastolic BP","value":78,"unit":"mmHg","examField":"bp_diastolic"},{"id":"pulse","label":"Pulse","value":82,"unit":"beats/min","examField":"pulse"},{"id":"temperature","label":"Temperature","value":36.8,"unit":"°C","examField":"temperature","readOnly":true},{"id":"weight","label":"Weight","value":72,"unit":"kg","examField":"weight","flag":"Review","highlight":true,"note":"Example review flag supplied by the source."},{"id":"height","label":"Height","value":175,"unit":"cm","examField":"height"},{"id":"spo2","label":"Oxygen saturation","value":98,"unit":"%","examField":"spo2"},{"id":"respiratory_rate","label":"Respiratory rate","value":16,"unit":"breaths/min","examField":"respiratory_rate"}]~', '$' returning clob)
  returning clob) into l_payload
from dual;
  return l_payload;
end;
