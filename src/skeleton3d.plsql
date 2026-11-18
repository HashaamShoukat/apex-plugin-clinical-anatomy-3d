-- Clinical Anatomy 3D for Oracle APEX - callback package body source.
-- Build generates dist/db/skeleton3d_pkg.sql from this file and payload.plsql.
-- The item value is JSON written by the browser:
--   {"v":1,"sex":"M","sites":[{"area":"KNEE","side":"L","label":"Left knee","pain":6,"note":"...",
--     "diagnoses":[{"code":"M17.9","label":"Gonarthrosis, unspecified","system":"ICD-10"}]}]}
-- Attributes: 1 skeleton (MALE / FEMALE / ITEM), 2 item holding the patient's sex, 3 options, 4 select by,
--   5 height, 6 maximum sites, 7 diagnosis suggestions (enabled/hidden),
--   11 specialty, 12 initial anatomy layer. Retired SQL, clinic-mode and scope attributes are ignored.

c_max_rows constant pls_integer := 60;

function attr ( p_item in apex_plugin.t_item, p_no in pls_integer ) return varchar2
is
begin
    return p_item.attributes.get_varchar2('attribute_' || to_char(p_no, 'FM00'));
exception
    when others then
        return null;
end attr;

-- Trusted developer-configured sources only. Browser requests never supply SQL or PL/SQL.
function patient_data(p_source_type in varchar2,p_source in varchar2) return clob is
    l_ctx apex_exec.t_context;
    l_column apex_exec.t_column;
    l_open boolean:=false;
    l_value clob;
    l_error varchar2(4000);
    l_object json_object_t;
begin
    if p_source is null then return null; end if;
    case p_source_type
    when 'ITEM' then l_value:=to_clob(v(p_source));
    when 'JSON' then l_value:=to_clob(p_source);
    when 'PLSQL' then l_value:=apex_plugin_util.get_plsql_func_result_clob(p_plsql_function=>p_source);
    when 'SQL' then
        l_ctx:=apex_exec.open_query_context(p_location=>apex_exec.c_location_local_db,p_sql_query=>rtrim(trim(p_source),';'),p_max_rows=>2,p_auto_bind_items=>true);
        l_open:=true;
        if apex_exec.get_column_count(l_ctx)<>1 then raise_application_error(-20071,'Patient query must return exactly one JSON column.');end if;
        if apex_exec.next_row(l_ctx) then
            l_column:=apex_exec.get_column(l_ctx,1);
            if l_column.data_type=apex_exec.c_data_type_clob then l_value:=apex_exec.get_clob(l_ctx,1);
            else l_value:=to_clob(apex_exec.get_varchar2(l_ctx,1));end if;
            if apex_exec.next_row(l_ctx) then raise_application_error(-20071,'Patient query must return at most one row.');end if;
        end if;
        apex_exec.close(l_ctx);l_open:=false;
    else return null;
    end case;
    if l_value is not null then
        l_object:=json_object_t.parse(l_value);
        l_error:=validate_payload(to_clob('{"v":2,"sites":[],"context":')||l_value||'}');
        if l_error is not null then raise_application_error(-20071,l_error);end if;
    end if;
    return l_value;
exception when others then
    if l_open then apex_exec.close(l_ctx);end if;
    raise;
end patient_data;

-- Optional host authorization runs before rendering, refreshing or validating any source.
function item_patient_data(p_item apex_plugin.t_item) return clob is
    l_type varchar2(20):=nvl(attr(p_item,26),'ITEM');
    l_condition varchar2(32767):=attr(p_item,31);
    l_result clob;
    l_doc json_object_t;
    l_patient json_object_t;
