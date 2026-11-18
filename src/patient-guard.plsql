-- Canonicalize the server source in the same way as patient-contract.js.
function normalized_context(p_value clob) return json_object_t is
    l_source json_object_t;
    l_result json_object_t:=json_object_t();
    l_patient json_object_t:=json_object_t();
    l_recording json_object_t;
    l_rows json_array_t;
    l_out json_array_t:=json_array_t();
    l_row json_object_t;
    l_clean json_object_t;
    l_preset json_object_t;
    l_presets json_object_t:=json_object_t.parse(q'~@@OBSERVATION_PRESETS_JSON@@~');
    l_value json_element_t;
    l_keys sys.odcivarchar2list;
    procedure copy_fields(p_from json_object_t,p_to in out nocopy json_object_t,p_keys sys.odcivarchar2list) is
        l_value json_element_t;
    begin
        if p_from is null then return; end if;
        for i in 1..p_keys.count loop
            l_value:=p_from.get(p_keys(i));
            if l_value is not null and not l_value.is_null then p_to.put(p_keys(i),l_value); end if;
        end loop;
    end;
begin
    if p_value is null then return null; end if;
    l_source:=json_object_t.parse(p_value);
    copy_fields(l_source.get_object('patient'),l_patient,sys.odcivarchar2list('name','mrn','id','sex','dateOfBirth','encounterId','age'));
    if l_source.get_object('patient') is not null then
        l_patient:=l_source.get_object('patient');
        l_rows:=l_patient.get_array('details');
        l_patient:=json_object_t();
        copy_fields(l_source.get_object('patient'),l_patient,sys.odcivarchar2list('name','mrn','id','sex','dateOfBirth','encounterId','age'));
        if l_rows is not null then
            for i in 0..l_rows.get_size-1 loop
                l_row:=treat(l_rows.get(i) as json_object_t);l_clean:=json_object_t();
                copy_fields(l_row,l_clean,sys.odcivarchar2list('id','unit'));l_clean.put('value',l_row.get('value'));
                l_clean.put('label',nvl(l_row.get_string('label'),l_row.get_string('id')));l_out.append(l_clean);
            end loop;
            l_patient.put('details',l_out);
        end if;
    end if;
    l_result.put('patient',l_patient);
    if l_source.get_object('recording') is not null then
        l_recording:=json_object_t();
        copy_fields(l_source.get_object('recording'),l_recording,sys.odcivarchar2list('source','recordedBy','recordedAt'));
        l_result.put('recording',l_recording);
    end if;
    l_rows:=l_source.get_array('observations');l_out:=json_array_t();
    if l_rows is not null then
        for i in 0..l_rows.get_size-1 loop
            l_row:=treat(l_rows.get(i) as json_object_t);l_clean:=json_object_t();
            copy_fields(l_row,l_clean,sys.odcivarchar2list('id','unit','flag','source','recordedBy','recordedAt','examField','note','highlight','readOnly','hidden'));
            l_clean.put('value',l_row.get('value'));l_preset:=l_presets.get_object(l_row.get_string('id'));
            l_clean.put('label',nvl(l_row.get_string('label'),case when l_preset is not null then nvl(l_preset.get_string('label'),l_row.get_string('id')) else l_row.get_string('id') end));
            l_value:=l_row.get('unit');
            if (l_value is null or l_value.is_null) and l_preset is not null and l_preset.has('unit') then l_clean.put('unit',l_preset.get('unit')); end if;
            l_out.append(l_clean);
        end loop;
    end if;
    l_result.put('observations',l_out);return l_result;
end;

-- p_context and p_definition MUST come from authorized server queries, never request JSON.
function validate_patient(p_value clob,p_context clob,p_options varchar2 default '{}',p_definition clob default null) return varchar2 is
    l_doc json_object_t;
    l_expected json_object_t;
    l_actual json_object_t;
    l_options json_object_t;
    l_exam json_object_t;
    l_answers json_object_t:=json_object_t();
    l_answer json_object_t;
    l_prefill json_object_t;
    l_expected_prefill json_object_t;
    l_recording json_object_t;
    l_rows json_array_t;
    l_row json_object_t;
    l_fields json_array_t;
    l_field json_object_t;
    l_value json_element_t;
    l_choices json_array_t;
    l_choice json_object_t;
    l_notes json_array_t;
    l_names json_key_list;
    l_keys sys.odcivarchar2list:=sys.odcivarchar2list('source','recordedBy','recordedAt');
    l_field_id varchar2(128);
    l_patient json_object_t;
    l_sex varchar2(100);
    l_error varchar2(4000);
    l_text varchar2(120);
    l_locked boolean;
    l_known boolean;
    l_match number;
    l_left clob;
    l_right clob;
    function same(p_left json_element_t,p_right json_element_t) return boolean is
    begin
        if p_left is null or p_right is null then return p_left is null and p_right is null; end if;
        l_left:=p_left.to_clob;l_right:=p_right.to_clob;
        select case when json_equal(l_left,l_right) then 1 else 0 end into l_match from dual;
        return l_match=1;
    end;
