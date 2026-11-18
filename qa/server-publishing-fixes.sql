-- Run after installing dist/db/skeleton3d_pkg.sql in an APEX 26.1+ parsing schema.
-- These checks validate JSON without creating records or changing packages.
set define off
set serveroutput on
whenever sqlerror exit sql.sqlcode rollback
declare
    l_value clob;
    l_array json_array_t;
    l_document json_object_t;
    procedure check_value(p_name varchar2,p_value clob,p_valid boolean) is
        l_error varchar2(4000):=skeleton3d_pkg.validate_payload(p_value);
    begin
        if (p_valid and l_error is not null) or (not p_valid and l_error is null) then
            raise_application_error(-20009,p_name||' returned '||nvl(l_error,'valid'));
        end if;
        dbms_output.put_line('ok   '||p_name);
    end;
begin
    check_value('Legacy bone accepted','{"v":1,"sex":"M","sites":[{"area":"THIGH","side":"L","bone":"FEMUR"}]}',true);
    check_value('Duplicate bone and part rejected','{"v":2,"sex":"M","sites":[{"area":"THIGH","side":"L","bone":"FEMUR"},{"area":"THIGH","side":"L","part":"FEMUR"}]}',false);
    check_value('Female prostate rejected','{"v":2,"sex":"F","sites":[{"area":"PROSTATE"}]}',false);
    check_value('Fractional pain accepted','{"v":1,"sites":[{"area":"HEART","pain":6.5}]}',true);
    check_value('NULL diagnosis code rejected','{"sites":[{"area":"HEART","diagnoses":[{"code":null,"label":"Example"}]}]}',false);
    l_value:='{"sites":[],"exam":{"answers":{"legacy":{"value":"'||rpad('a',2001,'a')||'"}}}}';
    check_value('Historical exam text limit',l_value,false);
    l_array:=json_array_t();
    for i in 1..101 loop
        l_document:=json_object_t();l_document.put('code',to_char(i));l_document.put('label','Example');l_array.append(l_document);
    end loop;
    l_value:='{"sites":[{"area":"HEART","diagnoses":'||l_array.to_clob||'}]}';
    check_value('Diagnosis count limit',l_value,false);
end;
/
