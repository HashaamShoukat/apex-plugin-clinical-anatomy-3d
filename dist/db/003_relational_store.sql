-- Optional application integration example. Repeatable installation preserves demo data.
declare
    procedure ensure_object(p_name varchar2,p_type varchar2,p_ddl varchar2) is
        l_count number;
    begin
        select count(*) into l_count from user_objects where object_name=upper(p_name) and object_type=upper(p_type);
        if l_count=0 then execute immediate p_ddl; end if;
    exception when others then
        if sqlcode=-1452 and upper(p_name)='CA3D_ASSESSMENTS_ENCOUNTER_UQ' then
            raise_application_error(-20075,'Duplicate encounter/specialty assessments exist. Reconcile them before upgrading; no records were removed.');
        end if;
        raise;
    end;
begin
    ensure_object('ca3d_assessments','TABLE',q'~create table ca3d_assessments (
    assessment_id number generated always as identity primary key,
    workspace_id number not null,
    application_id number not null,
    owner_user varchar2(255 char) not null,
    encounter_ref varchar2(100 char) not null,
    specialty_code varchar2(30 char) not null,
    row_version number default 1 not null,
    payload_version number default 1 not null check (payload_version in (1,2)),
    model_sex varchar2(1) check (model_sex in ('M','F','U')),
    exam_present varchar2(1) default 'N' not null check (exam_present in ('Y','N')),
    exam_template varchar2(100 char),
    exam_version number,
    exam_profile varchar2(100 char),
    context_json clob check (context_json is json),
    context_refresh_json clob check (context_refresh_json is json),
    reload_json clob check (reload_json is json),
    created_at timestamp with time zone default systimestamp not null,
    updated_at timestamp with time zone default systimestamp not null
)~');
    ensure_object('ca3d_assessments_scope_ix','INDEX',q'~create index ca3d_assessments_scope_ix on ca3d_assessments(workspace_id,application_id,owner_user,encounter_ref)~');
    ensure_object('CA3D_ASSESSMENTS_ENCOUNTER_UQ','INDEX',q'~create unique index ca3d_assessments_encounter_uq on ca3d_assessments(workspace_id,application_id,owner_user,encounter_ref,specialty_code)~');
    ensure_object('ca3d_sites','TABLE',q'~create table ca3d_sites (
    site_id number generated always as identity primary key,
    assessment_id number not null references ca3d_assessments on delete cascade,
    site_no number not null,
    site_key varchar2(220 char) not null,
    area_code varchar2(40 char) not null,
    side_code varchar2(1) check (side_code in ('L','R')),
    bone_code varchar2(100 char),
    bone_name varchar2(400 char),
    part_code varchar2(100 char),
    part_name varchar2(400 char),
    display_label varchar2(400 char),
    pain_score number check (pain_score between 0 and 10),
    assessment_state varchar2(20) check (assessment_state in ('NORMAL','ABNORMAL','NOT_ASSESSED')),
    note_text varchar2(2000 char),
    unique (assessment_id,site_no),
    unique (assessment_id,site_key)
)~');
    ensure_object('ca3d_site_terms','TABLE',q'~create table ca3d_site_terms (
    site_term_id number generated always as identity primary key,
    site_id number not null references ca3d_sites on delete cascade,
    term_kind varchar2(12) not null check (term_kind in ('DIAGNOSIS','COMPLAINT')),
    term_no number not null,
    term_key varchar2(160 char) not null,
    term_source varchar2(40 char),
    catalog_term_id number,
    term_code varchar2(60 char),
    coding_system varchar2(40 char) not null,
    term_label varchar2(400 char) not null,
    specialty_code varchar2(30 char),
    certainty varchar2(20) check (certainty in ('unconfirmed','provisional','differential','confirmed','refuted')),
    unique (site_id,term_kind,term_no),
    unique (site_id,term_kind,term_key)
)~');
    ensure_object('ca3d_markers','TABLE',q'~create table ca3d_markers (
    marker_row_id number generated always as identity primary key,
    site_id number not null references ca3d_sites on delete cascade,
    marker_no number not null,
    marker_key varchar2(100 char),
    marker_kind varchar2(5) not null check (marker_kind in ('POINT','AREA')),
    marker_label varchar2(120 char),
    diagnosis_key varchar2(160 char),
    unique (site_id,marker_no)
)~');
    ensure_object('ca3d_marker_points','TABLE',q'~create table ca3d_marker_points (
    marker_row_id number not null references ca3d_markers on delete cascade,
    point_no number not null,
    x_coordinate number not null,
    y_coordinate number not null,
    z_coordinate number not null,
    primary key (marker_row_id,point_no)
)~');
    ensure_object('ca3d_exam_answers','TABLE',q'~create table ca3d_exam_answers (
    assessment_id number not null references ca3d_assessments on delete cascade,
    field_id varchar2(128 char) not null,
    value_type varchar2(8) not null check (value_type in ('ABSENT','NULL','STRING','NUMBER','BOOLEAN')),
    value_text varchar2(2000 char),
    value_number number,
    value_boolean varchar2(1) check (value_boolean in ('Y','N')),
    deferred_flag varchar2(1) check (deferred_flag in ('Y','N')),
    note_text varchar2(500 char),
    prefill_json clob check (prefill_json is json),
    primary key (assessment_id,field_id)
)~');
end;
/