begin
    if l_type not in ('NONE','ITEM','JSON','SQL','PLSQL') then raise_application_error(-20071,'Choose a supported Patient Data Source.');end if;
    if l_condition is not null and not nvl(apex_plugin_util.get_plsql_func_result_boolean(p_plsql_function=>l_condition),false) then
        raise_application_error(-20071,'Patient access is not authorized.');
    end if;
    l_result:=patient_data(l_type,case l_type when 'ITEM' then attr(p_item,23) when 'JSON' then attr(p_item,27) when 'SQL' then attr(p_item,28) when 'PLSQL' then attr(p_item,29) end);
    if l_type='ITEM' and (attr(p_item,21) is not null or attr(p_item,22) is not null) then
        l_doc:=case when l_result is null then json_object_t() else json_object_t.parse(l_result) end;
        l_patient:=l_doc.get_object('patient');if l_patient is null then l_patient:=json_object_t();end if;
        if not l_patient.has('name') and attr(p_item,21) is not null and v(attr(p_item,21)) is not null then l_patient.put('name',substr(v(attr(p_item,21)),1,200));end if;
        if not l_patient.has('mrn') and attr(p_item,22) is not null and v(attr(p_item,22)) is not null then l_patient.put('mrn',substr(v(attr(p_item,22)),1,200));end if;
        l_doc.put('patient',l_patient);l_result:=l_doc.to_clob;
    end if;
    return l_result;
end;

function to_int ( p_val in varchar2, p_default in number ) return number
is
begin
    return nvl(to_number(regexp_substr(p_val, '\d{1,6}')), p_default);
exception
    when others then
        return p_default;
end to_int;

function has ( p_list in varchar2, p_value in varchar2 ) return boolean
is
begin
    return instr(':' || p_list || ':', ':' || p_value || ':') > 0;
end has;

-- Shared dictionaries and exam definitions are maintained by explicitly authorized users.
function clinic_maintainer(p_item in apex_plugin.t_item) return boolean is
    l_condition varchar2(32767):=attr(p_item,19);
begin
    if apex_application.g_user is null or upper(apex_application.g_user) in ('NOBODY','APEX_PUBLIC_USER','HTMLDB_PUBLIC_USER') then return false; end if;
    if trim(l_condition) is null then return false; end if;
    return nvl(apex_plugin_util.get_plsql_func_result_boolean(p_plsql_function=>l_condition),false);
exception when others then
    apex_debug.error('Clinical Anatomy 3D maintainer authorization failed for %s: %s',p_item.name,sqlerrm);
    return false;
end;

function clinic_permissions(p_item in apex_plugin.t_item,p_maintainer boolean) return varchar2 is
begin
    if p_maintainer then return nvl(attr(p_item,15),'NONE'); end if;
    return 'NONE';
end;

function clinic_write_token(p_item in apex_plugin.t_item) return varchar2 is
begin
    return apex_util.get_hash(apex_t_varchar2('SKELETON3D_CLINIC',to_char(apex_application.g_flow_id),to_char(apex_application.g_flow_step_id),p_item.name));
end;

-- M or F from the attribute, or from the page item with the patient's sex (M, F, Male, Female ...)
function sex ( p_item in apex_plugin.t_item,p_context clob default null ) return varchar2
is
    l_kind varchar2(30) := nvl(attr(p_item, 1), 'MALE');
    l_val  varchar2(255);
    l_doc json_object_t;
begin
    if p_context is not null then
        l_doc:=json_object_t.parse(p_context);l_doc:=l_doc.get_object('patient');
        if l_doc is not null and l_doc.has('sex') then
            l_val:=upper(trim(l_doc.get_string('sex')));
            return case when l_val in ('F','FEMALE') then 'F' when l_val in ('M','MALE') then 'M' else 'U' end;
        end if;
    end if;
    if l_kind = 'ITEM' and attr(p_item, 2) is not null then
        l_val := upper(trim(v(attr(p_item, 2))));
        return case when l_val in ('F','FEMALE') then 'F' when l_val in ('M','MALE') then 'M' else 'U' end;
    end if;
    return case when l_kind = 'FEMALE' then 'F' when l_kind='MALE' then 'M' else 'U' end;
end sex;

function specialty(p_item in apex_plugin.t_item) return varchar2 is
    l_value varchar2(100);
begin
    l_value:=upper(trim(case when attr(p_item,20) is not null then v(attr(p_item,20)) else attr(p_item,11) end));
    if l_value in ('ALL','ENT','OPHTHALMOLOGY','CARDIOLOGY','UROLOGY','INTERNAL_MEDICINE','GASTROENTEROLOGY','NEUROLOGY','PULMONOLOGY','ORTHOPEDICS') then return l_value; end if;
    return 'ALL';
end;

