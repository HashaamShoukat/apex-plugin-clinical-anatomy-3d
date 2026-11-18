-- v1.9 shared-contract checks. Required catalogue/core objects only.
-- Run in an authenticated DEVELOPMENT APEX session. Fixture DML is rolled back.
set serveroutput on
whenever sqlerror exit sql.sqlcode rollback
declare
 l_app number:=apex_application.g_flow_id;l_workspace number:=apex_custom_auth.get_security_group_id;
 l_code varchar2(60):='QA19-'||rawtohex(sys_guid());l_label varchar2(400):='Fictional QA19 '||rawtohex(sys_guid());
 l_a number;l_b number;l_count number;l_before number;l_error varchar2(4000);l_payload clob;l_duplicate boolean:=false;
 procedure check_result(p_name varchar2,p_ok boolean) is begin if not nvl(p_ok,false) then raise_application_error(-20090,p_name);end if;dbms_output.put_line('ok   '||p_name);end;
begin
 savepoint qa19_shared;
 if l_app is null or l_workspace is null or v('APP_USER') is null then raise_application_error(-20090,'Create an authenticated development APEX session first.');end if;
 select count(*) into l_count from user_tab_columns where table_name in ('CA3D_CLINIC_TERMS','CA3D_EXAM_DEFINITIONS') and column_name in ('CATALOG_SCOPE','CANONICAL_TERM_ID');check_result('No catalogue scope or alias columns',l_count=0);
 select count(*) into l_count from user_tables where table_name='CA3D_CATALOG_SCOPES';check_result('No catalogue scope registry',l_count=0);
 insert into ca3d_clinic_terms(workspace_id,application_id,term_kind,label,created_by,term_code,coding_system) values(l_workspace,l_app,'DIAGNOSIS',l_label,v('APP_USER'),l_code,'QA19-A') returning term_id into l_a;
 insert into ca3d_term_areas(term_id,area_code,part_code) values(l_a,'HEART','*');
 insert into ca3d_clinic_terms(workspace_id,application_id,term_kind,label,created_by,term_code,coding_system) values(l_workspace,l_app,'DIAGNOSIS',l_label,v('APP_USER'),l_code,'QA19-B') returning term_id into l_b;
 check_result('Code and label uniqueness includes coding system',l_a<>l_b);
 begin
  insert into ca3d_clinic_terms(workspace_id,application_id,term_kind,label,created_by,term_code,coding_system) values(l_workspace,l_app,'DIAGNOSIS',l_label,v('APP_USER'),l_code,'QA19-A');
 exception when dup_val_on_index then l_duplicate:=true;end;
 check_result('Same-system duplicate is rejected',l_duplicate);
 l_payload:=to_clob('{"v":2,"sex":"M","sites":[{"area":"HEART","diagnoses":[{"source":"CUSTOM","id":')||to_char(l_a,'TM9')||',"label":"'||l_label||'","code":"'||l_code||'","system":"QA19-A"}]}]}';
 l_error:=ca3d_clinic_api.validate_value(l_payload,'OFF');check_result('Shared numeric term ID validates without a scope',l_error is null);
 ca3d_clinic_api.initialize_catalog;select count(*) into l_before from ca3d_clinic_terms where workspace_id=l_workspace and application_id=l_app;
 ca3d_clinic_api.initialize_catalog;select count(*) into l_count from ca3d_clinic_terms where workspace_id=l_workspace and application_id=l_app;
 check_result('Repeated initialization uses one base',l_before=l_count);
 rollback to qa19_shared;dbms_output.put_line('SHARED_CONTRACT_CHECKS_PASSED_AND_ROLLED_BACK');
exception when others then rollback to qa19_shared;raise;
end;
/
