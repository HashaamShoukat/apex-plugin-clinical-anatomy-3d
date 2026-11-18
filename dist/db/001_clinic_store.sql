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

-- Pre-production consolidation: remap stored examples, then remove duplicates.
-- The final schema has one row per term and no compatibility aliases.
declare
    l_count number;
begin
    select count(*) into l_count from user_constraints where constraint_type='R'
        and r_constraint_name in (select constraint_name from user_constraints where table_name in ('CA3D_EXAM_DEFINITIONS','CA3D_CATALOG_SCOPES'));
    if l_count>0 then raise_application_error(-20088,'Custom foreign keys reference catalogue metadata. Reconcile them before consolidating.');end if;
    select count(*) into l_count from user_tab_columns where table_name='CA3D_CLINIC_TERMS' and column_name='CATALOG_SCOPE';
    if l_count>0 then
        select count(*) into l_count from user_constraints where constraint_type='R'
          and table_name not in ('CA3D_TERM_AREAS','CA3D_CLINIC_TERMS')
          and r_constraint_name in (select constraint_name from user_constraints where table_name='CA3D_CLINIC_TERMS');
        if l_count>0 then raise_application_error(-20088,'Custom foreign keys reference term IDs. Remap them before removing duplicate terms.');end if;
        select count(*) into l_count from user_tab_columns where table_name='CA3D_CLINIC_TERMS' and column_name='CANONICAL_TERM_ID';
        if l_count=0 then execute immediate 'alter table ca3d_clinic_terms add canonical_term_id number';end if;
        -- Check conflicts before dropping constraints or changing existing records.
        execute immediate q'~
            select count(*) from (
                select workspace_id,application_id,term_kind,specialty_code,coding_system,term_code
                from (
                    select t.*,row_number() over(partition by workspace_id,application_id,term_kind,specialty_code,coding_system,term_code,
                        label_key,active_yn,external_id,keywords,specialty_filter order by term_id) rn
                    from ca3d_clinic_terms t where canonical_term_id is null
                ) where rn=1
                group by workspace_id,application_id,term_kind,specialty_code,coding_system,term_code having count(*)>1
            )~' into l_count;
        if l_count>0 then raise_application_error(-20088,'Different terms use the same code across old catalogues. Reconcile these conflicts before consolidating. No terms were changed.');end if;
        execute immediate q'~
            select count(*) from (
                select workspace_id,application_id,term_kind,specialty_code,coding_system,label_key
                from (
                    select t.*,row_number() over(partition by workspace_id,application_id,term_kind,specialty_code,coding_system,term_code,
                        label_key,active_yn,external_id,keywords,specialty_filter order by term_id) rn
                    from ca3d_clinic_terms t where canonical_term_id is null
                ) where rn=1
                group by workspace_id,application_id,term_kind,specialty_code,coding_system,label_key having count(*)>1
            )~' into l_count;
        if l_count>0 then raise_application_error(-20088,'Different terms use the same name across old catalogues. Reconcile these conflicts before consolidating. No terms were changed.');end if;
        execute immediate q'~
            merge into ca3d_clinic_terms target using (
                select term_id,first_value(term_id) over (
                    partition by workspace_id,application_id,term_kind,specialty_code,coding_system,term_code,label_key,active_yn,external_id,keywords,specialty_filter
                    order by case when term_origin='LOCAL' then 0 else 1 end,term_id
                ) canonical_id from ca3d_clinic_terms where canonical_term_id is null
            ) source on (source.term_id=target.term_id)
            when matched then update set target.canonical_term_id=source.canonical_id,target.active_yn='N'
            where source.term_id<>source.canonical_id~';
        execute immediate q'~
            merge into ca3d_term_areas target using (
                select distinct nvl(t.canonical_term_id,t.term_id) term_id,a.area_code,a.part_code
                from ca3d_term_areas a join ca3d_clinic_terms t on t.term_id=a.term_id
            ) source on (target.term_id=source.term_id and target.area_code=source.area_code and target.part_code=source.part_code)
            when not matched then insert(term_id,area_code,part_code) values(source.term_id,source.area_code,source.part_code)~';
        select count(*) into l_count from user_constraints where table_name='CA3D_CLINIC_TERMS' and constraint_name='CA3D_TERMS_UQ';
        if l_count>0 then execute immediate 'alter table ca3d_clinic_terms drop constraint ca3d_terms_uq';end if;
        select count(*) into l_count from user_indexes where index_name='CA3D_TERMS_CODE_UQ';
        if l_count>0 then execute immediate 'drop index ca3d_terms_code_uq';end if;
        execute immediate 'alter table ca3d_clinic_terms drop column catalog_scope';
    end if;

    select count(*) into l_count from user_tab_columns where table_name='CA3D_EXAM_DEFINITIONS' and column_name='CATALOG_SCOPE';
    if l_count>0 then
        select count(*) into l_count from user_constraints where constraint_type='R'
            and r_constraint_name in (select constraint_name from user_constraints where table_name='CA3D_EXAM_DEFINITIONS');
        if l_count>0 then raise_application_error(-20088,'Custom foreign keys reference old examination definitions. Reconcile them before removing catalogue scopes.');end if;
        select count(*) into l_count from user_constraints where table_name='CA3D_EXAM_DEFINITIONS' and constraint_name='CA3D_EXAM_DEF_UQ';
        if l_count>0 then execute immediate 'alter table ca3d_exam_definitions drop constraint ca3d_exam_def_uq';end if;
        -- Identical copied forms need one definition. Distinct forms are retained
        -- as ordered history; the latest former CLINIC form remains current.
        execute immediate q'~
            delete from ca3d_exam_definitions d where exists (
                select 1 from ca3d_exam_definitions keep
                where keep.workspace_id=d.workspace_id and keep.application_id=d.application_id
                  and json_equal(keep.definition,d.definition)
                  and (case when keep.catalog_scope='CLINIC' then 0 else 1 end < case when d.catalog_scope='CLINIC' then 0 else 1 end
                    or (case when keep.catalog_scope='CLINIC' then 0 else 1 end = case when d.catalog_scope='CLINIC' then 0 else 1 end and keep.definition_id<d.definition_id))
            )~';
        execute immediate q'~
            declare
                l_current number;l_next number;l_doc json_object_t;l_definition clob;
            begin
                for app in (select distinct workspace_id,application_id from ca3d_exam_definitions) loop
                    select definition_id into l_current from ca3d_exam_definitions
                    where workspace_id=app.workspace_id and application_id=app.application_id
                    order by case when catalog_scope='CLINIC' then 0 else 1 end,version_no desc,definition_id desc fetch first 1 row only;
                    l_next:=0;
                    for form in (select definition_id,definition from ca3d_exam_definitions
                        where workspace_id=app.workspace_id and application_id=app.application_id
                        order by case when definition_id=l_current then 1 else 0 end,version_no,definition_id) loop
                        l_doc:=json_object_t.parse(form.definition);l_doc.put('version',l_next);l_definition:=l_doc.to_clob;
                        update ca3d_exam_definitions set version_no=l_next,definition=l_definition where definition_id=form.definition_id;
                        l_next:=l_next+1;
                    end loop;
                end loop;
            end;~';
        execute immediate 'alter table ca3d_exam_definitions drop column catalog_scope';
        execute immediate 'alter table ca3d_exam_definitions add constraint ca3d_exam_def_uq unique(workspace_id,application_id,version_no)';
    end if;

    select count(*) into l_count from user_tables where table_name='CA3D_CATALOG_SCOPES';
    if l_count>0 then
        select count(*) into l_count from user_constraints where constraint_type='R'
            and r_constraint_name in (select constraint_name from user_constraints where table_name='CA3D_CATALOG_SCOPES');
        if l_count>0 then raise_application_error(-20088,'Custom foreign keys reference the retired catalogue-scope table.');end if;
        execute immediate 'drop table ca3d_catalog_scopes';
    end if;
end;
/

-- Remap the supplied JSON/relational examples before deleting duplicate IDs.
-- No temporary mapping column or alias rows remain after installation.
declare
    l_count number;l_mapping clob;l_map json_object_t;l_keys json_key_list;
    l_old number;l_new number;l_rows number:=0;
    function remap_json(p_payload clob) return clob is
        l_doc json_object_t;l_sites json_array_t;l_site json_object_t;l_terms json_array_t;l_term json_object_t;
        l_markers json_array_t;l_marker json_object_t;l_key varchar2(100);l_changed boolean:=false;
        procedure remap_terms(p_name varchar2) is
        begin
            l_terms:=l_site.get_array(p_name);if l_terms is null then return;end if;
            for j in 0..l_terms.get_size-1 loop
                l_term:=treat(l_terms.get(j) as json_object_t);
                if l_term.get_string('source')='CUSTOM' and l_term.has('id') then
                    l_key:=to_char(l_term.get_number('id'),'TM9');
                    if l_map.has(l_key) then l_term.put('id',l_map.get_number(l_key));l_terms.put(j,l_term,true);l_changed:=true;end if;
                end if;
            end loop;
            l_site.put(p_name,l_terms);
        end;
    begin
        l_doc:=json_object_t.parse(p_payload);l_sites:=l_doc.get_array('sites');
        if l_sites is null then return p_payload;end if;
        for i in 0..l_sites.get_size-1 loop
            l_site:=treat(l_sites.get(i) as json_object_t);remap_terms('diagnoses');remap_terms('complaints');
            l_markers:=l_site.get_array('markers');
            if l_markers is not null then
                for j in 0..l_markers.get_size-1 loop
                    l_marker:=treat(l_markers.get(j) as json_object_t);l_key:=l_marker.get_string('diagnosis');
                    if substr(l_key,1,7)='CUSTOM|' and l_map.has(substr(l_key,8)) then
                        l_marker.put('diagnosis','CUSTOM|'||to_char(l_map.get_number(substr(l_key,8)),'TM9'));
                        l_markers.put(j,l_marker,true);l_changed:=true;
                    end if;
                end loop;
                l_site.put('markers',l_markers);
            end if;
            l_sites.put(i,l_site,true);
        end loop;
        if not l_changed then return p_payload;end if;
        l_doc.put('sites',l_sites);return l_doc.to_clob;
    end;
    procedure remap_table(p_table varchar2,p_column varchar2) is
        l_cursor sys_refcursor;l_rowid rowid;l_before clob;l_after clob;
    begin
        select count(*) into l_count from user_tab_columns where table_name=p_table and column_name=p_column;
        if l_count=0 then return;end if;
        open l_cursor for 'select rowid,'||p_column||' from '||p_table||' where '||p_column||' is not null';
        loop
            fetch l_cursor into l_rowid,l_before;exit when l_cursor%notfound;
            l_after:=remap_json(l_before);
            if dbms_lob.compare(l_before,l_after)<>0 then
                execute immediate 'update '||p_table||' set '||p_column||'=:payload where rowid=:rid' using l_after,l_rowid;
            end if;
        end loop;
        close l_cursor;
    end;