-- Additive upgrade; never overwrite existing snapshots or answers.
declare
    l_count number;
begin
    select count(*) into l_count from user_tab_columns where table_name='CA3D_ASSESSMENTS' and column_name='CONTEXT_JSON';
    if l_count=0 then execute immediate 'alter table ca3d_assessments add (context_json clob check (context_json is json))'; end if;
    select count(*) into l_count from user_tab_columns where table_name='CA3D_ASSESSMENTS' and column_name='CONTEXT_REFRESH_JSON';
    if l_count=0 then execute immediate 'alter table ca3d_assessments add (context_refresh_json clob check (context_refresh_json is json))'; end if;
    select count(*) into l_count from user_tab_columns where table_name='CA3D_EXAM_ANSWERS' and column_name='PREFILL_JSON';
    if l_count=0 then execute immediate 'alter table ca3d_exam_answers add (prefill_json clob check (prefill_json is json))'; end if;
    for r in (select constraint_name from user_constraints where table_name='CA3D_ASSESSMENTS' and constraint_type='C'
               and regexp_replace(upper(search_condition_vc),'[[:space:]"]','') in ('MODEL_SEXIN(''M'',''F'')','MODEL_SEXIN(''M'',''F'',''U'')')) loop
        execute immediate 'alter table ca3d_assessments drop constraint '||dbms_assert.simple_sql_name(r.constraint_name);
    end loop;
    execute immediate q'[alter table ca3d_assessments add constraint ca3d_assessments_sex_ck check (model_sex in ('M','F','U'))]';
end;
/

begin
    update ca3d_sites set site_key='P|'||substr(site_key,3) where site_key like 'B|%';
end;
/

-- Compile data backfill only after additive DDL has completed on older schemas.
begin
    -- Recover metadata from snapshots saved by older versions, where available.
    update ca3d_assessments set context_json=json_query(reload_json,'$.context' returning clob null on error)
     where context_json is null and reload_json is not null and json_exists(reload_json,'$.context');
    for r in (select assessment_id,reload_json from ca3d_assessments where reload_json is not null and json_exists(reload_json,'$.exam.answers')) loop
        declare l_doc json_object_t; l_exam json_object_t; l_answers json_object_t; l_answer json_object_t; l_names json_key_list; l_json clob;
        begin
            l_doc:=json_object_t.parse(r.reload_json);l_exam:=l_doc.get_object('exam');l_answers:=l_exam.get_object('answers');
            if l_answers is not null then
                l_names:=l_answers.get_keys;
                for i in 1..l_names.count loop
                    l_answer:=l_answers.get_object(l_names(i));
                    if l_answer.get_object('prefill') is not null then
                        l_json:=l_answer.get('prefill').to_clob;
                        update ca3d_exam_answers set prefill_json=l_json where assessment_id=r.assessment_id and field_id=l_names(i) and prefill_json is null;
                    end if;
                end loop;
            end if;
        end;
    end loop;
end;
/

create or replace view ca3d_assessments_v as
select a.* from ca3d_assessments a
 where workspace_id=apex_custom_auth.get_security_group_id
   and application_id=to_number(v('APP_ID')) and owner_user=upper(v('APP_USER'));
