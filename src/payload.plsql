-- Shared structural validation for every item mode and application save processes.
function validate_payload(p_value in clob,p_specialty varchar2 default 'ALL',p_sex varchar2 default null) return varchar2 is
    c_area_codes constant varchar2(2000) := '@@AREA_CODES@@';
    c_anatomy_links constant varchar2(32767) := ':@@ANATOMY_LINKS@@:';
    c_specialty_links constant varchar2(32767) := ':@@SPECIALTY_LINKS@@:';
    type t_keys is table of boolean index by varchar2(1000);
    l_seen t_keys;
    l_term_keys t_keys;
    l_diagnosis_keys t_keys;
    l_marker_keys t_keys;
    l_doc json_object_t;
    l_site json_object_t;
    l_term json_object_t;
    l_marker json_object_t;
    l_exam json_object_t;
    l_answers json_object_t;
    l_answer json_object_t;
    l_context json_object_t;
    l_patient json_object_t;
    l_observation json_object_t;
    l_prefill json_object_t;
    l_observations json_array_t;
    l_details json_array_t;
    l_detail_keys t_keys;
    l_observation_keys t_keys;
    l_names sys.odcivarchar2list;
    l_sites json_array_t;
    l_terms json_array_t;
    l_markers json_array_t;
    l_points json_array_t;
    l_point json_array_t;
    l_element json_element_t;
    l_answer_names json_key_list;
    l_key varchar2(1000);
    l_kind varchar2(20);
    l_number number;

    procedure require(p_ok boolean, p_message varchar2) is
    begin
        if not nvl(p_ok,false) then raise_application_error(-20070,p_message); end if;
    end;

    function present(p_object json_object_t,p_key varchar2) return boolean is
        l_value json_element_t := p_object.get(p_key);
    begin
        return l_value is not null and not l_value.is_null;
    end;

    procedure check_text(p_object json_object_t,p_key varchar2,p_max number) is
        l_value json_element_t := p_object.get(p_key);
    begin
        if l_value is not null and not l_value.is_null then
            require(l_value.is_string,p_key||' must contain text.');
            require(length(p_object.get_string(p_key))<=p_max or p_object.get_string(p_key) is null,p_key||' is too long.');
        end if;
    end;

    function array_value(p_object json_object_t,p_key varchar2) return json_array_t is
        l_value json_element_t := p_object.get(p_key);
    begin
        if l_value is null or l_value.is_null then return json_array_t(); end if;
        require(l_value.is_array,p_key||' must be an array.');
        return treat(l_value as json_array_t);
    end;

    function term_identity(p_term json_object_t,p_default_system varchar2) return varchar2 is
    begin
        if p_term.get_string('source')='CUSTOM' then return 'CUSTOM|'||to_char(p_term.get_number('id'),'TM9'); end if;
        return nvl(p_term.get_string('system'),p_default_system)||'|'||p_term.get_string('code');
    end;
