-- Shared diagnosis/complaint catalog and examination definitions.
-- Install in the application's parsing schema. Repeatable without deleting clinic data.
set define off

-- Upgrade the former clinic prefix in place, keeping IDs, links and form JSON.
-- Check all names before DDL; never combine two independently populated stores.
declare
    l_names sys.odcivarchar2list := sys.odcivarchar2list('SK3_CLINIC_TERMS','SK3_TERM_AREAS','SK3_EXAM_DEFINITIONS');
    l_old number;
    l_new number;
begin
    for i in 1..l_names.count loop
        select count(*) into l_old from user_tables where table_name=l_names(i);
        select count(*) into l_new from user_objects where object_name=replace(l_names(i),'SK3_','CA3D_');
        if l_old>0 and l_new>0 then
            raise_application_error(-20086,'Both clinic prefixes exist for '||l_names(i)||'. Reconcile the stores before installing.');
        end if;
    end loop;
    for i in 1..l_names.count loop
        select count(*) into l_old from user_tables where table_name=l_names(i);
        if l_old>0 then execute immediate 'alter table '||l_names(i)||' rename to '||replace(l_names(i),'SK3_','CA3D_'); end if;
    end loop;
    for r in (select table_name,constraint_name from user_constraints
               where table_name in ('CA3D_CLINIC_TERMS','CA3D_TERM_AREAS','CA3D_EXAM_DEFINITIONS')
                 and constraint_name like 'SK3\_%' escape '\') loop
        execute immediate 'alter table '||dbms_assert.simple_sql_name(r.table_name)||' rename constraint '||
            dbms_assert.simple_sql_name(r.constraint_name)||' to CA3D_'||substr(r.constraint_name,5);
    end loop;
    for r in (select index_name from user_indexes
               where table_name in ('CA3D_CLINIC_TERMS','CA3D_TERM_AREAS','CA3D_EXAM_DEFINITIONS')
                 and index_name like 'SK3\_%' escape '\') loop
        execute immediate 'alter index '||dbms_assert.simple_sql_name(r.index_name)||' rename to CA3D_'||substr(r.index_name,5);
    end loop;
end;
/

declare
    procedure ddl(p_name varchar2, p_sql varchar2) is
        l_count number;
    begin
        select count(*) into l_count from user_tables where table_name = upper(p_name);
        if l_count = 0 then execute immediate p_sql; end if;
    end;
begin
    ddl('CA3D_CLINIC_TERMS', q'[
        create table ca3d_clinic_terms (
            term_id number generated always as identity primary key,
            workspace_id number not null,
            application_id number not null,
            term_kind varchar2(12) not null check (term_kind in ('DIAGNOSIS','COMPLAINT')),
            label varchar2(400 char) not null,
            label_key varchar2(400 char) generated always as (lower(trim(label))) virtual,
            created_by varchar2(255) not null,
            created_on timestamp default systimestamp not null,
            constraint ca3d_terms_uq unique (workspace_id,application_id,term_kind,label_key)
        )]');
    ddl('CA3D_TERM_AREAS', q'[
        create table ca3d_term_areas (
            term_id number not null references ca3d_clinic_terms(term_id),
            area_code varchar2(40) not null,
            part_code varchar2(100) default '*' not null,
            constraint ca3d_term_areas_pk primary key (term_id,area_code,part_code)
        )]');
    ddl('CA3D_EXAM_DEFINITIONS', q'[
        create table ca3d_exam_definitions (
            definition_id number generated always as identity primary key,
            workspace_id number not null,
            application_id number not null,
            version_no number not null,
            definition clob not null check (definition is json),
            created_by varchar2(255) not null,
            created_on timestamp default systimestamp not null,
            constraint ca3d_exam_def_uq unique (workspace_id,application_id,version_no)
        )]');
end;
/

-- Additive migration: preserve existing IDs, terms, links and configured forms.
declare
    l_count number;
    procedure add_column(p_name varchar2,p_definition varchar2) is
    begin
        select count(*) into l_count from user_tab_columns where table_name='CA3D_CLINIC_TERMS' and column_name=p_name;
        if l_count=0 then execute immediate 'alter table ca3d_clinic_terms add ('||p_definition||')'; end if;
    end;
begin
    add_column('SPECIALTY_CODE','specialty_code varchar2(40) default ''ALL'' not null');
    add_column('TERM_CODE','term_code varchar2(60)');
    add_column('CODING_SYSTEM','coding_system varchar2(40) default ''CUSTOM'' not null');
    add_column('ACTIVE_YN','active_yn varchar2(1) default ''Y'' not null check (active_yn in (''Y'',''N''))');
    add_column('SPECIALTY_FILTER','specialty_filter varchar2(400 char)');
    add_column('KEYWORDS','keywords varchar2(2000 char)');
    add_column('EXTERNAL_ID','external_id varchar2(128 char)');
    add_column('TERM_ORIGIN','term_origin varchar2(12) default ''LOCAL'' not null');
    execute immediate q'[update ca3d_clinic_terms set term_code=case term_kind when 'DIAGNOSIS' then 'DX-' else 'CP-' end||to_char(term_id,'FM0000000000000000') where term_code is null]';
end;
/

@@SHARED_CATALOG_MIGRATION@@

-- Stable relational contract for reports and subsequent processing. Filter by the
-- current workspace/application in every application query.
create or replace view ca3d_clinic_catalog_v as
select t.term_id id,t.term_kind kind,t.specialty_code specialty,t.label name,
       t.term_code code,t.coding_system,t.active_yn,t.term_origin,t.keywords,t.external_id,t.specialty_filter,a.area_code,a.part_code,
       t.workspace_id,t.application_id,t.created_by,t.created_on
from ca3d_clinic_terms t join ca3d_term_areas a on a.term_id=t.term_id;

create or replace package ca3d_clinic_api as
    procedure initialize_catalog(p_include_starter boolean default true);
    procedure ajax(p_action varchar2,p_permissions varchar2,p_exam_mode varchar2);
    function validate_value(p_value clob,p_exam_mode varchar2 default 'OFF') return varchar2;
    function exam_definition return clob;
    procedure prune_exam_history(p_keep_versions pls_integer default 20);
end ca3d_clinic_api;
/

create or replace package body ca3d_clinic_api as
    c_areas constant varchar2(2000) := ':@@AREA_CODES@@:';

    function default_exam return clob is
    begin
        return q'~@@GENERAL_EXAM_JSON@@~';
    end;

    -- Version zero is the one-time initialization marker and concurrent-insert guard.
    procedure initialize_catalog(p_include_starter boolean default true) is
        l_count number;l_id number;l_definition clob;
        procedure seed_term(p_kind varchar2,p_code varchar2,p_label varchar2,p_system varchar2,p_areas varchar2,p_keywords varchar2,p_specialty varchar2 default 'ALL',p_filter varchar2 default null) is
        begin
            begin
                insert into ca3d_clinic_terms(workspace_id,application_id,term_kind,label,created_by,specialty_code,term_code,coding_system,keywords,term_origin,specialty_filter)
                values(apex_custom_auth.get_security_group_id,apex_application.g_flow_id,p_kind,p_label,'#STARTER#',p_specialty,p_code,p_system,p_keywords,'STARTER',p_filter) returning term_id into l_id;
            exception when dup_val_on_index then return;end;
            for a in (select column_value area from table(apex_string.split(p_areas,':'))) loop
                insert into ca3d_term_areas(term_id,area_code,part_code) values(l_id,a.area,'*');
            end loop;
        end;
    begin
        savepoint ca3d_catalog_init;
        if apex_custom_auth.get_security_group_id is null or apex_application.g_flow_id is null then raise_application_error(-20004,'Initialize the catalogue in an APEX application session.');end if;
        select count(*) into l_count from ca3d_exam_definitions where workspace_id=apex_custom_auth.get_security_group_id and application_id=apex_application.g_flow_id and version_no=0;
        if l_count>0 then return;end if;
        l_definition:=default_exam;
        begin
            insert into ca3d_exam_definitions(workspace_id,application_id,version_no,definition,created_by)
            values(apex_custom_auth.get_security_group_id,apex_application.g_flow_id,0,l_definition,'#STARTER#');
        exception when dup_val_on_index then return;end;
        if p_include_starter then
@@CATALOG_SEED_SQL@@
        end if;
    exception when others then rollback to ca3d_catalog_init;raise;
    end;

    procedure load_exam(p_definition out clob,p_version out number) is
    begin
        select definition,version_no into p_definition,p_version from ca3d_exam_definitions
        where workspace_id=apex_custom_auth.get_security_group_id and application_id=apex_application.g_flow_id
        order by version_no desc fetch first 1 row only;
    exception when no_data_found then p_definition:=default_exam;p_version:=0;
    end;
    function exam_definition return clob is l_definition clob;l_version number;
    begin load_exam(l_definition,l_version);return l_definition;end;
    procedure prune_exam_history(p_keep_versions pls_integer default 20) is
    begin
        if p_keep_versions is null or p_keep_versions<2 then raise_application_error(-20002,'Keep at least two exam definition versions.');end if;
        delete from ca3d_exam_definitions where definition_id in (
            select definition_id from (
                select definition_id,row_number() over(order by version_no desc) rn from ca3d_exam_definitions
                where workspace_id=apex_custom_auth.get_security_group_id and application_id=apex_application.g_flow_id and version_no>0
            ) where rn>=p_keep_versions);
    end;

    procedure write_term(p_id number) is
    begin
        for r in (select term_id,label,term_kind,term_code,specialty_code,coding_system from ca3d_clinic_terms where term_id=p_id) loop
            apex_json.open_object;
            apex_json.write('id',r.term_id);
            apex_json.write('label',r.label);
            apex_json.write('source','CUSTOM');
            apex_json.write('system',r.coding_system);
            apex_json.write('code',r.term_code);
            apex_json.write('specialty',r.specialty_code);
            apex_json.write('kind',r.term_kind);
            apex_json.open_array('areas');
            for a in (select distinct area_code from ca3d_term_areas where term_id=p_id order by area_code) loop
                apex_json.write(a.area_code);
            end loop;
            apex_json.close_array;
            apex_json.open_array('links');
            for a in (select area_code,part_code from ca3d_term_areas where term_id=p_id order by area_code,part_code) loop
                apex_json.open_object;
                apex_json.write('area',a.area_code);
                if a.part_code<>'*' then apex_json.write('part',a.part_code); end if;
                apex_json.close_object;
            end loop;
            apex_json.close_array;
            apex_json.close_object;
        end loop;
    end;

    -- One SQL cursor per search; aggregate anatomy links once for all matching terms.
    procedure write_terms(p_kind varchar2,p_specialty varchar2) is
        l_limit number:=case when p_kind='COMPLAINT' and apex_application.g_x03 is null then 500 else 60 end;
    begin
        for r in (
            with chosen as (
                select t.* from ca3d_clinic_terms t
                 where t.workspace_id=apex_custom_auth.get_security_group_id and t.application_id=apex_application.g_flow_id
                   and t.term_kind=p_kind and t.active_yn='Y'
                   and (p_specialty='ALL' or (t.specialty_filter is null and t.specialty_code in ('ALL',p_specialty)) or instr(':'||t.specialty_filter||':',':'||p_specialty||':')>0)
                   and (apex_application.g_x03 is null or instr(upper(t.label||' '||t.term_code||' '||t.keywords),upper(trim(apex_application.g_x03)))>0)
                   and (apex_application.g_x04 is null or exists (
                       select 1 from ca3d_term_areas a where a.term_id=t.term_id
                         and a.area_code in (select column_value from table(apex_string.split(apex_application.g_x04,':')))
                         and (apex_application.g_x06='GLOBAL' or a.part_code='*' or a.part_code=apex_application.g_x05)))
                 order by t.label,t.term_id fetch first l_limit rows only
            ), links as (
                select a.term_id,json_arrayagg(json_object('area' value a.area_code,'part' value nullif(a.part_code,'*') absent on null)
                    order by a.area_code,a.part_code returning clob) data
                  from ca3d_term_areas a join chosen c on c.term_id=a.term_id group by a.term_id
            ), areas as (
                select term_id,json_arrayagg(area_code order by area_code returning clob) data
                  from (select distinct a.term_id,a.area_code from ca3d_term_areas a join chosen c on c.term_id=a.term_id) group by term_id
            )
            select c.*,a.data areas_json,l.data links_json from chosen c join areas a on a.term_id=c.term_id join links l on l.term_id=c.term_id
             order by c.label,c.term_id
        ) loop
            apex_json.open_object;
            apex_json.write('id',r.term_id);apex_json.write('label',r.label);apex_json.write('source','CUSTOM');
            apex_json.write('system',r.coding_system);apex_json.write('code',r.term_code);apex_json.write('specialty',r.specialty_code);apex_json.write('kind',r.term_kind);
            apex_json.write('keywords',r.keywords);apex_json.write_raw('areas',r.areas_json);apex_json.write_raw('links',r.links_json);
            apex_json.close_object;
        end loop;
    end;

    procedure check_definition(p_doc sys.json_object_t) is
        l_fields sys.json_array_t:=p_doc.get_array('fields');
        l_field sys.json_object_t;
        l_ids varchar2(10000):=':';
        l_id varchar2(100);
        l_options sys.json_array_t;
        l_option sys.json_object_t;
        l_values varchar2(10000);
        l_value sys.json_element_t;
        l_notes sys.json_array_t;
        l_keys sys.odcivarchar2list;
        procedure check_text(p_object json_object_t,p_key varchar2,p_limit number) is
        begin
            l_value:=p_object.get(p_key);
            if l_value is not null and not l_value.is_null then
                if not l_value.is_string or length(p_object.get_string(p_key))>p_limit then raise_application_error(-20003,p_key||' must be text of up to '||p_limit||' characters.');end if;
            end if;
        end;
        procedure check_boolean(p_object json_object_t,p_key varchar2) is
        begin
            l_value:=p_object.get(p_key);
            if l_value is not null and not l_value.is_boolean then raise_application_error(-20003,p_key||' must be boolean.');end if;
        end;
    begin
        if dbms_lob.getlength(p_doc.to_clob)>32767 then raise_application_error(-20002,'The exam definition exceeds 32767 characters.');end if;
        check_text(p_doc,'title',160);check_text(p_doc,'profile',100);check_boolean(p_doc,'allowDeferred');
        l_value:=p_doc.get('version');
        if l_value is not null and (not l_value.is_number or p_doc.get_number('version')<0 or trunc(p_doc.get_number('version'))<>p_doc.get_number('version')) then raise_application_error(-20003,'version must be a nonnegative integer.');end if;
        if l_fields is null or l_fields.get_size<1 or l_fields.get_size>50 or p_doc.get_string('title') is null then
            raise_application_error(-20002,'Provide an exam title and between 1 and 50 fields.');
        end if;
        for i in 0..l_fields.get_size-1 loop
            l_field:=treat(l_fields.get(i) as sys.json_object_t);
            if l_field is null then raise_application_error(-20003,'Each exam field must be an object.');end if;
            check_text(l_field,'id',50);check_text(l_field,'label',120);check_text(l_field,'type',20);
            check_text(l_field,'unit',40);check_text(l_field,'section',120);check_text(l_field,'hint',500);
            check_boolean(l_field,'required');
            l_keys:=sys.odcivarchar2list('min','max','step');
            for n in 1..l_keys.count loop
                l_value:=l_field.get(l_keys(n));
                if l_value is not null and (not l_value.is_number or (l_keys(n)='step' and l_field.get_number('step')<=0)) then raise_application_error(-20003,l_keys(n)||' must be numeric (step must be positive).');end if;
            end loop;
            l_id:=l_field.get_string('id');
            if l_id is null or not regexp_like(l_id,'^[a-zA-Z][a-zA-Z0-9_]{0,49}$') or instr(l_ids,':'||l_id||':')>0
               or l_field.get_string('label') is null or length(l_field.get_string('label'))>120
               or nvl(l_field.get_string('type'),'-') not in ('assessment','number','text','textarea','select','checkbox') then
                raise_application_error(-20003,'Each exam field needs a unique ID, a label and a supported field type.');
            end if;
            l_ids:=l_ids||l_id||':';
            if l_field.get_string('type')='select' then
                l_options:=l_field.get_array('options');l_values:=':';
                if l_options is null or l_options.get_size<1 or l_options.get_size>30 then raise_application_error(-20003,'Selection fields need between 1 and 30 choices.'); end if;
                for j in 0..l_options.get_size-1 loop
                    l_option:=treat(l_options.get(j) as sys.json_object_t);
                    if l_option is null then raise_application_error(-20003,'Each selection choice must be an object.');end if;
                    check_text(l_option,'value',60);check_text(l_option,'label',160);
                    l_id:=l_option.get_string('value');
                    if not regexp_like(l_id,'^[A-Za-z0-9_.-]{1,60}$') or l_id is null or l_option.get_string('label') is null or length(l_option.get_string('label'))>160 or instr(l_values,':'||l_id||':')>0 then raise_application_error(-20003,'Selection choices need unique values and labels.'); end if;
                    l_values:=l_values||l_id||':';
                end loop;
            end if;
            if l_field.has('noteRequiredFor') then
                l_value:=l_field.get('noteRequiredFor');
                if not l_value.is_array then raise_application_error(-20003,'noteRequiredFor must be an array.');end if;
                l_notes:=l_field.get_array('noteRequiredFor');
                if l_notes.get_size>30 then raise_application_error(-20003,'noteRequiredFor supports up to 30 values.');end if;
                for n in 0..l_notes.get_size-1 loop
                    l_value:=l_notes.get(n);
                    if not l_value.is_string or length(l_notes.get_string(n))>60 then raise_application_error(-20003,'noteRequiredFor entries must be text of up to 60 characters.');end if;
                    if l_field.get_string('type')='assessment' and l_notes.get_string(n) not in ('NORMAL','ABNORMAL') then raise_application_error(-20003,'Unsupported assessment note condition.');end if;
                end loop;
            end if;
            if l_field.has('min') and l_field.has('max') and l_field.get_number('min')>l_field.get_number('max') then raise_application_error(-20003,'The minimum cannot exceed the maximum.'); end if;
        end loop;
    end;

    procedure emit_json(p_value clob) is
        l_ascii clob;
        l_offset pls_integer:=1;
    begin
        -- Escaped Unicode keeps JSON intact across HTP byte-buffer boundaries.
        select json_serialize(p_value returning clob ascii) into l_ascii from dual;
        sys.owa_util.mime_header('application/json; charset=utf-8',false);
        sys.htp.p('Cache-Control: no-store');
        sys.owa_util.http_header_close;
        while l_offset<=sys.dbms_lob.getlength(l_ascii) loop
            sys.htp.prn(sys.dbms_lob.substr(l_ascii,1000,l_offset));
            l_offset:=l_offset+1000;
        end loop;
    end;

    procedure ajax(p_action varchar2,p_permissions varchar2,p_exam_mode varchar2) is
        l_doc sys.json_object_t;
        l_kind varchar2(32767);
        l_label varchar2(4000);
        l_area varchar2(40);
        l_part varchar2(100);
        l_id number;
        l_version number;
        l_expected number;
        l_definition clob;
        l_output clob;
        l_error varchar2(4000);
        l_specialty varchar2(32767);
        l_code varchar2(4000);
        l_system varchar2(4000);
    begin
        apex_json.initialize_clob_output;
        l_kind:=upper(apex_application.g_x02);l_specialty:=nvl(upper(apex_application.g_x07),'ALL');
        if length(l_kind)>12 or length(l_specialty)>40 then raise_application_error(-20007,'A clinic request field exceeds its supported length.');end if;
        if p_action in ('CLINIC_CREATE','CLINIC_CONFIGURE') then
            if not apex_authentication.is_authenticated then raise_application_error(-20004,'Sign in to maintain clinic lists.'); end if;
            if apex_application.g_clob_01 is null or dbms_lob.getlength(apex_application.g_clob_01)>32767 then raise_application_error(-20002,'Provide a clinic JSON document of up to 32767 characters.');end if;
            l_doc:=sys.json_object_t.parse(apex_application.g_clob_01);
        end if;
        initialize_catalog;commit;
        if p_action='CLINIC_LOAD' then
            load_exam(l_definition,l_version);
            apex_json.open_object;
            apex_json.write_raw('template',l_definition);
            apex_json.write('version',l_version);
            apex_json.close_object;
        elsif p_action='CLINIC_TERMS' then
            if nvl(l_kind,'-') not in ('DIAGNOSIS','COMPLAINT') then raise_application_error(-20005,'Clinic lists are disabled.'); end if;
            apex_json.open_object;
            apex_json.open_array('rows');
            write_terms(l_kind,l_specialty);
            apex_json.close_array;
            apex_json.close_object;
        elsif p_action='CLINIC_CREATE' then
            if instr(':'||p_permissions||':',':TERMS:')=0 then raise_application_error(-20006,'Creating clinic terms is disabled for this item.'); end if;
            l_kind:=l_doc.get_string('kind');
            l_label:=trim(regexp_replace(l_doc.get_string('label'),'[[:space:]]+',' '));
            l_area:=l_doc.get_string('area');
            l_part:=nvl(l_doc.get_string('part'),'*');
            l_specialty:=nvl(l_doc.get_string('specialty'),'ALL');
            l_code:=trim(l_doc.get_string('code'));l_system:=nvl(trim(l_doc.get_string('system')),'CUSTOM');
            if nvl(l_kind,'-') not in ('DIAGNOSIS','COMPLAINT') or l_label is null or length(l_label)>400
               or instr(c_areas,':'||l_area||':')=0 or l_area is null
               or not regexp_like(l_part,'^[A-Za-z0-9_*.-]{1,100}$')
               or l_specialty not in ('ALL','ENT','OPHTHALMOLOGY','CARDIOLOGY','UROLOGY','INTERNAL_MEDICINE','GASTROENTEROLOGY','NEUROLOGY','PULMONOLOGY','ORTHOPEDICS')
               or length(l_code)>60 or length(l_system)>40 then
                raise_application_error(-20007,'Provide a name and a valid selected anatomical site.');
            end if;
            begin
                insert into ca3d_clinic_terms(workspace_id,application_id,term_kind,label,created_by,specialty_code,term_code,coding_system)
                values(apex_custom_auth.get_security_group_id,apex_application.g_flow_id,l_kind,l_label,apex_application.g_user,l_specialty,l_code,l_system)
                returning term_id into l_id;
                if l_code is null then update ca3d_clinic_terms set term_code=case l_kind when 'DIAGNOSIS' then 'DX-' else 'CP-' end||to_char(l_id,'FM0000000000000000') where term_id=l_id; end if;
            exception when dup_val_on_index then
                begin
                    select term_id into l_id from ca3d_clinic_terms where workspace_id=apex_custom_auth.get_security_group_id
                      and application_id=apex_application.g_flow_id and term_kind=l_kind and specialty_code=l_specialty and label_key=lower(l_label)
                      and (l_code is null or term_code=l_code) and coding_system=l_system;
                    select count(*) into l_version from ca3d_clinic_terms where term_id=l_id and active_yn='Y';
                    if l_version=0 then raise_application_error(-20007,'This term was deactivated. Ask a catalog administrator to review it.'); end if;
                exception when no_data_found then raise_application_error(-20007,'This name or code is already in use. Select the existing catalog entry.'); end;
            end;
            begin
                insert into ca3d_term_areas(term_id,area_code,part_code) values(l_id,l_area,l_part);
            exception when dup_val_on_index then null;
            end;
            apex_json.open_object;
            apex_json.open_array('rows');write_term(l_id);apex_json.close_array;
            apex_json.close_object;
            commit;
        elsif p_action='CLINIC_CONFIGURE' then
            if instr(':'||p_permissions||':',':EXAM_SETUP:')=0 then raise_application_error(-20008,'Exam configuration is disabled for this item.'); end if;
            check_definition(l_doc);
            load_exam(l_definition,l_version);
            l_expected:=nvl(l_doc.get_number('version'),0);
            if l_expected<>l_version then raise_application_error(-20009,'The exam configuration changed. Reload before saving.'); end if;
            -- Repeated saves of the same definition do not consume history versions.
            l_doc.put('version',l_version);l_output:=l_doc.to_clob;
            select case when json_equal(l_definition,l_output) then 1 else 0 end into l_id from dual;
            if l_id=1 then
                apex_json.open_object;apex_json.write_raw('template',l_definition);apex_json.write('version',l_version);apex_json.close_object;
                emit_json(apex_json.get_clob_output);apex_json.free_output;apex_json.initialize_output(p_http_header=>false);return;
            end if;
            l_doc.put('version',l_version+1);
            l_definition:=l_doc.to_clob;
            begin
                insert into ca3d_exam_definitions(workspace_id,application_id,version_no,definition,created_by)
                values(apex_custom_auth.get_security_group_id,apex_application.g_flow_id,l_version+1,l_definition,apex_application.g_user);
            exception when dup_val_on_index then raise_application_error(-20009,'The exam configuration changed. Reload before saving.');
            end;
            apex_json.open_object;
            apex_json.write_raw('template',l_doc.to_clob);
            apex_json.write('version',l_version+1);
            apex_json.close_object;
            commit;
        else raise_application_error(-20010,'Unsupported clinic operation.');
        end if;
        l_output:=apex_json.get_clob_output;
        emit_json(l_output);
        apex_json.free_output;
        apex_json.initialize_output(p_http_header=>false);
    exception when others then
        rollback;
        l_error:=case when sqlcode between -20999 and -20000 then regexp_replace(sqlerrm,'^ORA-[0-9]+: ','') when sqlcode=-6502 then 'A clinic input has an invalid type or exceeds its supported length.' else 'The clinic operation failed. Check the APEX debug log.' end;
        apex_debug.error('Clinical Anatomy 3D clinic operation: %s %s',sqlerrm,sys.dbms_utility.format_error_backtrace);
        apex_json.free_output;
        apex_json.initialize_clob_output;
        apex_json.open_object;apex_json.write('error',l_error);apex_json.close_object;
        emit_json(apex_json.get_clob_output);
        apex_json.free_output;
        apex_json.initialize_output(p_http_header=>false);
    end;

    function validate_value(p_value clob,p_exam_mode varchar2 default 'OFF') return varchar2 is
        l_doc sys.json_object_t;
        l_sites sys.json_array_t;
        l_site sys.json_object_t;
        l_terms sys.json_array_t;
        l_term sys.json_object_t;
        l_exam sys.json_object_t;
        l_answers sys.json_object_t;
        l_answer sys.json_object_t;
        l_definition clob;
        l_version number;
        l_template sys.json_object_t;
        l_fields sys.json_array_t;
        l_field sys.json_object_t;
        l_count number;
        l_value sys.json_element_t;
        l_kind varchar2(12);
        l_term_id number;
        l_term_label varchar2(4000);
        l_term_code varchar2(4000);
        l_term_system varchar2(40);
        l_site_area varchar2(40);
        l_site_part varchar2(100);
        l_site_bone varchar2(100);
        l_options sys.json_array_t;
        l_option sys.json_object_t;
        l_note_values sys.json_array_t;
        l_allowed boolean;
    begin
        if p_value is null then
            if p_exam_mode='REQUIRED' then return 'Complete the initial examination before saving.'; end if;
            return null;
        end if;
        l_doc:=sys.json_object_t.parse(p_value);
        l_sites:=l_doc.get_array('sites');
        if l_sites is null then return 'The anatomical sites could not be read.'; end if;
        for i in 0..l_sites.get_size-1 loop
            l_site:=treat(l_sites.get(i) as sys.json_object_t);
            l_site_area:=l_site.get_string('area');l_site_part:=l_site.get_string('part');l_site_bone:=l_site.get_string('bone');
            for k in 1..2 loop
                l_kind:=case k when 1 then 'DIAGNOSIS' else 'COMPLAINT' end;
                l_terms:=l_site.get_array(case k when 1 then 'diagnoses' else 'complaints' end);
                if l_terms is not null then
                    for j in 0..l_terms.get_size-1 loop
                        l_term:=treat(l_terms.get(j) as sys.json_object_t);
                        if l_term.get_string('source')='CUSTOM' then
                            l_term_id:=l_term.get_number('id');l_term_label:=l_term.get_string('label');l_term_code:=l_term.get_string('code');l_term_system:=nvl(l_term.get_string('system'),'CUSTOM');
                            select count(*) into l_count from ca3d_clinic_terms t where t.term_id=l_term_id
                              and t.workspace_id=apex_custom_auth.get_security_group_id and t.application_id=apex_application.g_flow_id
                              and t.term_kind=l_kind
                              and t.coding_system=l_term_system and t.label=l_term_label and (l_term_code is null or t.term_code=l_term_code) and exists (
                                  select 1 from ca3d_term_areas a where a.term_id=t.term_id and a.area_code=l_site_area
                                    and (a.part_code='*' or a.part_code=l_site_part or a.part_code=l_site_bone));
                            if l_count=0 then return 'A custom diagnosis or complaint does not belong to this clinic and anatomical site. Select it again.'; end if;
                        elsif l_term.get_string('code') is null then return 'A coded diagnosis or complaint is missing its code.';
                        end if;
                        if l_term.has('certainty') and nvl(l_term.get_string('certainty'),'-') not in ('unconfirmed','provisional','differential','confirmed','refuted') then
                            return 'A diagnosis certainty value is invalid.';
                        end if;
                    end loop;
                end if;
            end loop;
        end loop;
        l_exam:=l_doc.get_object('exam');
        if l_exam is null then
            if p_exam_mode='REQUIRED' then return 'Complete the initial examination before saving.'; end if;
            return null;
        end if;
        load_exam(l_definition,l_version);
        if nvl(l_exam.get_number('version'),-1)<>l_version then return 'The examination form changed. Reload and review it before saving.'; end if;
        l_template:=sys.json_object_t.parse(l_definition);
        if l_template.get_string('profile') is not null and nvl(l_exam.get_string('profile'),'-')<>l_template.get_string('profile') then return 'The examination form changed. Review the updated form before saving.'; end if;
        l_fields:=l_template.get_array('fields');
        l_answers:=l_exam.get_object('answers');
        if l_answers is null then l_answers:=sys.json_object_t(); end if;
        declare l_names json_key_list:=l_answers.get_keys;l_known boolean;
        begin
            for n in 1..l_names.count loop
                l_known:=false;
                for i in 0..l_fields.get_size-1 loop
                    l_field:=treat(l_fields.get(i) as json_object_t);
                    if l_field.get_string('id')=l_names(n) then l_known:=true;exit;end if;
                end loop;
                if not l_known then return 'Removed examination field: '||l_names(n)||'. Review and remove this answer before saving.';end if;
            end loop;
        end;
        for i in 0..l_fields.get_size-1 loop
            l_field:=treat(l_fields.get(i) as sys.json_object_t);
            l_answer:=l_answers.get_object(l_field.get_string('id'));
            if l_answer is null then l_answer:=sys.json_object_t(); end if;
            if length(l_answer.get_string('note'))>@@EXAM_NOTE@@ then return l_field.get_string('label')||' note is too long.';end if;
            if nvl(l_answer.get_boolean('deferred'),false) then
                if not nvl(l_template.get_boolean('allowDeferred'),false) or trim(l_answer.get_string('note')) is null then
                    return l_field.get_string('label')||' requires an assessment or a reason for deferral.';
                end if;
            else
                l_value:=l_answer.get('value');
                if p_exam_mode='REQUIRED' and nvl(l_field.get_boolean('required'),false)
                   and (l_value is null or l_value.is_null or trim(l_answer.get_string('value')) is null or (l_field.get_string('type')='checkbox' and not nvl(l_answer.get_boolean('value'),false))) then
                    return l_field.get_string('label')||' is required.';
                end if;
                if l_value is not null and not l_value.is_null and l_answer.get_string('value') is not null then
                    if l_field.get_string('type')='checkbox' and not l_value.is_boolean then return l_field.get_string('label')||' must be checked or unchecked.'; end if;
                    if l_field.get_string('type')='number' and not l_value.is_number then return l_field.get_string('label')||' must be numeric.'; end if;
                    if l_field.get_string('type')='assessment' and l_answer.get_string('value') not in ('NORMAL','ABNORMAL') then return l_field.get_string('label')||' requires a valid assessment.'; end if;
                    if l_field.get_string('type')='number' and ((l_field.has('min') and l_answer.get_number('value')<l_field.get_number('min')) or (l_field.has('max') and l_answer.get_number('value')>l_field.get_number('max'))) then return l_field.get_string('label')||' is outside the configured entry range.'; end if;
                    if length(l_answer.get_string('value'))>case when l_field.get_string('type')='textarea' then @@EXAM_TEXTAREA@@ else @@EXAM_TEXT@@ end then return l_field.get_string('label')||' is too long.'; end if;
                    if l_field.get_string('type')='select' then
                        l_options:=l_field.get_array('options');l_allowed:=false;
                        if l_options is not null then
                            for j in 0..l_options.get_size-1 loop
                                l_option:=treat(l_options.get(j) as sys.json_object_t);
                                if l_option.get_string('value')=l_answer.get_string('value') then l_allowed:=true; end if;
                            end loop;
                        end if;
                        if not l_allowed then return l_field.get_string('label')||' requires a valid selection.'; end if;
                    end if;
                    l_note_values:=l_field.get_array('noteRequiredFor');
                    if l_note_values is not null then
                        for j in 0..l_note_values.get_size-1 loop
                            if l_note_values.get_string(j)=l_answer.get_string('value') and trim(l_answer.get_string('note')) is null then return l_field.get_string('label')||' requires findings, an action or a reason in the note.'; end if;
                        end loop;
                    end if;
                end if;
            end if;
        end loop;
        return null;
    exception when others then
        apex_debug.error('Clinical Anatomy 3D clinical validation: %s',sqlerrm);
        return 'The clinical selection could not be validated. Reload the item and try again.';
    end;
end ca3d_clinic_api;
/

-- Remove superseded code only after the replacement package compiles.
declare
    l_valid number;
begin
    select count(*) into l_valid from user_objects where object_name='CA3D_CLINIC_API'
        and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID';
    if l_valid<>2 then raise_application_error(-20087,'CA3D_CLINIC_API must compile before finishing the prefix upgrade.'); end if;
    for r in (select object_name,object_type from user_objects
               where (object_name='SK3_CLINIC_API' and object_type='PACKAGE')
                  or (object_name='SK3_CLINIC_CATALOG_V' and object_type='VIEW')) loop
        execute immediate 'drop '||r.object_type||' '||r.object_name;
    end loop;
end;
/