begin
    select count(*) into l_count from user_tab_columns where table_name='CA3D_CLINIC_TERMS' and column_name='CANONICAL_TERM_ID';
    if l_count>0 then
        execute immediate 'select json_objectagg(to_char(term_id,''TM9'') value canonical_term_id returning clob) from ca3d_clinic_terms where canonical_term_id is not null' into l_mapping;
        if l_mapping is not null then
            l_map:=json_object_t.parse(l_mapping);l_keys:=l_map.get_keys;
            remap_table('CA3D_DEMO_RECORDS','ASSESSMENT_JSON');remap_table('CA3D_ASSESSMENTS','RELOAD_JSON');
            for i in 1..l_keys.count loop
                l_old:=to_number(l_keys(i));l_new:=l_map.get_number(l_keys(i));
                select count(*) into l_count from user_tables where table_name='CA3D_SITE_TERMS';
                if l_count>0 then execute immediate q'~update ca3d_site_terms set catalog_term_id=:new_id,term_key='CUSTOM|'||to_char(:new_key,'TM9') where term_source='CUSTOM' and catalog_term_id=:old_id~' using l_new,l_new,l_old;end if;
                select count(*) into l_count from user_tables where table_name='CA3D_MARKERS';
                if l_count>0 then execute immediate q'~update ca3d_markers set diagnosis_key='CUSTOM|'||to_char(:new_id,'TM9') where diagnosis_key='CUSTOM|'||to_char(:old_id,'TM9')~' using l_new,l_old;end if;
                execute immediate 'delete from ca3d_term_areas where term_id=:id' using l_old;
                execute immediate 'delete from ca3d_clinic_terms where term_id=:id' using l_old;l_rows:=l_rows+sql%rowcount;
            end loop;
        end if;
        for r in (select constraint_name from user_constraints where table_name='CA3D_CLINIC_TERMS' and constraint_name='CA3D_TERM_CANONICAL_FK') loop
            execute immediate 'alter table ca3d_clinic_terms drop constraint '||r.constraint_name;
        end loop;
        for r in (select index_name from user_indexes where index_name in ('CA3D_TERMS_LABEL_UQ','CA3D_TERMS_CODE_UQ')) loop
            execute immediate 'drop index '||r.index_name;
        end loop;
        execute immediate 'alter table ca3d_clinic_terms drop column canonical_term_id';
        dbms_output.put_line('Removed '||l_rows||' duplicate term rows after remapping stored examples.');
    end if;
end;
/

-- Shared terms are unique by application, kind, specialty and coding system.
declare
    l_count number;
begin
    select count(*) into l_count from user_constraints where table_name='CA3D_CLINIC_TERMS' and constraint_name='CA3D_TERMS_UQ';
    if l_count>0 then execute immediate 'alter table ca3d_clinic_terms drop constraint ca3d_terms_uq';end if;
    select count(*) into l_count from user_indexes where index_name='CA3D_TERMS_LABEL_UQ';
    if l_count=0 then execute immediate 'create unique index ca3d_terms_label_uq on ca3d_clinic_terms(workspace_id,application_id,term_kind,specialty_code,coding_system,label_key)';end if;
    select count(*) into l_count from user_indexes where index_name='CA3D_TERMS_CODE_UQ';
    if l_count=0 then execute immediate 'create unique index ca3d_terms_code_uq on ca3d_clinic_terms(workspace_id,application_id,term_kind,specialty_code,coding_system,term_code)';end if;