create or replace view ca3d_findings_v as
select a.assessment_id,a.encounter_ref,a.specialty_code,a.model_sex,a.updated_at,
       s.site_id,s.area_code,s.side_code,s.bone_code,s.part_code,s.display_label,
       s.pain_score,s.assessment_state,s.note_text
  from ca3d_assessments_v a join ca3d_sites s on s.assessment_id=a.assessment_id;
create or replace view ca3d_diagnoses_v as
select f.*,t.site_term_id,t.term_source,t.catalog_term_id,t.term_code,
       t.coding_system,t.term_label,t.certainty
  from ca3d_findings_v f join ca3d_site_terms t on t.site_id=f.site_id
 where t.term_kind='DIAGNOSIS';

create or replace package ca3d_relational_api as
    procedure save_assessment(
        p_id in out number, p_version in out number, p_payload clob,
        p_encounter_ref varchar2, p_specialty varchar2 default 'ALL',
        p_keep_json boolean default true,
        p_exam_mode varchar2 default 'OFF',p_patient_context clob default null,p_context_options varchar2 default '{}',p_patient_sex varchar2 default null);
    function load_json(p_id number) return clob;
end ca3d_relational_api;
/
create or replace package body ca3d_relational_api as
    procedure require_context is
    begin
        if v('APP_ID') is null or apex_custom_auth.get_security_group_id is null
           or v('APP_USER') is null or upper(v('APP_USER')) in ('NOBODY','APEX_PUBLIC_USER','HTMLDB_PUBLIC_USER') then
            raise_application_error(-20071,'An authenticated APEX application session is required.');
        end if;
    end;

    procedure save_assessment(
        p_id in out number, p_version in out number, p_payload clob,
        p_encounter_ref varchar2, p_specialty varchar2 default 'ALL',
        p_keep_json boolean default true,
        p_exam_mode varchar2 default 'OFF',p_patient_context clob default null,p_context_options varchar2 default '{}',p_patient_sex varchar2 default null) is
        l_error varchar2(4000);
        l_doc json_object_t;
        l_sites json_array_t;
        l_site json_object_t;
        l_exam json_object_t;
        l_answers json_object_t;
        l_answer json_object_t;
        l_value json_element_t;
        l_keys json_key_list;
        l_site_id number;
        l_site_row ca3d_sites%rowtype;
        l_payload_version number;
        l_model_sex varchar2(1);
        l_note varchar2(500 char);
        l_json clob;
        l_context clob;
        l_refresh clob;
        l_prefill clob;
        l_definition clob;
        l_key varchar2(220);
        l_type varchar2(8);
        l_text varchar2(2000 char);
        l_number number;
        l_boolean varchar2(1);
        l_deferred varchar2(1);
        l_exam_present varchar2(1):='N';
        l_template varchar2(100 char);
        l_exam_version number;
        l_profile varchar2(100 char);
    begin
        savepoint ca3d_save;
        require_context;
        if trim(p_encounter_ref) is null or length(p_encounter_ref)>100 then raise_application_error(-20072,'Provide an encounter reference of up to 100 characters.'); end if;
        if p_specialty is null or p_specialty not in ('ALL','ENT','OPHTHALMOLOGY','CARDIOLOGY','UROLOGY','INTERNAL_MEDICINE','GASTROENTEROLOGY','NEUROLOGY','PULMONOLOGY','ORTHOPEDICS') then
            raise_application_error(-20072,'Choose a supported specialty.');
        end if;
        if p_exam_mode is null or p_exam_mode not in ('OFF','OPTIONAL','REQUIRED') then raise_application_error(-20072,'Choose a valid examination mode.'); end if;
        l_error:=skeleton3d_pkg.validate_payload(p_payload,p_specialty,p_patient_sex);
        if l_error is not null then raise_application_error(-20073,l_error); end if;
        -- Validate custom catalog ownership and the configured examination on the server.
        l_error:=ca3d_clinic_api.validate_value(p_payload,p_exam_mode);
        if l_error is not null then raise_application_error(-20073,l_error); end if;
        if p_exam_mode<>'OFF' then l_definition:=ca3d_clinic_api.exam_definition; end if;
        l_error:=skeleton3d_pkg.validate_patient(p_payload,p_patient_context,p_context_options,l_definition);
        if l_error is not null then raise_application_error(-20073,l_error); end if;
        if p_payload is null then raise_application_error(-20073,'Provide an anatomy document, including sites: [] when clearing findings.'); end if;
        l_doc:=json_object_t.parse(p_payload);
        l_sites:=l_doc.get_array('sites');
        if l_doc.has('context') then l_context:=l_doc.get('context').to_clob; end if;
        if l_doc.has('contextRefresh') then l_refresh:=l_doc.get('contextRefresh').to_clob; end if;
        l_payload_version:=nvl(l_doc.get_number('v'),1);
        l_model_sex:=l_doc.get_string('sex');
        if p_keep_json then l_json:=p_payload; end if;
        l_exam:=l_doc.get_object('exam');
        if l_exam is not null then
            l_exam_present:='Y'; l_template:=l_exam.get_string('template');
            l_exam_version:=l_exam.get_number('version'); l_profile:=l_exam.get_string('profile');
        end if;
        if p_id is null then
            insert into ca3d_assessments(workspace_id,application_id,owner_user,encounter_ref,specialty_code,
                payload_version,model_sex,exam_present,exam_template,exam_version,exam_profile,context_json,context_refresh_json,reload_json)
            values(apex_custom_auth.get_security_group_id,to_number(v('APP_ID')),upper(v('APP_USER')),trim(p_encounter_ref),p_specialty,
                l_payload_version,l_model_sex,l_exam_present,l_template,l_exam_version,l_profile,l_context,l_refresh,l_json)
            returning assessment_id,row_version into p_id,p_version;
        else
            update ca3d_assessments set encounter_ref=trim(p_encounter_ref),specialty_code=p_specialty,
                payload_version=l_payload_version,model_sex=l_model_sex,
                exam_present=l_exam_present,exam_template=l_template,exam_version=l_exam_version,exam_profile=l_profile,
                context_json=l_context,context_refresh_json=l_refresh,reload_json=l_json,row_version=row_version+1,updated_at=systimestamp
             where assessment_id=p_id and row_version=p_version and workspace_id=apex_custom_auth.get_security_group_id
               and application_id=to_number(v('APP_ID')) and owner_user=upper(v('APP_USER'));
            if sql%rowcount<>1 then raise_application_error(-20074,'This assessment is unavailable or changed. Reload it before saving.'); end if;
            p_version:=p_version+1;
            update ca3d_sites set site_no=-site_no where assessment_id=p_id;
            delete from ca3d_exam_answers where assessment_id=p_id;
        end if;
        for i in 0..l_sites.get_size-1 loop
            l_site:=treat(l_sites.get(i) as json_object_t);
            l_key:=case when l_site.get_string('part') is not null then 'P|'||l_site.get_string('part')
                        when l_site.get_string('bone') is not null then 'P|'||l_site.get_string('bone')
                        else 'A|'||l_site.get_string('area') end||'|'||l_site.get_string('side');
            l_site_row.area_code:=l_site.get_string('area'); l_site_row.side_code:=l_site.get_string('side');
            l_site_row.bone_code:=l_site.get_string('bone'); l_site_row.bone_name:=l_site.get_string('boneName');
            l_site_row.part_code:=l_site.get_string('part'); l_site_row.part_name:=l_site.get_string('partName');
            l_site_row.display_label:=l_site.get_string('label'); l_site_row.pain_score:=l_site.get_number('pain');
            l_site_row.assessment_state:=l_site.get_string('assessment'); l_site_row.note_text:=l_site.get_string('note');
            begin
                select site_id into l_site_id from ca3d_sites where assessment_id=p_id and site_key=l_key;
                update ca3d_sites set site_no=i+1,area_code=l_site_row.area_code,side_code=l_site_row.side_code,
                    bone_code=l_site_row.bone_code,bone_name=l_site_row.bone_name,part_code=l_site_row.part_code,part_name=l_site_row.part_name,
                    display_label=l_site_row.display_label,pain_score=l_site_row.pain_score,assessment_state=l_site_row.assessment_state,note_text=l_site_row.note_text
                 where site_id=l_site_id;
            exception when no_data_found then
            insert into ca3d_sites(assessment_id,site_no,site_key,area_code,side_code,bone_code,bone_name,
                part_code,part_name,display_label,pain_score,assessment_state,note_text)
            values(p_id,i+1,l_key,l_site_row.area_code,l_site_row.side_code,l_site_row.bone_code,l_site_row.bone_name,
                l_site_row.part_code,l_site_row.part_name,l_site_row.display_label,l_site_row.pain_score,l_site_row.assessment_state,l_site_row.note_text)
            returning site_id into l_site_id;
            end;
            update ca3d_site_terms set term_no=-site_term_id where site_id=l_site_id;
            update ca3d_markers set marker_no=-marker_no where site_id=l_site_id;
            if l_site.get_array('diagnoses') is null then l_site.put('diagnoses',json_array_t()); end if;
            if l_site.get_array('complaints') is null then l_site.put('complaints',json_array_t()); end if;
            if l_site.get_array('markers') is null then l_site.put('markers',json_array_t()); end if;
            l_json:=l_site.to_clob;
            -- Separate array projections preserve each term's kind and avoid multiplying rows.
            merge into ca3d_site_terms t using (
                select l_site_id site_id,'DIAGNOSIS' term_kind,j.term_no,
                   case when j.source='CUSTOM' then 'CUSTOM|'||to_char(j.id,'TM9') else nvl(j.system,'ICD-10')||'|'||j.code end term_key,
                   j.source,j.id,j.code,nvl(j.system,case when j.source='CUSTOM' then 'CUSTOM' else 'ICD-10' end ) system,j.label,j.specialty,j.certainty
              from json_table(l_json,'$.diagnoses[*]' error on error columns(
                   term_no for ordinality,source varchar2(40 char) path '$.source' null on empty,id number path '$.id' null on empty,
                   code varchar2(60 char) path '$.code' null on empty,system varchar2(40 char) path '$.system' null on empty,label varchar2(400 char) path '$.label',
                   specialty varchar2(30 char) path '$.specialty' null on empty,certainty varchar2(20) path '$.certainty' null on empty)) j
            ) j on (t.site_id=j.site_id and t.term_kind=j.term_kind and t.term_key=j.term_key)
            when matched then update set t.term_no=j.term_no,t.term_source=j.source,t.catalog_term_id=j.id,t.term_code=j.code,
                t.coding_system=j.system,t.term_label=j.label,t.specialty_code=j.specialty,t.certainty=j.certainty
            when not matched then insert(site_id,term_kind,term_no,term_key,term_source,catalog_term_id,term_code,coding_system,term_label,specialty_code,certainty)
                values(j.site_id,j.term_kind,j.term_no,j.term_key,j.source,j.id,j.code,j.system,j.label,j.specialty,j.certainty);
            merge into ca3d_site_terms t using (
                select l_site_id site_id,'COMPLAINT' term_kind,j.term_no,
                   case when j.source='CUSTOM' then 'CUSTOM|'||to_char(j.id,'TM9') else nvl(j.system,'COMPLAINT')||'|'||j.code end term_key,
                   j.source,j.id,j.code,nvl(j.system,case when j.source='CUSTOM' then 'CUSTOM' else 'COMPLAINT' end ) system,j.label,j.specialty,j.certainty
              from json_table(l_json,'$.complaints[*]' error on error columns(
                   term_no for ordinality,source varchar2(40 char) path '$.source' null on empty,id number path '$.id' null on empty,
                   code varchar2(60 char) path '$.code' null on empty,system varchar2(40 char) path '$.system' null on empty,label varchar2(400 char) path '$.label',
                   specialty varchar2(30 char) path '$.specialty' null on empty,certainty varchar2(20) path '$.certainty' null on empty)) j
            ) j on (t.site_id=j.site_id and t.term_kind=j.term_kind and t.term_key=j.term_key)
            when matched then update set t.term_no=j.term_no,t.term_source=j.source,t.catalog_term_id=j.id,t.term_code=j.code,
                t.coding_system=j.system,t.term_label=j.label,t.specialty_code=j.specialty,t.certainty=j.certainty
            when not matched then insert(site_id,term_kind,term_no,term_key,term_source,catalog_term_id,term_code,coding_system,term_label,specialty_code,certainty)
                values(j.site_id,j.term_kind,j.term_no,j.term_key,j.source,j.id,j.code,j.system,j.label,j.specialty,j.certainty);
            for marker in (select j.* from json_table(l_json,'$.markers[*]' error on error columns(
                marker_no for ordinality,id varchar2(100 char) path '$.id' null on empty,kind varchar2(5) path '$.kind',
                label varchar2(120 char) path '$.label' null on empty,diagnosis varchar2(160 char) path '$.diagnosis' null on empty,
                points clob format json path '$.points')) j) loop
                declare l_marker_id number;
                begin
                    begin
                        select marker_row_id into l_marker_id from ca3d_markers where site_id=l_site_id
                          and ((marker.id is not null and marker_key=marker.id) or (marker.id is null and marker_key is null and marker_no=-marker.marker_no));
                        update ca3d_markers set marker_no=marker.marker_no,marker_kind=marker.kind,marker_label=marker.label,diagnosis_key=marker.diagnosis where marker_row_id=l_marker_id;
                        delete from ca3d_marker_points where marker_row_id=l_marker_id;
                    exception when no_data_found then
                    insert into ca3d_markers(site_id,marker_no,marker_key,marker_kind,marker_label,diagnosis_key)
                    values(l_site_id,marker.marker_no,marker.id,marker.kind,marker.label,marker.diagnosis)
                    returning marker_row_id into l_marker_id;

                    end;
                    insert into ca3d_marker_points(marker_row_id,point_no,x_coordinate,y_coordinate,z_coordinate)
                    select l_marker_id,j.point_no,j.x,j.y,j.z from json_table(marker.points,'$[*]' error on error columns(
                        point_no for ordinality,x number path '$[0]',y number path '$[1]',z number path '$[2]')) j;
                end;
            end loop;
            delete from ca3d_site_terms where site_id=l_site_id and term_no<0;
            delete from ca3d_markers where site_id=l_site_id and marker_no<0;
        end loop;
        delete from ca3d_sites where assessment_id=p_id and site_no<0;
        if l_exam is not null then
            l_answers:=l_exam.get_object('answers');
            if l_answers is not null then
                l_keys:=l_answers.get_keys;
                for i in 1..l_keys.count loop
                    l_answer:=l_answers.get_object(l_keys(i)); l_value:=l_answer.get('value');
                    l_type:='ABSENT'; l_text:=null; l_number:=null; l_boolean:=null; l_deferred:=null;
                    if l_value is not null then
                        if l_value.is_null then l_type:='NULL';
                        elsif l_value.is_number then l_type:='NUMBER'; l_number:=l_answer.get_number('value');
                        elsif l_value.is_boolean then l_type:='BOOLEAN'; l_boolean:=case when l_answer.get_boolean('value') then 'Y' else 'N' end;
                        else l_type:='STRING'; l_text:=l_answer.get_string('value'); end if;
                    end if;
                    if l_answer.has('deferred') then l_deferred:=case when l_answer.get_boolean('deferred') then 'Y' else 'N' end; end if;
                    l_note:=l_answer.get_string('note');l_prefill:=null;
                    if l_answer.get_object('prefill') is not null then l_prefill:=l_answer.get('prefill').to_clob; end if;
                    insert into ca3d_exam_answers(assessment_id,field_id,value_type,value_text,value_number,value_boolean,deferred_flag,note_text,prefill_json)
                    values(p_id,l_keys(i),l_type,l_text,l_number,l_boolean,l_deferred,l_note,l_prefill);
                end loop;
            end if;
        end if;
    exception when others then
        rollback to ca3d_save;
        raise;
    end;

    function load_json(p_id number) return clob is
        l_record ca3d_assessments%rowtype;
        l_doc json_object_t:=json_object_t();
        l_sites json_array_t:=json_array_t();
        l_site json_object_t;
        l_terms json_array_t;
        l_term json_object_t;
        l_markers json_array_t;
        l_marker json_object_t;
        l_points json_array_t;
        l_point json_array_t;
        l_exam json_object_t:=json_object_t();
        l_answers json_object_t:=json_object_t();
        l_answer json_object_t;
    begin
        require_context;
        select * into l_record from ca3d_assessments_v where assessment_id=p_id;
        l_doc.put('v',l_record.payload_version);
        if l_record.context_refresh_json is not null then l_doc.put('contextRefresh',json_object_t.parse(l_record.context_refresh_json)); end if;
        if l_record.context_json is not null then l_doc.put('context',json_object_t.parse(l_record.context_json)); end if;
        if l_record.model_sex is not null then l_doc.put('sex',l_record.model_sex); end if;
        for site in (select * from ca3d_sites where assessment_id=p_id order by site_no) loop
            l_site:=json_object_t(); l_site.put('area',site.area_code);
            if site.side_code is not null then l_site.put('side',site.side_code); end if;
            if site.bone_code is not null then l_site.put('bone',site.bone_code); l_site.put('boneName',site.bone_name); end if;
            if site.part_code is not null then l_site.put('part',site.part_code); l_site.put('partName',site.part_name); end if;
            if site.display_label is not null then l_site.put('label',site.display_label); end if;
            if site.pain_score is not null then l_site.put('pain',site.pain_score); end if;
            if site.assessment_state is not null then l_site.put('assessment',site.assessment_state); end if;
            if site.note_text is not null then l_site.put('note',site.note_text); end if;
            for kind in 1..2 loop
                l_terms:=json_array_t();
                for term in (select * from ca3d_site_terms where site_id=site.site_id
                    and term_kind=case kind when 1 then 'DIAGNOSIS' else 'COMPLAINT' end order by term_no) loop
                    l_term:=json_object_t(); l_term.put('label',term.term_label); l_term.put('system',term.coding_system);
                    if term.term_source is not null then l_term.put('source',term.term_source); end if;
                    if term.catalog_term_id is not null then l_term.put('id',term.catalog_term_id); end if;
                    if term.term_code is not null then l_term.put('code',term.term_code); end if;
                    if term.specialty_code is not null then l_term.put('specialty',term.specialty_code); end if;
                    if term.certainty is not null then l_term.put('certainty',term.certainty); end if;
                    l_terms.append(l_term);
                end loop;
                l_site.put(case kind when 1 then 'diagnoses' else 'complaints' end,l_terms);
            end loop;
            l_markers:=json_array_t();
            for marker in (select * from ca3d_markers where site_id=site.site_id order by marker_no) loop
                l_marker:=json_object_t(); if marker.marker_key is not null then l_marker.put('id',marker.marker_key); end if; l_marker.put('kind',marker.marker_kind);
                if marker.marker_label is not null then l_marker.put('label',marker.marker_label); end if; l_marker.put('diagnosis',marker.diagnosis_key);
                l_points:=json_array_t();
                for point in (select * from ca3d_marker_points where marker_row_id=marker.marker_row_id order by point_no) loop
                    l_point:=json_array_t(); l_point.append(point.x_coordinate); l_point.append(point.y_coordinate); l_point.append(point.z_coordinate);
                    l_points.append(l_point);
                end loop;
                l_marker.put('points',l_points); l_markers.append(l_marker);
            end loop;
            if l_markers.get_size>0 then l_site.put('markers',l_markers); end if;
            l_sites.append(l_site);
        end loop;
        l_doc.put('sites',l_sites);
        if l_record.exam_present='Y' then
            l_exam.put('template',l_record.exam_template); l_exam.put('version',l_record.exam_version);
            if l_record.exam_profile is not null then l_exam.put('profile',l_record.exam_profile); end if;
            for answer in (select * from ca3d_exam_answers where assessment_id=p_id order by field_id) loop
                l_answer:=json_object_t();
                case answer.value_type
                    when 'STRING' then
                        if answer.value_text is null then l_answer:=json_object_t.parse('{"value":""}');
                        else l_answer.put('value',answer.value_text); end if;
                    when 'NUMBER' then l_answer.put('value',answer.value_number);
                    when 'BOOLEAN' then l_answer.put('value',answer.value_boolean='Y');
                    when 'NULL' then l_answer.put_null('value');
                    else null;
                end case;
                if answer.deferred_flag is not null then l_answer.put('deferred',answer.deferred_flag='Y'); end if;
                if answer.note_text is not null then l_answer.put('note',answer.note_text); end if;
                if answer.prefill_json is not null then l_answer.put('prefill',json_object_t.parse(answer.prefill_json)); end if;
                l_answers.put(answer.field_id,l_answer);
            end loop;
            l_exam.put('answers',l_answers); l_doc.put('exam',l_exam);
        end if;
        return l_doc.to_clob;
    exception when no_data_found then raise_application_error(-20075,'This assessment is unavailable.');
    end;
end ca3d_relational_api;
/
