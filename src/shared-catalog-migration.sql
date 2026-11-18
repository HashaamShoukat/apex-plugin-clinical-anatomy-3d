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