----------------------------------------------------------------------------
-- render
----------------------------------------------------------------------------
procedure render (
    p_item   in            apex_plugin.t_item,
    p_plugin in            apex_plugin.t_plugin,
    p_param  in            apex_plugin.t_item_render_param,
    p_result in out nocopy apex_plugin.t_item_render_result )
is
    l_name varchar2(255) := p_item.name;
    l_maintainer boolean := clinic_maintainer(p_item);
    l_permissions varchar2(100) := clinic_permissions(p_item,l_maintainer);
    l_ro   boolean := nvl(p_param.is_readonly,false) or nvl(p_param.is_printer_friendly,false);
    l_opt  varchar2(4000) := attr(p_item, 3);
    l_src  varchar2(30) := case when attr(p_item,7)='NONE' then 'NONE' else 'BUILTIN' end;
    l_json clob;
    l_submit varchar2(32767);
    l_patient clob;
    l_patient_error varchar2(4000);
    l_patient_type varchar2(20):=nvl(attr(p_item,26),'ITEM');
    l_value clob := coalesce(p_param.session_state_value.clob_value,to_clob(p_param.session_state_value.varchar2_value),to_clob(p_param.value));
begin
    begin
        l_patient:=item_patient_data(p_item);
    exception when others then
        apex_debug.error('Anatomy patient source %s: %s',p_item.name,sqlerrm);
        l_patient_error:='Patient data could not be loaded. Retry or contact the application administrator.';
    end;
    apex_json.initialize_clob_output;
    apex_json.open_object;
    apex_json.write('sex', sex(p_item,l_patient));
    apex_json.write('theme',lower(nvl(attr(p_item,32),'apex')));
    apex_json.write('colorMode',nvl(attr(p_item,33),'CLINICAL'));
    apex_json.write('neonColor',nvl(attr(p_item,34),'#36f5ff'));
    apex_json.write('sexSwitch', false);
    apex_json.write('sexLocked', not l_ro);
    apex_json.write('specialty', specialty(p_item));
    apex_json.write('specialtyItem',attr(p_item,20));
    apex_json.write('patientNameItem',attr(p_item,21));
    apex_json.write('patientMrnItem',attr(p_item,22));
    apex_json.write('contextSourceItem',attr(p_item,23));
    apex_json.write('contextSourceType',l_patient_type);
    apex_json.write('contextData',l_patient);
    apex_json.write('contextSourceError',l_patient_error);
    l_submit:=trim(both ',' from replace(attr(p_item,30)||case when l_patient_type='ITEM' then ','||attr(p_item,23)||','||attr(p_item,21)||','||attr(p_item,22) end,' '));
    if l_submit is not null then apex_json.write('contextItemsToSubmit','#'||regexp_replace(l_submit,'[,:]+',',#'));end if;
    apex_json.write('contextOptions',nvl(attr(p_item,24),'{}'));
    apex_json.write('selectionGesture',nvl(attr(p_item,25),'SINGLE'));
    apex_json.write('specialtySwitch', has(l_opt, 'SPECIALTY_SWITCH') and specialty(p_item)='ALL');
    apex_json.write('layer', nvl(attr(p_item, 12), 'AUTO'));
    apex_json.write('clinicPermissions', case when l_ro then 'NONE' else l_permissions end);
    apex_json.write('examMode', nvl(attr(p_item, 16), 'OFF'));
    apex_json.write('modelTools', attr(p_item, 17));
    if not l_ro and l_maintainer then apex_json.write('clinicToken',clinic_write_token(p_item)); end if;
    apex_json.write('selectBy', nvl(attr(p_item, 4), 'AREA'));
    apex_json.write('selectBySwitch', has(l_opt, 'MODE_SWITCH'));
    apex_json.write('complaints', has(l_opt, 'COMPLAINTS'));
    apex_json.write('search', has(l_opt, 'SEARCH'));
    apex_json.write('pain', has(l_opt, 'PAIN'));
    apex_json.write('note', has(l_opt, 'NOTE'));
    apex_json.write('height', greatest(320, least(to_int(attr(p_item, 5), 560), 1200)));
    apex_json.write('maxSites', to_int(attr(p_item, 6), 0));
    apex_json.write('dxSource', l_src);
    apex_json.write('readOnly', l_ro);
    apex_json.write('ajaxId', apex_plugin.get_ajax_identifier);
    apex_json.close_object;
    l_json := apex_json.get_clob_output;
    apex_json.free_output;

    sys.htp.prn('<textarea hidden id="' || l_name || '"' || case when not l_ro then ' name="' || l_name || '"' end || '>');
    apex_util.prn(apex_escape.html_clob(l_value),false);
    sys.htp.p('</textarea><div id="' || l_name || '_SK3" class="sk3" role="group" aria-label="' || apex_escape.html_attribute(p_item.plain_label) || '"></div>');
    sys.htp.prn('<script type="application/json" id="' || l_name || '_SK3_CFG">');
    apex_util.prn(replace(l_json, '<', '\u003c'), false);
    sys.htp.p('</script>');

    apex_javascript.add_onload_code(
        'skeleton3d.init("' || l_name || '", JSON.parse(document.getElementById("' || l_name || '_SK3_CFG").textContent)'
        || case when p_item.init_javascript_code is not null then ', ' || p_item.init_javascript_code end || ');');

    p_result.is_navigable     := not l_ro;
    p_result.navigable_dom_id := l_name || '_SK3';