begin
    begin
        l_options:=json_object_t.parse(nvl(p_options,'{}'));
        if l_options is null then raise_application_error(-20071,'Options must be an object.');end if;
    exception when others then return 'Display & Prefill Options must be a valid JSON object. Leave {} for defaults.'; end;
    if p_value is null then return null; end if;
    if p_context is not null then
        l_error:=validate_payload(to_clob('{"sites":[],"context":')||p_context||'}');
        if l_error is not null then return 'The authorized patient source is invalid: '||l_error; end if;
    end if;
    l_doc:=json_object_t.parse(p_value);l_expected:=normalized_context(p_context);
    l_actual:=l_doc.get_object('context');l_exam:=l_doc.get_object('exam');
    if l_exam is not null and l_exam.get_object('answers') is not null then l_answers:=l_exam.get_object('answers'); end if;
    if l_actual is not null and (l_expected is null or not same(l_actual,l_expected)) then
        return 'The patient snapshot differs from the authorized server source. Reload the patient data before saving.';
    end if;
    l_names:=l_answers.get_keys;
    if l_expected is null then
        for i in 1..l_names.count loop
            l_answer:=l_answers.get_object(l_names(i));
            if l_answer.get_object('prefill') is not null then return 'Prefill history requires an authorized JSON, SQL or PL/SQL patient source.'; end if;
        end loop;
        return null;
    end if;
    l_patient:=l_expected.get_object('patient');
    if l_patient.has('sex') then
        l_sex:=upper(trim(l_patient.get_string('sex')));
        l_sex:=case when l_sex in ('M','MALE') then 'M' when l_sex in ('F','FEMALE') then 'F' else 'U' end;
        l_error:=validate_payload(p_value,'ALL',l_sex);
        if l_error is not null then return l_error; end if;
    end if;
    if nvl(l_options.get_boolean('saveContext'),false) and l_actual is null then return 'The patient snapshot is missing. Reload the patient data before saving.'; end if;
    if p_definition is not null then l_field:=json_object_t.parse(p_definition);l_fields:=l_field.get_array('fields'); end if;
    l_rows:=l_expected.get_array('observations');l_recording:=l_expected.get_object('recording');
    if l_recording is null then l_recording:=json_object_t(); end if;
    -- Reject invented provenance even on an otherwise unlocked answer.
    for i in 1..l_names.count loop
        l_answer:=l_answers.get_object(l_names(i));
        if l_answer.get_object('prefill') is not null then
            l_known:=false;
            for j in 0..l_rows.get_size-1 loop
                l_row:=treat(l_rows.get(j) as json_object_t);
                if nvl(l_row.get_string('examField'),l_row.get_string('id'))=l_names(i) then l_known:=true; end if;
            end loop;
            if not l_known then return 'An examination answer contains unverified prefill history.'; end if;
        end if;
    end loop;
    for j in 0..l_rows.get_size-1 loop
        l_row:=treat(l_rows.get(j) as json_object_t);l_field_id:=nvl(l_row.get_string('examField'),l_row.get_string('id'));
        l_answer:=l_answers.get_object(l_field_id);l_known:=false;
        l_value:=l_row.get('value');
        if l_fields is not null then
            for i in 0..l_fields.get_size-1 loop
                l_field:=treat(l_fields.get(i) as json_object_t);
                if l_field.get_string('id')=l_field_id and (l_row.get_string('unit') is null or l_field.get_string('unit') is null or l_row.get_string('unit')=l_field.get_string('unit')) then
                    l_known:=l_value is not null and not l_value.is_null and (l_value.is_number or l_value.is_boolean or l_row.get_string('value') is not null);
                    if l_field.get_string('type')='number' then
                        l_known:=l_known and l_value.is_number and (not l_field.has('min') or l_row.get_number('value')>=l_field.get_number('min')) and (not l_field.has('max') or l_row.get_number('value')<=l_field.get_number('max'));
                    elsif l_field.get_string('type')='checkbox' then l_known:=l_known and l_value.is_boolean;
                    elsif l_field.get_string('type')='assessment' then l_known:=l_known and l_row.get_string('value') in ('NORMAL','ABNORMAL');
                    elsif l_field.get_string('type')='select' then
                        l_known:=false;l_choices:=l_field.get_array('options');
                        for n in 0..l_choices.get_size-1 loop l_choice:=treat(l_choices.get(n) as json_object_t);if l_choice.get_string('value')=l_row.get_string('value') then l_known:=true;end if;end loop;
                    end if;
                    l_notes:=l_field.get_array('noteRequiredFor');
                    if l_notes is not null then for n in 0..l_notes.get_size-1 loop if l_notes.get_string(n)=l_row.get_string('value') then l_known:=false;end if;end loop;end if;
                    exit;
                end if;
            end loop;
        end if;
        l_locked:=nvl(l_row.get_boolean('readOnly'),false) or nvl(l_options.get_boolean('lockPrefilled'),false);
        if (l_known and l_locked and nvl(l_options.get_boolean('prefillExam'),true))
           or (l_answer is not null and l_answer.get_object('prefill') is not null) then
            if l_answer is null then return 'A locked prefilled examination answer is missing.'; end if;
            l_prefill:=l_answer.get_object('prefill');l_expected_prefill:=json_object_t();
            for i in 1..l_keys.count loop
                l_text:=nvl(l_row.get_string(l_keys(i)),l_recording.get_string(l_keys(i)));
                if i=1 then l_text:=nvl(l_text,'Supplied observation'); end if;
                if l_text is not null then l_expected_prefill.put(l_keys(i),l_text); end if;
            end loop;
            l_expected_prefill.put('locked',l_locked);
            if l_prefill is null or not same(l_prefill,l_expected_prefill) or not same(l_answer.get('value'),l_row.get('value'))
               or nvl(l_answer.get_boolean('deferred'),false) then
                return 'A prefilled value or its source history changed. Reload the patient data before saving.';
            end if;
        end if;
    end loop;
    return null;
exception when others then
    apex_debug.error('Clinical Anatomy 3D patient validation: %s',sqlerrm);
    return 'The patient source could not be verified. Reload the patient data before saving.';
end;