begin
    if p_value is null then return null; end if;
    require(dbms_lob.getlength(p_value)<=1048576,'The anatomy value exceeds 1048576 characters.');
    l_doc := json_object_t.parse(p_value);
    if present(l_doc,'v') then
        l_element:=l_doc.get('v');
        require(l_element.is_number and l_doc.get_number('v') in (1,2),'Unsupported anatomy JSON version.');
    end if;
    if present(l_doc,'contextRefresh') then
        l_context:=l_doc.get_object('contextRefresh');require(l_context is not null,'contextRefresh must be an object.');
        check_text(l_context,'at',100);check_text(l_context,'note',500);check_text(l_context,'previousSex',1);
        require(l_context.get_string('previousSex') in ('M','F','U'),'contextRefresh.previousSex must be M, F or U.');
    end if;
    check_text(l_doc,'sex',1);
    require(p_sex is null or p_sex in ('M','F','U'),'Invalid configured patient sex.');
    require(p_sex is null or not present(l_doc,'sex') or l_doc.get_string('sex')=p_sex,'The model sex does not match the configured patient.');
    require(instr(':ALL:ENT:OPHTHALMOLOGY:CARDIOLOGY:UROLOGY:INTERNAL_MEDICINE:GASTROENTEROLOGY:NEUROLOGY:PULMONOLOGY:ORTHOPEDICS:',':'||p_specialty||':')>0,'Invalid configured specialty.');
    if present(l_doc,'context') then
        l_context:=l_doc.get_object('context'); require(l_context is not null,'context must be an object.');
        require(dbms_lob.getlength(l_context.to_clob)<=32767,'Patient context exceeds 32767 characters.');
        if present(l_context,'patient') then
            l_patient:=l_context.get_object('patient'); require(l_patient is not null,'context.patient must be an object.');
            check_text(l_patient,'name',200); check_text(l_patient,'mrn',200);
            l_names:=sys.odcivarchar2list('id','sex','dateOfBirth','encounterId');
            for n in 1..l_names.count loop check_text(l_patient,l_names(n),100);end loop;
            l_details:=array_value(l_patient,'details');require(l_details.get_size<=12,'Patient details supports up to 12 entries.');
            for j in 0..l_details.get_size-1 loop
                l_observation:=treat(l_details.get(j) as json_object_t);require(l_observation is not null,'Patient details must be objects.');
                check_text(l_observation,'id',64);l_key:=l_observation.get_string('id');
                require(regexp_like(l_key,'^[a-zA-Z][a-zA-Z0-9_]{0,63}$'),'Invalid patient detail ID.');
                require(not l_detail_keys.exists(l_key),'Duplicate patient detail ID.');l_detail_keys(l_key):=true;
                check_text(l_observation,'label',120);check_text(l_observation,'unit',40);
                require(l_observation.has('value'),'Patient detail value is required.');l_element:=l_observation.get('value');
                require(l_element.is_scalar or l_element.is_null,'Patient detail values must be scalar.');
                if l_element.is_string then check_text(l_observation,'value',400);end if;
            end loop;
            if present(l_patient,'age') then
                l_element:=l_patient.get('age'); require(l_element.is_number,'Patient age must be numeric.');
                require(l_patient.get_number('age') between 0 and 150,'Patient age is outside the supported range.');
            end if;
        end if;
        if present(l_context,'recording') then
            l_prefill:=l_context.get_object('recording');require(l_prefill is not null,'recording must be an object.');
            check_text(l_prefill,'source',120);check_text(l_prefill,'recordedBy',120);check_text(l_prefill,'recordedAt',120);
        end if;
        l_observations:=array_value(l_context,'observations'); require(l_observations.get_size<=40,'Context supports up to 40 observations.');
        for j in 0..l_observations.get_size-1 loop
            l_observation:=treat(l_observations.get(j) as json_object_t); require(l_observation is not null,'Observations must be objects.');
            check_text(l_observation,'id',64); l_key:=l_observation.get_string('id');
            require(regexp_like(l_key,'^[a-zA-Z][a-zA-Z0-9_]{0,63}$'),'Invalid observation ID.');
            require(not l_observation_keys.exists(l_key),'Duplicate observation ID.'); l_observation_keys(l_key):=true;
            check_text(l_observation,'label',120); check_text(l_observation,'unit',40); check_text(l_observation,'flag',40);
            check_text(l_observation,'note',500);
            l_names:=sys.odcivarchar2list('source','recordedBy','recordedAt','examField');
            for n in 1..l_names.count loop check_text(l_observation,l_names(n),120); end loop;
            require(l_observation.has('value'),'Observation value is required.');
            l_element:=l_observation.get('value'); require(l_element.is_scalar or l_element.is_null,'Observation values must be scalar.');
            if l_element.is_string then check_text(l_observation,'value',200); end if;
            l_names:=sys.odcivarchar2list('highlight','readOnly','hidden');
            for n in 1..l_names.count loop
                if present(l_observation,l_names(n)) then l_element:=l_observation.get(l_names(n)); require(l_element.is_boolean,l_names(n)||' must be boolean.'); end if;
            end loop;
        end loop;
    end if;
    require(not present(l_doc,'sex') or l_doc.get_string('sex') in ('M','F','U'),'sex must be M, F or U (unconfirmed).');
    require(present(l_doc,'sites'),'sites must be an array.');
    l_sites:=array_value(l_doc,'sites');
    require(l_sites.get_size<=500,'sites supports up to 500 entries.');
    for i in 0..l_sites.get_size-1 loop
        l_site:=treat(l_sites.get(i) as json_object_t);
        require(l_site is not null,'Each site must be an object.');
        check_text(l_site,'area',40);
        require(l_site.get_string('area') is not null and instr(':'||c_area_codes||':',':'||l_site.get_string('area')||':')>0,'Unsupported anatomical area.');
        require(nvl(p_sex,nvl(l_doc.get_string('sex'),'M'))='M' or l_site.get_string('area')<>'PROSTATE','A prostate finding is incompatible with the female model.');
        check_text(l_site,'side',1);
        require(not present(l_site,'side') or l_site.get_string('side') in ('L','R'),'side must be L or R.');
        require(p_specialty='ALL' or instr(c_specialty_links,':'||p_specialty||'|'||l_site.get_string('area')||':')>0,'An anatomical area is outside the configured specialty.');
        l_names:=sys.odcivarchar2list('bone','part');
        for n in 1..l_names.count loop
            check_text(l_site,l_names(n),100);
            if present(l_site,l_names(n)) then
                require(instr(c_anatomy_links,':'||l_site.get_string(l_names(n))||'|'||l_site.get_string('area')||'|'||nvl(l_site.get_string('side'),'-')||':')>0,'The bone or part does not belong to this anatomical area and side.');
            end if;
        end loop;
        require(not present(l_site,'bone') or not present(l_site,'part') or l_site.get_string('bone')=l_site.get_string('part'),'A site cannot identify different bones and parts.');
        l_names:=sys.odcivarchar2list('boneName','partName','label');
        for n in 1..l_names.count loop check_text(l_site,l_names(n),400); end loop;
        check_text(l_site,'note',2000);
        check_text(l_site,'assessment',20);
        require(not present(l_site,'assessment') or l_site.get_string('assessment') in ('NOT_ASSESSED','NORMAL','ABNORMAL'),'Unsupported finding state.');
        if present(l_site,'pain') then
            l_element:=l_site.get('pain');
            require(l_element.is_number,'pain must be numeric.');
            require(l_site.get_number('pain') between 0 and 10,'pain must be between 0 and 10.');
        end if;
        l_key:=case when l_site.get_string('part') is not null then 'P|'||l_site.get_string('part')
                    when l_site.get_string('bone') is not null then 'P|'||l_site.get_string('bone')
                    else 'A|'||l_site.get_string('area') end||'|'||l_site.get_string('side');
        require(not l_seen.exists(l_key),'Duplicate anatomical site.');
        l_seen(l_key):=true;
        l_diagnosis_keys.delete;
        for kind in 1..2 loop
            l_kind:=case kind when 1 then 'diagnoses' else 'complaints' end;
            l_terms:=array_value(l_site,l_kind);
            require(l_terms.get_size<=100,'Each diagnosis or complaint list supports up to 100 entries.');
            l_term_keys.delete;
            for j in 0..l_terms.get_size-1 loop
                l_term:=treat(l_terms.get(j) as json_object_t);
                require(l_term is not null,'Each diagnosis or complaint must be an object.');
                check_text(l_term,'label',400); check_text(l_term,'code',60);
                check_text(l_term,'system',40); check_text(l_term,'source',40); check_text(l_term,'specialty',30);
                require(trim(l_term.get_string('label')) is not null,'A diagnosis or complaint requires a label.');
                if l_term.get_string('source')='CUSTOM' then
                    l_number:=l_term.get_number('id');
                    require(l_number>0 and l_number<=9007199254740991 and trunc(l_number)=l_number,'Custom term ID must be a positive safe integer.');
                else
                    require(trim(l_term.get_string('code')) is not null,'A coded diagnosis or complaint requires a code.');
                end if;
                check_text(l_term,'certainty',20);
                require(not present(l_term,'certainty') or l_term.get_string('certainty') in ('unconfirmed','provisional','differential','confirmed','refuted'),'Unsupported diagnosis certainty.');
                l_key:=term_identity(l_term,case kind when 1 then 'ICD-10' else 'COMPLAINT' end);
                require(not l_term_keys.exists(l_key),'Duplicate diagnosis or complaint.');
                l_term_keys(l_key):=true;
                if kind=1 then l_diagnosis_keys(l_key):=true; end if;
            end loop;
        end loop;
        l_markers:=array_value(l_site,'markers');
        require(l_markers.get_size<=100,'Each site supports up to 100 markers.');
        l_marker_keys.delete;
        for j in 0..l_markers.get_size-1 loop
            l_marker:=treat(l_markers.get(j) as json_object_t);
            require(l_marker is not null,'Each marker must be an object.');
            check_text(l_marker,'kind',5); check_text(l_marker,'id',100); check_text(l_marker,'label',120); check_text(l_marker,'diagnosis',160);
            require(l_marker.get_string('kind') in ('POINT','AREA'),'Marker kind must be POINT or AREA.');
            l_points:=array_value(l_marker,'points');
            require(l_points.get_size between case when l_marker.get_string('kind')='AREA' then 3 else 1 end and 100,'A marker requires valid point coordinates (maximum 100).');
            for k in 0..l_points.get_size-1 loop
                l_point:=treat(l_points.get(k) as json_array_t);
                require(l_point is not null,'Marker coordinates must be arrays.');
                require(l_point.get_size=3,'Marker coordinates require XYZ values.');
                for axis in 0..2 loop l_element:=l_point.get(axis); require(l_element.is_number,'Marker coordinates must be numeric.'); end loop;
            end loop;
            l_key:=l_marker.get_string('id');
            if l_key is not null then require(not l_marker_keys.exists(l_key),'Duplicate marker ID.'); l_marker_keys(l_key):=true; end if;
            l_key:=l_marker.get_string('diagnosis');
            if l_key is not null then require(l_diagnosis_keys.exists(l_key),'A marker must reference a diagnosis at its own site.'); end if;
        end loop;
    end loop;
    if present(l_doc,'exam') then
        l_exam:=l_doc.get_object('exam'); require(l_exam is not null,'exam must be an object.');
        check_text(l_exam,'template',100);check_text(l_exam,'profile',100);
        if present(l_exam,'version') then
            l_element:=l_exam.get('version');l_number:=l_exam.get_number('version');
            require(l_element.is_number and l_number between 0 and 9007199254740991 and trunc(l_number)=l_number,'exam.version must be a nonnegative safe integer.');
        end if;
        if present(l_exam,'answers') then
            l_answers:=l_exam.get_object('answers'); require(l_answers is not null,'exam.answers must be an object.');
            l_answer_names:=l_answers.get_keys;
            require(l_answer_names.count<=100,'exam.answers supports up to 100 entries.');
            for i in 1..l_answer_names.count loop
                require(regexp_like(l_answer_names(i),'^[a-zA-Z][a-zA-Z0-9_]{0,127}$'),'Invalid examination field ID.');
                l_answer:=l_answers.get_object(l_answer_names(i)); require(l_answer is not null,'Each examination answer must be an object.');
                check_text(l_answer,'note',@@EXAM_NOTE@@);
                if present(l_answer,'prefill') then
                    l_prefill:=l_answer.get_object('prefill'); require(l_prefill is not null,'prefill must be an object.');
                    check_text(l_prefill,'source',120); check_text(l_prefill,'recordedBy',120); check_text(l_prefill,'recordedAt',120);
                    if present(l_prefill,'locked') then l_element:=l_prefill.get('locked'); require(l_element.is_boolean,'prefill.locked must be boolean.'); end if;
                end if;
                if present(l_answer,'value') then
                    l_element:=l_answer.get('value'); require(l_element.is_scalar,'Examination values must be scalar.');
                    if l_element.is_string then check_text(l_answer,'value',@@EXAM_TEXTAREA@@); end if;
                end if;
                if present(l_answer,'deferred') then
                    l_element:=l_answer.get('deferred'); require(l_element.is_boolean,'deferred must be boolean.');
                end if;
            end loop;
        end if;
    end if;
    return null;
exception when others then
    if sqlcode=-20070 then return substr(sqlerrm,12); end if;
    return 'The anatomy JSON could not be read. Check the document and its field types.';
end validate_payload;