end render;

----------------------------------------------------------------------------
-- ajax: diagnoses of the application's own list, for the areas in x02 and / or the words in x03.
-- Diagnosis Query columns by position: code, title, areas (optional, e.g. KNEE:HIP), coding system (optional)
----------------------------------------------------------------------------
procedure ajax (
    p_item in apex_plugin.t_item,p_plugin in apex_plugin.t_plugin,
    p_param in apex_plugin.t_item_ajax_param,p_result in out nocopy apex_plugin.t_item_ajax_result)
is
    l_maintainer boolean:=clinic_maintainer(p_item);
    l_permissions varchar2(100):=clinic_permissions(p_item,l_maintainer);
    procedure json_header is
    begin
        sys.owa_util.mime_header('application/json; charset=utf-8',false);
        sys.htp.p('Cache-Control: no-store');sys.owa_util.http_header_close;
    end;
begin
    if apex_application.g_x01='PATIENT_CONTEXT' then
        json_header;
        apex_json.initialize_clob_output;apex_json.open_object;
        begin apex_json.write('contextData',item_patient_data(p_item));
        exception when others then
            apex_debug.error('Anatomy patient refresh %s: %s',p_item.name,sqlerrm);
            apex_json.write('error','Patient data could not be loaded. Retry or contact the application administrator.');
        end;
        apex_json.close_object;apex_util.prn(apex_json.get_clob_output,false);apex_json.free_output;return;
    end if;
    if apex_application.g_x01 like 'CLINIC\_%' escape '\' then
        apex_json.initialize_output(p_http_header=>false);
        if apex_application.g_x01 in ('CLINIC_CREATE','CLINIC_CONFIGURE') and
           (not l_maintainer or apex_application.g_x09 is null or apex_application.g_x09<>clinic_write_token(p_item)) then
            json_header;apex_json.open_object;apex_json.write('error','The clinic operation is unavailable for this item.');apex_json.close_object;return;
        end if;
        begin
            execute immediate 'begin ca3d_clinic_api.ajax(:action,:permissions,:exam_mode); end;'
                using apex_application.g_x01,l_permissions,nvl(attr(p_item,16),'OFF');
        exception when others then
            apex_debug.error('Clinical Anatomy 3D clinic service %s: %s',p_item.name,sqlerrm);
            json_header;apex_json.initialize_output(p_http_header=>false);apex_json.open_object;
            apex_json.write('error',case when apex_application.g_x01='CLINIC_LOAD' then 'The examination service is unavailable. Retry or ask the administrator to install or compile CA3D_CLINIC_API.' else 'The shared catalogue service is unavailable. Retry or contact the application administrator.' end);
            apex_json.close_object;
        end;
        return;
    end if;
    json_header;apex_json.initialize_output(p_http_header=>false);apex_json.open_object;
    apex_json.write('error','Unsupported anatomy request. Diagnoses and complaints use the shared catalogue.');apex_json.close_object;
end ajax;

----------------------------------------------------------------------------
-- validation: the value must be the JSON this item writes, within the Maximum Sites
----------------------------------------------------------------------------
procedure validation (
    p_item   in            apex_plugin.t_item,
    p_plugin in            apex_plugin.t_plugin,
    p_param  in            apex_plugin.t_item_validation_param,
    p_result in out nocopy apex_plugin.t_item_validation_result )
