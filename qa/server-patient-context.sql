declare
 procedure check_value(p_name varchar2,p_json clob,p_ok boolean) is l_error varchar2(4000);begin
  l_error:=skeleton3d_pkg.validate_payload(p_json);
  if (p_ok and l_error is not null) or (not p_ok and l_error is null) then raise_application_error(-20009,p_name||': unexpected validation result '||l_error);end if;
  dbms_output.put_line('ok   '||p_name);
 end;
begin
 check_value('Legacy anatomy JSON remains valid','{"v":1,"sex":"M","sites":[{"area":"HEART","diagnoses":[]}]}',true);
 check_value('Malformed context document rejected','{"v":2,"sites":[],"context":{"patient":{"name":"Fictional patient","mrn":"QA-001","age":42},"observations":[{"id":"pulse","label":"Pulse","value":82,"unit":"beats/min","source":"Nursing intake","readOnly":true}]}},"unused":null}',false);
 check_value('Valid snapshot accepted','{"v":2,"sites":[],"context":{"patient":{"name":"Fictional patient","mrn":"QA-001","age":42},"observations":[{"id":"pulse","label":"Pulse","value":82,"unit":"beats/min","source":"Nursing intake","readOnly":true}]}}',true);
 check_value('Invalid age rejected','{"v":2,"sites":[],"context":{"patient":{"age":"forty"}}}',false);
 check_value('Duplicate observation IDs rejected','{"v":2,"sites":[],"context":{"observations":[{"id":"pulse","value":80},{"id":"pulse","value":82}]}}',false);
 check_value('Invalid observation flags rejected','{"v":2,"sites":[],"context":{"observations":[{"id":"pulse","value":80,"highlight":"yes"}]}}',false);
 check_value('Prefill provenance accepted','{"v":2,"sites":[],"exam":{"answers":{"pulse":{"value":82,"prefill":{"source":"Nursing intake","recordedBy":"Demo nurse","locked":true}}}}}',true);
 check_value('Invalid prefill locks rejected','{"v":2,"sites":[],"exam":{"answers":{"pulse":{"value":82,"prefill":{"locked":"yes"}}}}}',false);
end;
/