end;
/


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
    c_areas constant varchar2(2000) := ':HEAD:FACE:JAW:NECK:SHOULDER:UPPER_ARM:ELBOW:FOREARM:WRIST:HAND:CHEST:UPPER_BACK:LOWER_BACK:PELVIS:SACRUM:HIP:THIGH:KNEE:LOWER_LEG:ANKLE:FOOT:BRAIN:EAR:EYE:NOSE:THROAT:THYROID:AIRWAY:LUNG:HEART:AORTA:VENA_CAVA:ESOPHAGUS:LIVER:GALLBLADDER:STOMACH:PANCREAS:SPLEEN:SMALL_INTESTINE:COLON:KIDNEY:ADRENAL:URETER:BLADDER:URETHRA:PROSTATE:';

    function default_exam return clob is
    begin
        return q'~{"key":"GENERAL","version":0,"title":"Initial general examination","profile":"GENERAL_EXAM_2026_2","allowDeferred":true,"fields":[{"id":"bp_systolic","section":"vitals","label":"Systolic blood pressure","type":"number","unit":"mmHg","min":0,"max":400},{"id":"bp_diastolic","section":"vitals","label":"Diastolic blood pressure","type":"number","unit":"mmHg","min":0,"max":300},{"id":"pulse","section":"vitals","label":"Pulse","type":"number","unit":"beats/min","min":0,"max":400},{"id":"respiratory_rate","section":"vitals","label":"Respiratory rate","type":"number","unit":"breaths/min","min":0,"max":200},{"id":"temperature","section":"vitals","label":"Temperature","type":"number","unit":"\u00b0C","min":20,"max":50},{"id":"spo2","section":"vitals","label":"Oxygen saturation","type":"number","unit":"%","min":0,"max":100},{"id":"weight","section":"vitals","label":"Weight","type":"number","unit":"kg","min":0,"max":1000},{"id":"height","section":"vitals","label":"Height","type":"number","unit":"cm","min":0,"max":300},{"id":"general","label":"General appearance & condition","section":"examination","type":"assessment","required":true,"noteRequiredFor":["ABNORMAL"]},{"id":"cardiovascular","label":"Cardiovascular","section":"examination","type":"assessment","required":true,"noteRequiredFor":["ABNORMAL"]},{"id":"respiratory","label":"Respiratory","section":"examination","type":"assessment","required":true,"noteRequiredFor":["ABNORMAL"]},{"id":"abdomen","label":"Abdominal","section":"examination","type":"assessment","required":true,"noteRequiredFor":["ABNORMAL"]},{"id":"neurological","label":"Neurological","section":"examination","type":"assessment","required":true,"noteRequiredFor":["ABNORMAL"]},{"id":"pain_screen","section":"screening","label":"Pain screening","type":"select","options":[{"value":"NO_PAIN","label":"No pain"},{"value":"PAIN_PRESENT","label":"Pain present"},{"value":"UNABLE_TO_REPORT","label":"Unable to self-report"}],"required":true,"noteRequiredFor":["PAIN_PRESENT","UNABLE_TO_REPORT"]},{"id":"nutrition","label":"Nutrition screening","section":"screening","type":"select","options":[{"value":"NO_RISK","label":"No risk identified"},{"value":"RISK_IDENTIFIED","label":"Risk identified"},{"value":"NOT_APPLICABLE","label":"Not applicable"}],"required":true,"noteRequiredFor":["RISK_IDENTIFIED","NOT_APPLICABLE"]},{"id":"function","label":"Function, mobility & daily activities","section":"screening","type":"select","options":[{"value":"NO_RISK","label":"No risk identified"},{"value":"RISK_IDENTIFIED","label":"Risk identified"},{"value":"NOT_APPLICABLE","label":"Not applicable"}],"required":true,"noteRequiredFor":["RISK_IDENTIFIED","NOT_APPLICABLE"]},{"id":"falls","label":"Fall risk screening","section":"screening","type":"select","options":[{"value":"NO_RISK","label":"No risk identified"},{"value":"RISK_IDENTIFIED","label":"Risk identified"},{"value":"NOT_APPLICABLE","label":"Not applicable"}],"required":true,"noteRequiredFor":["RISK_IDENTIFIED","NOT_APPLICABLE"]},{"id":"psychological","label":"Psychological & emotional needs","section":"screening","type":"select","options":[{"value":"NO_RISK","label":"No risk identified"},{"value":"RISK_IDENTIFIED","label":"Risk identified"},{"value":"NOT_APPLICABLE","label":"Not applicable"}],"required":true,"noteRequiredFor":["RISK_IDENTIFIED","NOT_APPLICABLE"]},{"id":"social","label":"Social, economic & support needs","section":"screening","type":"select","options":[{"value":"NO_RISK","label":"No risk identified"},{"value":"RISK_IDENTIFIED","label":"Risk identified"},{"value":"NOT_APPLICABLE","label":"Not applicable"}],"required":true,"noteRequiredFor":["RISK_IDENTIFIED","NOT_APPLICABLE"]},{"id":"cultural","label":"Cultural, spiritual & communication needs","section":"screening","type":"select","options":[{"value":"NO_RISK","label":"No risk identified"},{"value":"RISK_IDENTIFIED","label":"Risk identified"},{"value":"NOT_APPLICABLE","label":"Not applicable"}],"required":true,"noteRequiredFor":["RISK_IDENTIFIED","NOT_APPLICABLE"]},{"id":"screening_tools","section":"screening","label":"Screening tool names, scores & referrals","type":"textarea"}]}~';
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
            seed_term('DIAGNOSIS','R51','Headache','ICD-10','HEAD','','ALL','');
            seed_term('DIAGNOSIS','G43.9','Migraine, unspecified','ICD-10','HEAD:BRAIN','headache','ALL','');
            seed_term('DIAGNOSIS','G43.0','Migraine without aura [common migraine]','ICD-10','HEAD','headache','ALL','');
            seed_term('DIAGNOSIS','G43.1','Migraine with aura [classical migraine]','ICD-10','HEAD','headache','ALL','');
            seed_term('DIAGNOSIS','G44.2','Tension-type headache','ICD-10','HEAD','','ALL','');
            seed_term('DIAGNOSIS','G44.0','Cluster headache syndrome','ICD-10','HEAD','','ALL','');
            seed_term('DIAGNOSIS','G44.3','Chronic post-traumatic headache','ICD-10','HEAD','','ALL','');
            seed_term('DIAGNOSIS','G44.4','Drug-induced headache, not elsewhere classified','ICD-10','HEAD','medication overuse','ALL','');
            seed_term('DIAGNOSIS','S06.0','Concussion','ICD-10','HEAD:BRAIN','head injury','ALL','');
            seed_term('DIAGNOSIS','S00.0','Superficial injury of scalp','ICD-10','HEAD','head injury bruise','ALL','');
            seed_term('DIAGNOSIS','S02.0','Fracture of vault of skull','ICD-10','HEAD','skull fracture frontal parietal','ALL','');
            seed_term('DIAGNOSIS','S02.1','Fracture of base of skull','ICD-10','HEAD','skull fracture occipital temporal sphenoid','ALL','');
            seed_term('DIAGNOSIS','S09.9','Unspecified injury of head','ICD-10','HEAD','head injury','ALL','');
            seed_term('DIAGNOSIS','S02.2','Fracture of nasal bones','ICD-10','FACE','broken nose','ALL','');
            seed_term('DIAGNOSIS','S02.3','Fracture of orbital floor','ICD-10','FACE','eye socket blow-out','ALL','');
            seed_term('DIAGNOSIS','S02.4','Fracture of malar and maxillary bones','ICD-10','FACE','cheekbone zygomatic zygoma','ALL','');
            seed_term('DIAGNOSIS','S02.7','Multiple fractures involving skull and facial bones','ICD-10','FACE:HEAD','','ALL','');
            seed_term('DIAGNOSIS','G50.0','Trigeminal neuralgia','ICD-10','FACE','face pain','ALL','');
            seed_term('DIAGNOSIS','G50.1','Atypical facial pain','ICD-10','FACE','','ALL','');
            seed_term('DIAGNOSIS','J01.9','Acute sinusitis, unspecified','ICD-10','FACE:NOSE','sinus','ALL','');
            seed_term('DIAGNOSIS','J32.9','Chronic sinusitis, unspecified','ICD-10','FACE:NOSE','sinus','ALL','');
            seed_term('DIAGNOSIS','K07.6','Temporomandibular joint disorders','ICD-10','JAW','tmj jaw pain clicking','ALL','');
            seed_term('DIAGNOSIS','S02.6','Fracture of mandible','ICD-10','JAW','broken jaw','ALL','');
            seed_term('DIAGNOSIS','S03.0','Dislocation of jaw','ICD-10','JAW','tmj','ALL','');
            seed_term('DIAGNOSIS','M54.2','Cervicalgia','ICD-10','NECK','neck pain','ALL','');
            seed_term('DIAGNOSIS','M47.8','Other spondylosis','ICD-10','NECK:UPPER_BACK:LOWER_BACK','cervical spondylosis lumbar spondylosis degenerative','ALL','');
            seed_term('DIAGNOSIS','M50.1','Cervical disc disorder with radiculopathy','ICD-10','NECK','slipped disc arm pain','ALL','');
            seed_term('DIAGNOSIS','M50.2','Other cervical disc displacement','ICD-10','NECK','slipped disc herniation','ALL','');
            seed_term('DIAGNOSIS','M50.3','Other cervical disc degeneration','ICD-10','NECK','','ALL','');
            seed_term('DIAGNOSIS','M53.0','Cervicocranial syndrome','ICD-10','NECK:HEAD','cervicogenic headache','ALL','');
            seed_term('DIAGNOSIS','M53.1','Cervicobrachial syndrome','ICD-10','NECK:SHOULDER','','ALL','');
            seed_term('DIAGNOSIS','M43.6','Torticollis','ICD-10','NECK','wry neck stiff neck','ALL','');
            seed_term('DIAGNOSIS','S13.4','Sprain and strain of cervical spine','ICD-10','NECK','whiplash','ALL','');
            seed_term('DIAGNOSIS','S12.0','Fracture of first cervical vertebra','ICD-10','NECK','atlas C1','ALL','');
            seed_term('DIAGNOSIS','S12.1','Fracture of second cervical vertebra','ICD-10','NECK','axis C2 odontoid','ALL','');
            seed_term('DIAGNOSIS','S12.2','Fracture of other specified cervical vertebra','ICD-10','NECK','C3 C4 C5 C6 C7','ALL','');
            seed_term('DIAGNOSIS','M75.0','Adhesive capsulitis of shoulder','ICD-10','SHOULDER','frozen shoulder','ALL','');
            seed_term('DIAGNOSIS','M75.1','Rotator cuff syndrome','ICD-10','SHOULDER','supraspinatus tear','ALL','');
            seed_term('DIAGNOSIS','M75.2','Bicipital tendinitis','ICD-10','SHOULDER','','ALL','');
            seed_term('DIAGNOSIS','M75.3','Calcific tendinitis of shoulder','ICD-10','SHOULDER','','ALL','');
            seed_term('DIAGNOSIS','M75.4','Impingement syndrome of shoulder','ICD-10','SHOULDER','','ALL','');
            seed_term('DIAGNOSIS','M75.5','Bursitis of shoulder','ICD-10','SHOULDER','','ALL','');
            seed_term('DIAGNOSIS','M19.0','Primary arthrosis of other joints','ICD-10','SHOULDER:ELBOW:WRIST:ANKLE','osteoarthritis','ALL','');
            seed_term('DIAGNOSIS','S42.0','Fracture of clavicle','ICD-10','SHOULDER','collarbone','ALL','');
            seed_term('DIAGNOSIS','S42.1','Fracture of scapula','ICD-10','SHOULDER','shoulder blade','ALL','');
            seed_term('DIAGNOSIS','S42.2','Fracture of upper end of humerus','ICD-10','SHOULDER','proximal humerus surgical neck','ALL','');
            seed_term('DIAGNOSIS','S43.0','Dislocation of shoulder joint','ICD-10','SHOULDER','','ALL','');
            seed_term('DIAGNOSIS','S43.1','Dislocation of acromioclavicular joint','ICD-10','SHOULDER','AC joint','ALL','');
            seed_term('DIAGNOSIS','S46.0','Injury of muscle(s) and tendon(s) of the rotator cuff of shoulder','ICD-10','SHOULDER','tear','ALL','');
            seed_term('DIAGNOSIS','M24.4','Recurrent dislocation and subluxation of joint','ICD-10','SHOULDER:KNEE','instability','ALL','');
            seed_term('DIAGNOSIS','S42.3','Fracture of shaft of humerus','ICD-10','UPPER_ARM','','ALL','');
            seed_term('DIAGNOSIS','S46.1','Injury of muscle and tendon of long head of biceps','ICD-10','UPPER_ARM','biceps rupture','ALL','');
            seed_term('DIAGNOSIS','M79.6','Pain in limb','ICD-10','UPPER_ARM:FOREARM:THIGH:LOWER_LEG:HAND:FOOT','arm pain leg pain','ALL','');
            seed_term('DIAGNOSIS','M77.1','Lateral epicondylitis','ICD-10','ELBOW','tennis elbow','ALL','');
            seed_term('DIAGNOSIS','M77.0','Medial epicondylitis','ICD-10','ELBOW','golfer''s elbow','ALL','');
            seed_term('DIAGNOSIS','M70.2','Olecranon bursitis','ICD-10','ELBOW','','ALL','');
            seed_term('DIAGNOSIS','G56.2','Lesion of ulnar nerve','ICD-10','ELBOW:HAND','cubital tunnel','ALL','');
            seed_term('DIAGNOSIS','S42.4','Fracture of lower end of humerus','ICD-10','ELBOW','supracondylar','ALL','');
            seed_term('DIAGNOSIS','S52.0','Fracture of upper end of ulna','ICD-10','ELBOW','olecranon','ALL','');
            seed_term('DIAGNOSIS','S52.1','Fracture of upper end of radius','ICD-10','ELBOW','radial head','ALL','');
            seed_term('DIAGNOSIS','S53.1','Dislocation of elbow, unspecified','ICD-10','ELBOW','','ALL','');
            seed_term('DIAGNOSIS','S53.4','Sprain and strain of elbow','ICD-10','ELBOW','','ALL','');
            seed_term('DIAGNOSIS','S52.2','Fracture of shaft of ulna','ICD-10','FOREARM','','ALL','');
            seed_term('DIAGNOSIS','S52.3','Fracture of shaft of radius','ICD-10','FOREARM','','ALL','');
            seed_term('DIAGNOSIS','S52.4','Fracture of shafts of both ulna and radius','ICD-10','FOREARM','','ALL','');
            seed_term('DIAGNOSIS','G56.0','Carpal tunnel syndrome','ICD-10','WRIST:HAND','median nerve numb fingers','ALL','');
            seed_term('DIAGNOSIS','M65.4','Radial styloid tenosynovitis [de Quervain]','ICD-10','WRIST','','ALL','');
            seed_term('DIAGNOSIS','M67.4','Ganglion','ICD-10','WRIST:HAND:FOOT','cyst','ALL','');
            seed_term('DIAGNOSIS','S52.5','Fracture of lower end of radius','ICD-10','WRIST','colles smith distal radius','ALL','');
            seed_term('DIAGNOSIS','S52.6','Fracture of lower end of both ulna and radius','ICD-10','WRIST','','ALL','');
            seed_term('DIAGNOSIS','S62.0','Fracture of navicular [scaphoid] bone of hand','ICD-10','WRIST','','ALL','');
            seed_term('DIAGNOSIS','S62.1','Fracture of other carpal bone(s)','ICD-10','WRIST','','ALL','');
            seed_term('DIAGNOSIS','S63.5','Sprain and strain of wrist','ICD-10','WRIST','','ALL','');
            seed_term('DIAGNOSIS','M18.9','Arthrosis of first carpometacarpal joint, unspecified','ICD-10','HAND','thumb base osteoarthritis','ALL','');
            seed_term('DIAGNOSIS','M65.3','Trigger finger','ICD-10','HAND','','ALL','');
            seed_term('DIAGNOSIS','M72.0','Palmar fascial fibromatosis [Dupuytren]','ICD-10','HAND','','ALL','');
            seed_term('DIAGNOSIS','M06.9','Rheumatoid arthritis, unspecified','ICD-10','HAND:WRIST:FOOT:KNEE','','ALL','');
            seed_term('DIAGNOSIS','M15.1','Heberden''s nodes (with arthropathy)','ICD-10','HAND','finger osteoarthritis','ALL','');
            seed_term('DIAGNOSIS','S62.2','Fracture of first metacarpal bone','ICD-10','HAND','bennett thumb','ALL','');
            seed_term('DIAGNOSIS','S62.3','Fracture of other metacarpal bone','ICD-10','HAND','boxer','ALL','');
            seed_term('DIAGNOSIS','S62.5','Fracture of thumb','ICD-10','HAND','','ALL','');
            seed_term('DIAGNOSIS','S62.6','Fracture of other finger','ICD-10','HAND','phalanx','ALL','');
            seed_term('DIAGNOSIS','S63.1','Dislocation of finger','ICD-10','HAND','','ALL','');
            seed_term('DIAGNOSIS','S63.6','Sprain and strain of finger(s)','ICD-10','HAND','','ALL','');
            seed_term('DIAGNOSIS','R07.4','Chest pain, unspecified','ICD-10','CHEST','','ALL','');
            seed_term('DIAGNOSIS','R07.3','Other chest pain','ICD-10','CHEST','chest wall pain','ALL','');
            seed_term('DIAGNOSIS','M94.0','Chondrocostal junction syndrome [Tietze]','ICD-10','CHEST','costochondritis','ALL','');
            seed_term('DIAGNOSIS','S20.2','Contusion of thorax','ICD-10','CHEST','bruised ribs','ALL','');
            seed_term('DIAGNOSIS','S22.2','Fracture of sternum','ICD-10','CHEST','breastbone','ALL','');
            seed_term('DIAGNOSIS','S22.3','Fracture of rib','ICD-10','CHEST','','ALL','');
            seed_term('DIAGNOSIS','S22.4','Multiple fractures of ribs','ICD-10','CHEST','','ALL','');
            seed_term('DIAGNOSIS','S22.5','Flail chest','ICD-10','CHEST','','ALL','');
            seed_term('DIAGNOSIS','M54.6','Pain in thoracic spine','ICD-10','UPPER_BACK','upper back pain mid back pain','ALL','');
            seed_term('DIAGNOSIS','M40.2','Other and unspecified kyphosis','ICD-10','UPPER_BACK','hunchback','ALL','');
            seed_term('DIAGNOSIS','M41.9','Scoliosis, unspecified','ICD-10','UPPER_BACK:LOWER_BACK','','ALL','');
            seed_term('DIAGNOSIS','M42.0','Juvenile osteochondrosis of spine','ICD-10','UPPER_BACK','scheuermann','ALL','');
            seed_term('DIAGNOSIS','M45','Ankylosing spondylitis','ICD-10','UPPER_BACK:LOWER_BACK:SACRUM','','ALL','');
            seed_term('DIAGNOSIS','M51.2','Other specified intervertebral disc displacement','ICD-10','UPPER_BACK:LOWER_BACK','slipped disc herniation lumbago','ALL','');
            seed_term('DIAGNOSIS','S22.0','Fracture of thoracic vertebra','ICD-10','UPPER_BACK','compression fracture','ALL','');
            seed_term('DIAGNOSIS','S23.3','Sprain and strain of thoracic spine','ICD-10','UPPER_BACK','','ALL','');
            seed_term('DIAGNOSIS','M80.9','Unspecified osteoporosis with pathological fracture','ICD-10','UPPER_BACK:LOWER_BACK:HIP:WRIST','fragility fracture','ALL','');
            seed_term('DIAGNOSIS','M81.9','Osteoporosis, unspecified','ICD-10','UPPER_BACK:LOWER_BACK:HIP','','ALL','');
            seed_term('DIAGNOSIS','M54.5','Low back pain','ICD-10','LOWER_BACK','backache lumbago back pain','ALL','');
            seed_term('DIAGNOSIS','M54.4','Lumbago with sciatica','ICD-10','LOWER_BACK','back pain leg pain','ALL','');
            seed_term('DIAGNOSIS','M54.3','Sciatica','ICD-10','LOWER_BACK:THIGH','leg pain','ALL','');
            seed_term('DIAGNOSIS','M54.1','Radiculopathy','ICD-10','LOWER_BACK:NECK','pinched nerve','ALL','');
            seed_term('DIAGNOSIS','M51.1','Lumbar and other intervertebral disc disorders with radiculopathy','ICD-10','LOWER_BACK','slipped disc sciatica herniation','ALL','');
            seed_term('DIAGNOSIS','M51.3','Other specified intervertebral disc degeneration','ICD-10','LOWER_BACK:UPPER_BACK','','ALL','');
            seed_term('DIAGNOSIS','M48.0','Spinal stenosis','ICD-10','LOWER_BACK:NECK','','ALL','');
            seed_term('DIAGNOSIS','M43.1','Spondylolisthesis','ICD-10','LOWER_BACK','','ALL','');
            seed_term('DIAGNOSIS','M43.0','Spondylolysis','ICD-10','LOWER_BACK','','ALL','');
            seed_term('DIAGNOSIS','M54.9','Dorsalgia, unspecified','ICD-10','LOWER_BACK:UPPER_BACK','back pain','ALL','');
            seed_term('DIAGNOSIS','S32.0','Fracture of lumbar vertebra','ICD-10','LOWER_BACK','compression fracture','ALL','');
            seed_term('DIAGNOSIS','S33.5','Sprain and strain of lumbar spine','ICD-10','LOWER_BACK','back strain','ALL','');
            seed_term('DIAGNOSIS','S32.3','Fracture of ilium','ICD-10','PELVIS','','ALL','');
            seed_term('DIAGNOSIS','S32.4','Fracture of acetabulum','ICD-10','PELVIS:HIP','','ALL','');
            seed_term('DIAGNOSIS','S32.5','Fracture of pubis','ICD-10','PELVIS','pubic ramus','ALL','');
            seed_term('DIAGNOSIS','S32.8','Fracture of other and unspecified parts of lumbar spine and pelvis','ICD-10','PELVIS','ischium','ALL','');
            seed_term('DIAGNOSIS','M46.1','Sacroiliitis, not elsewhere classified','ICD-10','PELVIS:SACRUM','si joint','ALL','');
            seed_term('DIAGNOSIS','R10.2','Pelvic and perineal pain','ICD-10','PELVIS','','ALL','');
            seed_term('DIAGNOSIS','M53.3','Sacrococcygeal disorders, not elsewhere classified','ICD-10','SACRUM','coccydynia tailbone pain','ALL','');
            seed_term('DIAGNOSIS','S32.1','Fracture of sacrum','ICD-10','SACRUM','','ALL','');
            seed_term('DIAGNOSIS','S32.2','Fracture of coccyx','ICD-10','SACRUM','tailbone','ALL','');
            seed_term('DIAGNOSIS','S33.6','Sprain and strain of sacroiliac joint','ICD-10','SACRUM:PELVIS','','ALL','');
            seed_term('DIAGNOSIS','M16.9','Coxarthrosis, unspecified','ICD-10','HIP','hip osteoarthritis arthritis','ALL','');
            seed_term('DIAGNOSIS','M16.1','Other primary coxarthrosis','ICD-10','HIP','hip osteoarthritis','ALL','');
            seed_term('DIAGNOSIS','M70.6','Trochanteric bursitis','ICD-10','HIP','','ALL','');
            seed_term('DIAGNOSIS','M87.0','Idiopathic aseptic necrosis of bone','ICD-10','HIP','avascular necrosis femoral head','ALL','');
            seed_term('DIAGNOSIS','M25.5','Pain in joint','ICD-10','HIP:KNEE:SHOULDER:ELBOW:WRIST:ANKLE','arthralgia','ALL','');
            seed_term('DIAGNOSIS','S72.0','Fracture of neck of femur','ICD-10','HIP','hip fracture','ALL','');
            seed_term('DIAGNOSIS','S72.1','Pertrochanteric fracture','ICD-10','HIP','hip fracture intertrochanteric','ALL','');
            seed_term('DIAGNOSIS','S72.2','Subtrochanteric fracture','ICD-10','HIP','hip fracture','ALL','');
            seed_term('DIAGNOSIS','S73.0','Dislocation of hip','ICD-10','HIP','','ALL','');
            seed_term('DIAGNOSIS','Q65.8','Other congenital deformities of hip','ICD-10','HIP','dysplasia','ALL','');
            seed_term('DIAGNOSIS','M91.1','Juvenile osteochondrosis of head of femur [Legg-Calve-Perthes]','ICD-10','HIP','','ALL','');
            seed_term('DIAGNOSIS','M93.0','Slipped upper femoral epiphysis (nontraumatic)','ICD-10','HIP','scfe','ALL','');
            seed_term('DIAGNOSIS','S72.3','Fracture of shaft of femur','ICD-10','THIGH','','ALL','');
            seed_term('DIAGNOSIS','S76.1','Injury of quadriceps muscle and tendon','ICD-10','THIGH','strain','ALL','');
            seed_term('DIAGNOSIS','S76.3','Injury of muscle and tendon of the posterior muscle group at thigh level','ICD-10','THIGH','hamstring strain','ALL','');
            seed_term('DIAGNOSIS','G57.1','Meralgia paraesthetica','ICD-10','THIGH','numb thigh','ALL','');
            seed_term('DIAGNOSIS','M17.9','Gonarthrosis, unspecified','ICD-10','KNEE','knee osteoarthritis arthritis','ALL','');
            seed_term('DIAGNOSIS','M17.1','Other primary gonarthrosis','ICD-10','KNEE','knee osteoarthritis','ALL','');
            seed_term('DIAGNOSIS','M22.2','Patellofemoral disorders','ICD-10','KNEE','runner''s knee anterior knee pain','ALL','');
            seed_term('DIAGNOSIS','M22.4','Chondromalacia patellae','ICD-10','KNEE','','ALL','');
            seed_term('DIAGNOSIS','M23.2','Derangement of meniscus due to old tear or injury','ICD-10','KNEE','','ALL','');
            seed_term('DIAGNOSIS','M70.4','Prepatellar bursitis','ICD-10','KNEE','housemaid''s knee','ALL','');
            seed_term('DIAGNOSIS','M76.5','Patellar tendinitis','ICD-10','KNEE','jumper''s knee','ALL','');
            seed_term('DIAGNOSIS','M71.2','Synovial cyst of popliteal space [Baker]','ICD-10','KNEE','','ALL','');
            seed_term('DIAGNOSIS','M92.5','Juvenile osteochondrosis of tibia and fibula','ICD-10','KNEE','osgood-schlatter','ALL','');
            seed_term('DIAGNOSIS','M25.4','Effusion of joint','ICD-10','KNEE:ANKLE:ELBOW','swelling','ALL','');
            seed_term('DIAGNOSIS','S72.4','Fracture of lower end of femur','ICD-10','KNEE','supracondylar','ALL','');
            seed_term('DIAGNOSIS','S82.0','Fracture of patella','ICD-10','KNEE','kneecap','ALL','');
            seed_term('DIAGNOSIS','S82.1','Fracture of upper end of tibia','ICD-10','KNEE','tibial plateau','ALL','');
            seed_term('DIAGNOSIS','S83.0','Dislocation of patella','ICD-10','KNEE','','ALL','');
            seed_term('DIAGNOSIS','S83.2','Tear of meniscus, current','ICD-10','KNEE','','ALL','');
            seed_term('DIAGNOSIS','S83.4','Sprain and strain involving (fibular)(tibial) collateral ligament of knee','ICD-10','KNEE','mcl lcl','ALL','');
            seed_term('DIAGNOSIS','S83.5','Sprain and strain involving (anterior)(posterior) cruciate ligament of knee','ICD-10','KNEE','acl pcl','ALL','');
            seed_term('DIAGNOSIS','S82.2','Fracture of shaft of tibia','ICD-10','LOWER_LEG','shin','ALL','');
            seed_term('DIAGNOSIS','S82.4','Fracture of fibula alone','ICD-10','LOWER_LEG','','ALL','');
            seed_term('DIAGNOSIS','M76.8','Other enthesopathies of lower limb, excluding foot','ICD-10','LOWER_LEG','shin splints','ALL','');
            seed_term('DIAGNOSIS','M84.3','Stress fracture, not elsewhere classified','ICD-10','LOWER_LEG:FOOT','','ALL','');
            seed_term('DIAGNOSIS','S86.1','Injury of other muscle(s) and tendon(s) of posterior muscle group at lower leg level','ICD-10','LOWER_LEG','calf strain','ALL','');
            seed_term('DIAGNOSIS','M86.9','Osteomyelitis, unspecified','ICD-10','LOWER_LEG:THIGH:FOOT','bone infection','ALL','');
            seed_term('DIAGNOSIS','S93.4','Sprain and strain of ankle','ICD-10','ANKLE','twisted ankle','ALL','');
            seed_term('DIAGNOSIS','S82.3','Fracture of lower end of tibia','ICD-10','ANKLE','pilon','ALL','');
            seed_term('DIAGNOSIS','S82.5','Fracture of medial malleolus','ICD-10','ANKLE','','ALL','');
            seed_term('DIAGNOSIS','S82.6','Fracture of lateral malleolus','ICD-10','ANKLE','','ALL','');
            seed_term('DIAGNOSIS','S92.1','Fracture of talus','ICD-10','ANKLE','','ALL','');
            seed_term('DIAGNOSIS','S93.0','Dislocation of ankle joint','ICD-10','ANKLE','','ALL','');
            seed_term('DIAGNOSIS','M76.6','Achilles tendinitis','ICD-10','ANKLE:FOOT','heel pain','ALL','');
            seed_term('DIAGNOSIS','S86.0','Injury of Achilles tendon','ICD-10','ANKLE','rupture','ALL','');
            seed_term('DIAGNOSIS','M72.2','Plantar fascial fibromatosis','ICD-10','FOOT','plantar fasciitis heel pain','ALL','');
            seed_term('DIAGNOSIS','M77.3','Calcaneal spur','ICD-10','FOOT','heel spur heel pain','ALL','');
            seed_term('DIAGNOSIS','M77.4','Metatarsalgia','ICD-10','FOOT','forefoot pain','ALL','');
            seed_term('DIAGNOSIS','M20.1','Hallux valgus (acquired)','ICD-10','FOOT','bunion','ALL','');
            seed_term('DIAGNOSIS','M20.2','Hallux rigidus','ICD-10','FOOT','stiff big toe','ALL','');
            seed_term('DIAGNOSIS','M20.4','Other hammer toe(s) (acquired)','ICD-10','FOOT','','ALL','');
            seed_term('DIAGNOSIS','M21.4','Flat foot [pes planus] (acquired)','ICD-10','FOOT','','ALL','');
            seed_term('DIAGNOSIS','M10.9','Gout, unspecified','ICD-10','FOOT:ANKLE:KNEE','big toe','ALL','');
            seed_term('DIAGNOSIS','G57.6','Lesion of plantar nerve','ICD-10','FOOT','morton''s neuroma metatarsalgia','ALL','');
            seed_term('DIAGNOSIS','S92.0','Fracture of calcaneus','ICD-10','FOOT','heel bone','ALL','');
            seed_term('DIAGNOSIS','S92.2','Fracture of other tarsal bone(s)','ICD-10','FOOT','navicular cuboid cuneiform','ALL','');
            seed_term('DIAGNOSIS','S92.3','Fracture of metatarsal bone','ICD-10','FOOT','','ALL','');
            seed_term('DIAGNOSIS','S92.4','Fracture of great toe','ICD-10','FOOT','','ALL','');
            seed_term('DIAGNOSIS','S92.5','Fracture of other toe','ICD-10','FOOT','','ALL','');
            seed_term('DIAGNOSIS','S93.6','Sprain and strain of other and unspecified parts of foot','ICD-10','FOOT','','ALL','');
            seed_term('DIAGNOSIS','I20.9','Angina pectoris, unspecified','ICD-10','HEART','','ALL','');
            seed_term('DIAGNOSIS','I21.9','Acute myocardial infarction, unspecified','ICD-10','HEART','','ALL','');
            seed_term('DIAGNOSIS','I25.1','Atherosclerotic heart disease','ICD-10','HEART','CAD coronary artery disease','ALL','');
            seed_term('DIAGNOSIS','I30.9','Acute pericarditis, unspecified','ICD-10','HEART','','ALL','');
            seed_term('DIAGNOSIS','I33.0','Acute and subacute infective endocarditis','ICD-10','HEART','','ALL','');
            seed_term('DIAGNOSIS','I34.0','Mitral (valve) insufficiency','ICD-10','HEART','','ALL','');
            seed_term('DIAGNOSIS','I35.0','Aortic (valve) stenosis','ICD-10','HEART','','ALL','');
            seed_term('DIAGNOSIS','I42.9','Cardiomyopathy, unspecified','ICD-10','HEART','','ALL','');
            seed_term('DIAGNOSIS','I47.1','Supraventricular tachycardia','ICD-10','HEART','','ALL','');
            seed_term('DIAGNOSIS','I48.9','Atrial fibrillation and atrial flutter, unspecified','ICD-10','HEART','','ALL','');
            seed_term('DIAGNOSIS','I49.9','Cardiac arrhythmia, unspecified','ICD-10','HEART','','ALL','');
            seed_term('DIAGNOSIS','I50.9','Heart failure, unspecified','ICD-10','HEART','heart failure cardiac failure','ALL','');
            seed_term('DIAGNOSIS','I70.0','Atherosclerosis of aorta','ICD-10','AORTA','','ALL','');
            seed_term('DIAGNOSIS','I71.0','Dissection of aorta [any part]','ICD-10','AORTA','','ALL','');
            seed_term('DIAGNOSIS','I71.2','Thoracic aortic aneurysm, without mention of rupture','ICD-10','AORTA','','ALL','');
            seed_term('DIAGNOSIS','I71.4','Abdominal aortic aneurysm, without mention of rupture','ICD-10','AORTA','','ALL','');
            seed_term('DIAGNOSIS','I82.2','Embolism and thrombosis of vena cava','ICD-10','VENA_CAVA','','ALL','');
            seed_term('DIAGNOSIS','I87.1','Compression of vein','ICD-10','VENA_CAVA','','ALL','');
            seed_term('DIAGNOSIS','G40.9','Epilepsy, unspecified','ICD-10','BRAIN','','ALL','');
            seed_term('DIAGNOSIS','I63.9','Cerebral infarction, unspecified','ICD-10','BRAIN','ischaemic ischemic stroke','ALL','');
            seed_term('DIAGNOSIS','I61.9','Intracerebral haemorrhage, unspecified','ICD-10','BRAIN','hemorrhagic haemorrhagic stroke','ALL','');
            seed_term('DIAGNOSIS','G20','Parkinson disease','ICD-10','BRAIN','parkinson parkinsons','ALL','');
            seed_term('DIAGNOSIS','G91.9','Hydrocephalus, unspecified','ICD-10','BRAIN','','ALL','');
            seed_term('DIAGNOSIS','G93.9','Disorder of brain, unspecified','ICD-10','BRAIN','','ALL','');
            seed_term('DIAGNOSIS','H60.9','Otitis externa, unspecified','ICD-10','EAR','','ALL','');
            seed_term('DIAGNOSIS','H65.9','Nonsuppurative otitis media, unspecified','ICD-10','EAR','','ALL','');
            seed_term('DIAGNOSIS','H66.9','Otitis media, unspecified','ICD-10','EAR','','ALL','');
            seed_term('DIAGNOSIS','H61.2','Impacted cerumen','ICD-10','EAR','earwax wax impaction','ALL','');
            seed_term('DIAGNOSIS','H91.9','Hearing loss, unspecified','ICD-10','EAR','','ALL','');
            seed_term('DIAGNOSIS','H93.1','Tinnitus','ICD-10','EAR','','ALL','');
            seed_term('DIAGNOSIS','H92.0','Otalgia','ICD-10','EAR','','ALL','');
            seed_term('DIAGNOSIS','H10.9','Conjunctivitis, unspecified','ICD-10','EYE','','ALL','');
            seed_term('DIAGNOSIS','H16.9','Keratitis, unspecified','ICD-10','EYE','','ALL','');
            seed_term('DIAGNOSIS','H20.9','Iridocyclitis, unspecified','ICD-10','EYE','','ALL','');
            seed_term('DIAGNOSIS','H26.9','Cataract, unspecified','ICD-10','EYE','','ALL','');
            seed_term('DIAGNOSIS','H40.9','Glaucoma, unspecified','ICD-10','EYE','','ALL','');
            seed_term('DIAGNOSIS','H04.1','Other disorders of lacrimal gland','ICD-10','EYE','dry eye','ALL','');
            seed_term('DIAGNOSIS','H52.1','Myopia','ICD-10','EYE','','ALL','');
            seed_term('DIAGNOSIS','H53.9','Visual disturbance, unspecified','ICD-10','EYE','','ALL','');
            seed_term('DIAGNOSIS','J00','Acute nasopharyngitis [common cold]','ICD-10','NOSE','','ALL','');
            seed_term('DIAGNOSIS','J30.4','Allergic rhinitis, unspecified','ICD-10','NOSE','','ALL','');
            seed_term('DIAGNOSIS','J31.0','Chronic rhinitis','ICD-10','NOSE','','ALL','');
            seed_term('DIAGNOSIS','J34.2','Deviated nasal septum','ICD-10','NOSE','','ALL','');
            seed_term('DIAGNOSIS','J33.9','Nasal polyp, unspecified','ICD-10','NOSE','','ALL','');
            seed_term('DIAGNOSIS','J02.9','Acute pharyngitis, unspecified','ICD-10','THROAT','','ALL','');
            seed_term('DIAGNOSIS','J03.9','Acute tonsillitis, unspecified','ICD-10','THROAT','','ALL','');
            seed_term('DIAGNOSIS','J04.0','Acute laryngitis','ICD-10','THROAT','','ALL','');
            seed_term('DIAGNOSIS','J37.0','Chronic laryngitis','ICD-10','THROAT','','ALL','');
            seed_term('DIAGNOSIS','J35.1','Hypertrophy of tonsils','ICD-10','THROAT','','ALL','');
            seed_term('DIAGNOSIS','R49.0','Dysphonia','ICD-10','THROAT','','ALL','');
            seed_term('DIAGNOSIS','R13','Dysphagia','ICD-10','THROAT','','ALL','');
            seed_term('DIAGNOSIS','E03.9','Hypothyroidism, unspecified','ICD-10','THYROID','','ALL','');
            seed_term('DIAGNOSIS','E05.9','Thyrotoxicosis, unspecified','ICD-10','THYROID','','ALL','');
            seed_term('DIAGNOSIS','E04.1','Nontoxic single thyroid nodule','ICD-10','THYROID','','ALL','');
            seed_term('DIAGNOSIS','E04.2','Nontoxic multinodular goitre','ICD-10','THYROID','','ALL','');
            seed_term('DIAGNOSIS','E06.3','Autoimmune thyroiditis','ICD-10','THYROID','','ALL','');
            seed_term('DIAGNOSIS','E07.9','Disorder of thyroid, unspecified','ICD-10','THYROID','','ALL','');
            seed_term('DIAGNOSIS','J04.1','Acute tracheitis','ICD-10','AIRWAY','','ALL','');
            seed_term('DIAGNOSIS','J20.9','Acute bronchitis, unspecified','ICD-10','AIRWAY','','ALL','');
            seed_term('DIAGNOSIS','J41.0','Simple chronic bronchitis','ICD-10','AIRWAY','','ALL','');
            seed_term('DIAGNOSIS','J42','Unspecified chronic bronchitis','ICD-10','AIRWAY','','ALL','');
            seed_term('DIAGNOSIS','J18.9','Pneumonia, unspecified','ICD-10','LUNG','','ALL','');
            seed_term('DIAGNOSIS','J45.9','Asthma, unspecified','ICD-10','LUNG','','ALL','');
            seed_term('DIAGNOSIS','J44.9','Chronic obstructive pulmonary disease, unspecified','ICD-10','LUNG','COPD','ALL','');
            seed_term('DIAGNOSIS','J47','Bronchiectasis','ICD-10','LUNG','','ALL','');
            seed_term('DIAGNOSIS','J90','Pleural effusion, not elsewhere classified','ICD-10','LUNG','','ALL','');
            seed_term('DIAGNOSIS','I26.9','Pulmonary embolism without mention of acute cor pulmonale','ICD-10','LUNG','','ALL','');
            seed_term('DIAGNOSIS','J84.9','Interstitial pulmonary disease, unspecified','ICD-10','LUNG','','ALL','');
            seed_term('DIAGNOSIS','J93.9','Pneumothorax, unspecified','ICD-10','LUNG','','ALL','');
            seed_term('DIAGNOSIS','K20','Oesophagitis','ICD-10','ESOPHAGUS','','ALL','');
            seed_term('DIAGNOSIS','K21.0','Gastro-oesophageal reflux disease with oesophagitis','ICD-10','ESOPHAGUS','GERD GORD acid reflux','ALL','');
            seed_term('DIAGNOSIS','K21.9','Gastro-oesophageal reflux disease without oesophagitis','ICD-10','ESOPHAGUS','GERD GORD acid reflux','ALL','');
            seed_term('DIAGNOSIS','K22.0','Achalasia of cardia','ICD-10','ESOPHAGUS','','ALL','');
            seed_term('DIAGNOSIS','K22.2','Oesophageal obstruction','ICD-10','ESOPHAGUS','','ALL','');
            seed_term('DIAGNOSIS','K22.9','Disease of oesophagus, unspecified','ICD-10','ESOPHAGUS','','ALL','');
            seed_term('DIAGNOSIS','K25.9','Gastric ulcer: Unspecified as acute or chronic, without haemorrhage or perforation','ICD-10','STOMACH','','ALL','');
            seed_term('DIAGNOSIS','K29.7','Gastritis, unspecified','ICD-10','STOMACH','','ALL','');
            seed_term('DIAGNOSIS','K30','Functional dyspepsia','ICD-10','STOMACH','','ALL','');
            seed_term('DIAGNOSIS','K31.9','Disease of stomach and duodenum, unspecified','ICD-10','STOMACH','','ALL','');
            seed_term('DIAGNOSIS','K85.9','Acute pancreatitis, unspecified','ICD-10','PANCREAS','','ALL','');
            seed_term('DIAGNOSIS','K86.0','Alcohol-induced chronic pancreatitis','ICD-10','PANCREAS','','ALL','');
            seed_term('DIAGNOSIS','K86.1','Other chronic pancreatitis','ICD-10','PANCREAS','','ALL','');
            seed_term('DIAGNOSIS','K86.2','Cyst of pancreas','ICD-10','PANCREAS','','ALL','');
            seed_term('DIAGNOSIS','K86.9','Disease of pancreas, unspecified','ICD-10','PANCREAS','','ALL','');
            seed_term('DIAGNOSIS','K76.0','Fatty (change of) liver, not elsewhere classified','ICD-10','LIVER','fatty liver','ALL','');
            seed_term('DIAGNOSIS','K70.0','Alcoholic fatty liver','ICD-10','LIVER','','ALL','');
            seed_term('DIAGNOSIS','K74.6','Other and unspecified cirrhosis of liver','ICD-10','LIVER','','ALL','');
            seed_term('DIAGNOSIS','K75.9','Inflammatory liver disease, unspecified','ICD-10','LIVER','','ALL','');
            seed_term('DIAGNOSIS','B18.1','Chronic viral hepatitis B without delta-agent','ICD-10','LIVER','','ALL','');
            seed_term('DIAGNOSIS','B18.2','Chronic viral hepatitis C','ICD-10','LIVER','','ALL','');
            seed_term('DIAGNOSIS','K80.2','Calculus of gallbladder without cholecystitis','ICD-10','GALLBLADDER','','ALL','');
            seed_term('DIAGNOSIS','K81.0','Acute cholecystitis','ICD-10','GALLBLADDER','','ALL','');
            seed_term('DIAGNOSIS','K81.1','Chronic cholecystitis','ICD-10','GALLBLADDER','','ALL','');
            seed_term('DIAGNOSIS','K82.9','Disease of gallbladder, unspecified','ICD-10','GALLBLADDER','','ALL','');
            seed_term('DIAGNOSIS','D73.0','Hyposplenism','ICD-10','SPLEEN','','ALL','');
            seed_term('DIAGNOSIS','D73.1','Hypersplenism','ICD-10','SPLEEN','','ALL','');
            seed_term('DIAGNOSIS','D73.3','Abscess of spleen','ICD-10','SPLEEN','','ALL','');
            seed_term('DIAGNOSIS','D73.4','Cyst of spleen','ICD-10','SPLEEN','','ALL','');
            seed_term('DIAGNOSIS','D73.5','Infarction of spleen','ICD-10','SPLEEN','','ALL','');
            seed_term('DIAGNOSIS','R16.1','Splenomegaly, not elsewhere classified','ICD-10','SPLEEN','','ALL','');
            seed_term('DIAGNOSIS','K50.0','Crohn disease of small intestine','ICD-10','SMALL_INTESTINE','','ALL','');
            seed_term('DIAGNOSIS','K52.9','Noninfective gastroenteritis and colitis, unspecified','ICD-10','SMALL_INTESTINE:COLON','','ALL','');
            seed_term('DIAGNOSIS','K56.6','Other and unspecified intestinal obstruction','ICD-10','SMALL_INTESTINE:COLON','','ALL','');
            seed_term('DIAGNOSIS','K90.0','Coeliac disease','ICD-10','SMALL_INTESTINE','celiac coeliac','ALL','');
            seed_term('DIAGNOSIS','K90.9','Intestinal malabsorption, unspecified','ICD-10','SMALL_INTESTINE','','ALL','');
            seed_term('DIAGNOSIS','K35.8','Acute appendicitis, other and unspecified','ICD-10','COLON','','ALL','');
            seed_term('DIAGNOSIS','K51.9','Ulcerative colitis, unspecified','ICD-10','COLON','','ALL','');
            seed_term('DIAGNOSIS','K57.3','Diverticular disease of large intestine without perforation or abscess','ICD-10','COLON','','ALL','');
            seed_term('DIAGNOSIS','K58.8','Other and unspecified irritable bowel syndrome','ICD-10','COLON','','ALL','');
            seed_term('DIAGNOSIS','K59.0','Constipation','ICD-10','COLON','','ALL','');
            seed_term('DIAGNOSIS','N10','Acute tubulo-interstitial nephritis','ICD-10','KIDNEY','pyelonephritis kidney infection','ALL','');
            seed_term('DIAGNOSIS','N11.9','Chronic tubulo-interstitial nephritis, unspecified','ICD-10','KIDNEY','','ALL','');
            seed_term('DIAGNOSIS','N17.9','Acute renal failure, unspecified','ICD-10','KIDNEY','','ALL','');
            seed_term('DIAGNOSIS','N18.9','Chronic kidney disease, unspecified','ICD-10','KIDNEY','CKD chronic kidney disease','ALL','');
            seed_term('DIAGNOSIS','N20.0','Calculus of kidney','ICD-10','KIDNEY','kidney stone nephrolithiasis','ALL','');
            seed_term('DIAGNOSIS','N28.1','Cyst of kidney','ICD-10','KIDNEY','','ALL','');
            seed_term('DIAGNOSIS','N13.3','Other and unspecified hydronephrosis','ICD-10','KIDNEY','','ALL','');
            seed_term('DIAGNOSIS','E27.1','Primary adrenocortical insufficiency','ICD-10','ADRENAL','','ALL','');
            seed_term('DIAGNOSIS','E27.4','Other and unspecified adrenocortical insufficiency','ICD-10','ADRENAL','','ALL','');
            seed_term('DIAGNOSIS','E27.9','Disorder of adrenal gland, unspecified','ICD-10','ADRENAL','','ALL','');
            seed_term('DIAGNOSIS','E26.9','Hyperaldosteronism, unspecified','ICD-10','ADRENAL','','ALL','');
            seed_term('DIAGNOSIS','N20.1','Calculus of ureter','ICD-10','URETER','ureteric stone ureter stone','ALL','');
            seed_term('DIAGNOSIS','N13.1','Hydronephrosis with ureteral stricture, not elsewhere classified','ICD-10','URETER','','ALL','');
            seed_term('DIAGNOSIS','N13.2','Hydronephrosis with renal and ureteral calculous obstruction','ICD-10','URETER','','ALL','');
            seed_term('DIAGNOSIS','N13.5','Kinking and stricture of ureter without hydronephrosis','ICD-10','URETER','','ALL','');
            seed_term('DIAGNOSIS','N30.0','Acute cystitis','ICD-10','BLADDER','','ALL','');
            seed_term('DIAGNOSIS','N30.1','Interstitial cystitis (chronic)','ICD-10','BLADDER','','ALL','');
            seed_term('DIAGNOSIS','N30.9','Cystitis, unspecified','ICD-10','BLADDER','','ALL','');
            seed_term('DIAGNOSIS','N31.9','Neuromuscular dysfunction of bladder, unspecified','ICD-10','BLADDER','','ALL','');
            seed_term('DIAGNOSIS','N32.0','Bladder-neck obstruction','ICD-10','BLADDER','','ALL','');
            seed_term('DIAGNOSIS','N32.9','Bladder disorder, unspecified','ICD-10','BLADDER','','ALL','');
            seed_term('DIAGNOSIS','N21.0','Calculus in bladder','ICD-10','BLADDER','','ALL','');
            seed_term('DIAGNOSIS','N34.1','Nonspecific urethritis','ICD-10','URETHRA','','ALL','');
            seed_term('DIAGNOSIS','N35.9','Urethral stricture, unspecified','ICD-10','URETHRA','','ALL','');
            seed_term('DIAGNOSIS','N36.9','Urethral disorder, unspecified','ICD-10','URETHRA','','ALL','');
            seed_term('DIAGNOSIS','N40','Hyperplasia of prostate','ICD-10','PROSTATE','BPH benign prostatic enlargement','ALL','');
            seed_term('DIAGNOSIS','N41.0','Acute prostatitis','ICD-10','PROSTATE','','ALL','');
            seed_term('DIAGNOSIS','N41.1','Chronic prostatitis','ICD-10','PROSTATE','','ALL','');
            seed_term('DIAGNOSIS','N41.9','Inflammatory disease of prostate, unspecified','ICD-10','PROSTATE','','ALL','');
            seed_term('DIAGNOSIS','N42.9','Disorder of prostate, unspecified','ICD-10','PROSTATE','','ALL','');
            seed_term('COMPLAINT','HEADACHE','Headache','COMPLAINT','HEAD','head pain migraine','ALL','');
            seed_term('COMPLAINT','FACE_PAIN','Face pain','COMPLAINT','FACE','cheek nose sinus eye socket','ALL','');
            seed_term('COMPLAINT','JAW_PAIN','Jaw pain','COMPLAINT','JAW','tmj chewing clicking jaw','ALL','');
            seed_term('COMPLAINT','NECK_PAIN','Neck pain','COMPLAINT','NECK','stiff neck whiplash','ALL','');
            seed_term('COMPLAINT','SHOULDER_PAIN','Shoulder pain','COMPLAINT','SHOULDER','frozen shoulder collarbone','ALL','');
            seed_term('COMPLAINT','ARM_PAIN','Arm pain','COMPLAINT','UPPER_ARM:FOREARM','upper arm forearm','ALL','');
            seed_term('COMPLAINT','ELBOW_PAIN','Elbow pain','COMPLAINT','ELBOW','tennis elbow golfer','ALL','');
            seed_term('COMPLAINT','WRIST_PAIN','Wrist pain','COMPLAINT','WRIST','carpal tunnel','ALL','');
            seed_term('COMPLAINT','HAND_PAIN','Hand or finger pain','COMPLAINT','HAND','thumb finger knuckle','ALL','');
            seed_term('COMPLAINT','CHEST_PAIN','Chest or rib pain','COMPLAINT','CHEST','ribs breastbone sternum','ALL','');
            seed_term('COMPLAINT','UPPER_BACK_PAIN','Upper back pain','COMPLAINT','UPPER_BACK','mid back between shoulder blades thoracic','ALL','');
            seed_term('COMPLAINT','BACK_PAIN','Back pain','COMPLAINT','LOWER_BACK','low back lower back backache lumbago','ALL','');
            seed_term('COMPLAINT','SCIATICA','Sciatica','COMPLAINT','LOWER_BACK','leg pain from back shooting pain','ALL','');
            seed_term('COMPLAINT','TAILBONE_PAIN','Tailbone pain','COMPLAINT','SACRUM','coccyx sitting pain buttock','ALL','');
            seed_term('COMPLAINT','HIP_PAIN','Hip pain','COMPLAINT','HIP','groin','ALL','');
            seed_term('COMPLAINT','PELVIC_PAIN','Pelvic pain','COMPLAINT','PELVIS','pelvis pubic','ALL','');
            seed_term('COMPLAINT','THIGH_PAIN','Thigh pain','COMPLAINT','THIGH','upper leg','ALL','');
            seed_term('COMPLAINT','KNEE_PAIN','Knee pain','COMPLAINT','KNEE','kneecap','ALL','');
            seed_term('COMPLAINT','LEG_PAIN','Shin or calf pain','COMPLAINT','LOWER_LEG','lower leg shin calf','ALL','');
            seed_term('COMPLAINT','ANKLE_PAIN','Ankle pain','COMPLAINT','ANKLE','twisted ankle sprain','ALL','');
            seed_term('COMPLAINT','FOOT_PAIN','Foot or heel pain','COMPLAINT','FOOT','heel toe sole bunion','ALL','');
            seed_term('COMPLAINT','EAR_PAIN','Ear pain','COMPLAINT','EAR','earache hearing otalgia','ALL','');
            seed_term('COMPLAINT','EYE_DISCOMFORT','Eye discomfort','COMPLAINT','EYE','eye pain vision ophthalmology','ALL','');
            seed_term('COMPLAINT','COUGH','Cough','COMPLAINT','AIRWAY:LUNG','coughing dry persistent cough','ALL','');
            seed_term('COMPLAINT','BREATHLESSNESS','Shortness of breath','COMPLAINT','CHEST:LUNG:HEART','breathless dyspnea dyspnoea difficulty breathing exertional','ALL','PULMONOLOGY:CARDIOLOGY:INTERNAL_MEDICINE');
            seed_term('COMPLAINT','WHEEZE','Wheezing','COMPLAINT','AIRWAY:LUNG','wheeze whistling breathing','ALL','');
            seed_term('COMPLAINT','SPUTUM','Sputum / phlegm','COMPLAINT','AIRWAY:LUNG','productive cough mucus sputum phlegm','ALL','PULMONOLOGY:INTERNAL_MEDICINE');
            seed_term('COMPLAINT','HEMOPTYSIS','Coughing up blood','COMPLAINT','AIRWAY:LUNG','hemoptysis haemoptysis blood stained sputum','ALL','PULMONOLOGY:INTERNAL_MEDICINE');
            seed_term('COMPLAINT','CHEST_TIGHTNESS','Chest tightness','COMPLAINT','CHEST:AIRWAY:LUNG:HEART','tight chest pressure heaviness','ALL','PULMONOLOGY:CARDIOLOGY:INTERNAL_MEDICINE');
            seed_term('COMPLAINT','PAIN_BREATHING','Pain on breathing','COMPLAINT','CHEST:LUNG','pleuritic pain deep inspiration breathing','ALL','PULMONOLOGY:INTERNAL_MEDICINE');
            seed_term('COMPLAINT','PALPITATIONS','Palpitations','COMPLAINT','CHEST:HEART','racing pounding fluttering irregular heartbeat skipped beat','ALL','CARDIOLOGY:INTERNAL_MEDICINE');
            seed_term('COMPLAINT','ORTHOPNEA','Breathlessness lying flat','COMPLAINT','CHEST:HEART:LUNG','orthopnea orthopnoea breathless lying down','ALL','CARDIOLOGY:PULMONOLOGY:INTERNAL_MEDICINE');
            seed_term('COMPLAINT','ABDOMINAL_PAIN','Abdominal pain','COMPLAINT','STOMACH:SMALL_INTESTINE:COLON:LIVER:GALLBLADDER:PANCREAS','stomach ache belly pain abdominal cramps','ALL','GASTROENTEROLOGY:INTERNAL_MEDICINE');
            seed_term('COMPLAINT','HEARTBURN','Heartburn / acid reflux','COMPLAINT','ESOPHAGUS:STOMACH','acid reflux indigestion burning regurgitation','ALL','');
            seed_term('COMPLAINT','DYSPHAGIA','Difficulty swallowing','COMPLAINT','THROAT:ESOPHAGUS','dysphagia food sticking swallowing','ALL','');
            seed_term('COMPLAINT','NAUSEA','Nausea','COMPLAINT','STOMACH:SMALL_INTESTINE','feeling sick queasy nausea','ALL','');
            seed_term('COMPLAINT','VOMITING','Vomiting','COMPLAINT','STOMACH:SMALL_INTESTINE','vomit throwing up emesis','ALL','');
            seed_term('COMPLAINT','BLOATING','Abdominal bloating','COMPLAINT','STOMACH:SMALL_INTESTINE:COLON','bloating gas distension flatulence','ALL','');
            seed_term('COMPLAINT','DIARRHEA','Diarrhea','COMPLAINT','SMALL_INTESTINE:COLON','diarrhoea loose stools frequent stools','ALL','');
            seed_term('COMPLAINT','CONSTIPATION','Constipation','COMPLAINT','COLON','hard stools straining infrequent stools','ALL','');
            seed_term('COMPLAINT','BLOOD_STOOL','Blood in stool','COMPLAINT','SMALL_INTESTINE:COLON','rectal bleeding bloody stool hematochezia haematochezia','ALL','');
            seed_term('COMPLAINT','BLACK_STOOL','Black / tarry stool','COMPLAINT','STOMACH:SMALL_INTESTINE:COLON','melena melaena black tarry stools','ALL','');
            seed_term('COMPLAINT','JAUNDICE','Yellow skin / eyes','COMPLAINT','LIVER:GALLBLADDER:PANCREAS','jaundice yellow eyes skin','ALL','GASTROENTEROLOGY:INTERNAL_MEDICINE');
            seed_term('COMPLAINT','DYSURIA','Pain / burning urination','COMPLAINT','BLADDER:URETHRA','dysuria painful burning urination pee','ALL','');
            seed_term('COMPLAINT','URINARY_FREQUENCY','Frequent urination','COMPLAINT','BLADDER:URETHRA','urinary frequency frequent pee passing urine','ALL','');
            seed_term('COMPLAINT','URINARY_URGENCY','Urgent urination','COMPLAINT','BLADDER:URETHRA','urinary urgency sudden urge','ALL','');
            seed_term('COMPLAINT','NOCTURIA','Night-time urination','COMPLAINT','BLADDER','nocturia night waking urination','ALL','');
            seed_term('COMPLAINT','URINARY_HESITANCY','Difficulty starting urination','COMPLAINT','BLADDER:URETHRA','urinary hesitancy start urine trouble voiding','ALL','');
            seed_term('COMPLAINT','WEAK_STREAM','Weak urinary stream','COMPLAINT','BLADDER:URETHRA','slow weak intermittent stream dribbling','ALL','');
            seed_term('COMPLAINT','INCOMPLETE_EMPTYING','Incomplete bladder emptying','COMPLAINT','BLADDER','incomplete emptying retention residual urine','ALL','');
            seed_term('COMPLAINT','URINARY_LEAKAGE','Urine leakage','COMPLAINT','BLADDER:URETHRA','urinary incontinence leaking urine bladder control','ALL','');
            seed_term('COMPLAINT','HEMATURIA','Blood in urine','COMPLAINT','KIDNEY:URETER:BLADDER:URETHRA','hematuria haematuria red pink brown urine','ALL','');
            seed_term('COMPLAINT','FLANK_PAIN','Flank / loin pain','COMPLAINT','KIDNEY:URETER','flank loin side renal pain','ALL','');
            seed_term('COMPLAINT','NASAL_BLOCKAGE','Blocked nose','COMPLAINT','NOSE','nasal congestion obstruction stuffy nose','ALL','');
            seed_term('COMPLAINT','RUNNY_NOSE','Runny nose','COMPLAINT','NOSE','rhinorrhea rhinorrhoea nasal discharge sneezing','ALL','');
            seed_term('COMPLAINT','NOSEBLEED','Nosebleed','COMPLAINT','NOSE','epistaxis bleeding nose','ALL','');
            seed_term('COMPLAINT','SORE_THROAT','Sore throat','COMPLAINT','THROAT','throat pain painful swallowing','ALL','');
            seed_term('COMPLAINT','HOARSENESS','Hoarse voice','COMPLAINT','THROAT:AIRWAY','hoarseness dysphonia voice change','ALL','');
            seed_term('COMPLAINT','HEARING_CHANGE','Reduced hearing','COMPLAINT','EAR','hearing loss deaf muffled hearing','ALL','');
            seed_term('COMPLAINT','TINNITUS','Ringing in ears','COMPLAINT','EAR','tinnitus ringing buzzing ears','ALL','');
            seed_term('COMPLAINT','EAR_DISCHARGE','Ear discharge','COMPLAINT','EAR','ear drainage otorrhea otorrhoea','ALL','');
            seed_term('COMPLAINT','SINUS_PRESSURE','Sinus pressure','COMPLAINT','FACE:NOSE','sinus facial pressure congestion','ALL','');
            seed_term('COMPLAINT','BLURRED_VISION','Blurred vision','COMPLAINT','EYE','blurry blurred vision visual disturbance','ALL','');
            seed_term('COMPLAINT','RED_EYE','Red eye','COMPLAINT','EYE','redness bloodshot eye','ALL','');
            seed_term('COMPLAINT','DRY_EYE','Dry / gritty eyes','COMPLAINT','EYE','dry gritty sandy burning eyes','ALL','');
            seed_term('COMPLAINT','WATERY_EYE','Watery eyes','COMPLAINT','EYE','tearing watering epiphora','ALL','');
            seed_term('COMPLAINT','ITCHY_EYE','Itchy eyes','COMPLAINT','EYE','itching itchy eyes','ALL','');
            seed_term('COMPLAINT','LIGHT_SENSITIVITY','Light sensitivity','COMPLAINT','EYE','photophobia sensitive light','ALL','');
            seed_term('COMPLAINT','FLOATERS','Flashes / floaters','COMPLAINT','EYE','flashes floaters spots vision','ALL','');
            seed_term('COMPLAINT','DIZZINESS','Dizziness / vertigo','COMPLAINT','HEAD:BRAIN:EAR','dizzy vertigo spinning lightheaded','ALL','NEUROLOGY:ENT');
            seed_term('COMPLAINT','BALANCE_PROBLEM','Balance problems','COMPLAINT','HEAD:BRAIN:EAR','unsteady imbalance balance difficulty','ALL','NEUROLOGY:ENT');
            seed_term('COMPLAINT','MEMORY_CONCERN','Memory concerns','COMPLAINT','BRAIN:HEAD','memory forgetfulness concentration cognition','ALL','NEUROLOGY');
            seed_term('COMPLAINT','TINGLING','Numbness / tingling','COMPLAINT','HAND:FOREARM:LOWER_LEG:FOOT','numb tingling pins needles paresthesia paraesthesia','ALL','NEUROLOGY:ORTHOPEDICS');
            seed_term('COMPLAINT','LIMB_WEAKNESS','Limb weakness','COMPLAINT','UPPER_ARM:FOREARM:HAND:THIGH:LOWER_LEG:FOOT','weakness weak arm leg muscle','ALL','NEUROLOGY:ORTHOPEDICS');
            seed_term('COMPLAINT','TREMOR','Tremor / shaking','COMPLAINT','HAND:FOREARM','tremor shaking hand','ALL','NEUROLOGY');
            seed_term('COMPLAINT','JOINT_STIFFNESS','Joint stiffness','COMPLAINT','SHOULDER:ELBOW:WRIST:HAND:HIP:KNEE:ANKLE:FOOT','stiff joint reduced movement morning stiffness','ALL','ORTHOPEDICS');
            seed_term('COMPLAINT','JOINT_SWELLING','Joint swelling','COMPLAINT','SHOULDER:ELBOW:WRIST:HAND:HIP:KNEE:ANKLE:FOOT','swollen joint swelling effusion','ALL','ORTHOPEDICS');
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
            if length(l_answer.get_string('note'))>500 then return l_field.get_string('label')||' note is too long.';end if;
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
                    if length(l_answer.get_string('value'))>case when l_field.get_string('type')='textarea' then 2000 else 500 end then return l_field.get_string('label')||' is too long.'; end if;
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