is
    l_max   pls_integer := to_int(attr(p_item, 6), 0);
    l_doc   sys.json_object_t;
    l_sites sys.json_array_t;
    l_value clob := coalesce(p_param.session_state_value.clob_value,to_clob(p_param.session_state_value.varchar2_value),to_clob(p_param.value));
    l_clinic_error varchar2(4000);
    l_has_custom pls_integer;
    l_patient clob;
    l_definition clob;
    l_patient_type varchar2(20):=nvl(attr(p_item,26),'ITEM');
    l_patient_options json_object_t;
    l_patient_doc json_object_t;
    l_patient_sex varchar2(100);
    l_expected_sex varchar2(1):=sex(p_item);
    l_maintainer boolean := clinic_maintainer(p_item);
    l_permissions varchar2(100) := clinic_permissions(p_item,l_maintainer);
begin
    l_clinic_error:=validate_payload(l_value,specialty(p_item));
    if l_clinic_error is not null then p_result.message:=l_clinic_error; return; end if;
    select case when json_exists(l_value,'$.sites[*].diagnoses[*]?(@.source == "CUSTOM")')
                     or json_exists(l_value,'$.sites[*].complaints[*]?(@.source == "CUSTOM")') then 1 else 0 end
      into l_has_custom from dual;
    if l_has_custom=1 or json_exists(l_value,'$.exam') or nvl(attr(p_item,16),'OFF')<>'OFF' then
        begin
            execute immediate 'begin :message:=ca3d_clinic_api.validate_value(:value,:exam_mode); end;'
                using out l_clinic_error,in l_value,in nvl(attr(p_item,16),'OFF');
        exception when others then
            apex_debug.error('Clinical Anatomy 3D clinic validation %s: %s',p_item.name,sqlerrm);
            p_result.message:='The examination and clinic validation service is unavailable. Contact the application administrator to install or compile CA3D_CLINIC_API.';
            return;
        end;
        if l_clinic_error is not null then p_result.message:=l_clinic_error; return; end if;
    end if;
    begin
        l_patient_options:=json_object_t.parse(nvl(attr(p_item,24),'{}'));
        if l_patient_options is null then raise_application_error(-20071,'Options must be an object.');end if;
    exception when others then
        p_result.message:='Display & Prefill Options must be a valid JSON object. Leave {} for defaults.';return;
    end;
    begin
        l_patient:=item_patient_data(p_item);
    exception when others then
        apex_debug.error('Clinical Anatomy 3D patient source validation %s: %s',p_item.name,sqlerrm);
        -- Findings with no patient snapshot or prefill claims can survive a source outage.
        if attr(p_item,31) is not null or l_patient_options is null or nvl(l_patient_options.get_boolean('patientDataRequired'),false)
           or json_exists(l_value,'$.context') or json_exists(l_value,'$.exam.answers.*.prefill') then
            p_result.message:='The patient source could not be verified. Retry before saving patient data or prefilled values.';return;
        end if;
    end;
    l_expected_sex:=sex(p_item,l_patient);
    l_clinic_error:=validate_payload(l_value,specialty(p_item),l_expected_sex);
    if l_clinic_error is not null then p_result.message:=l_clinic_error;return;end if;
    if nvl(attr(p_item,16),'OFF')<>'OFF' or json_exists(l_value,'$.exam') then
        execute immediate 'begin :definition:=ca3d_clinic_api.exam_definition; end;' using out l_definition;
    end if;
    l_clinic_error:=validate_patient(l_value,l_patient,attr(p_item,24),l_definition);
    if l_clinic_error is not null then p_result.message:=l_clinic_error;return;end if;
    if l_value is null then
        return;
    end if;
    begin
        l_doc   := sys.json_object_t.parse(l_value);
        l_sites := l_doc.get_array('sites');
    exception
        when others then
            l_sites := null;
    end;
    if l_sites is null then
        p_result.message := p_item.plain_label || ': the marked areas could not be read. Please mark them again.';
    elsif l_max > 0 and l_sites.get_size > l_max then
        p_result.message := p_item.plain_label || ': no more than ' || l_max || ' areas can be marked.';
    end if;
end validation;
