# Shared catalogue and custom storage guide

Clinical Anatomy 3D 1.9 uses one diagnosis/complaint base and one examination form history per APEX application. Add terms in the supplied tables; all anatomy items use them. Specialty and anatomy mappings filter choices. There are no Clinic Mode, Catalogue Scope or external diagnosis-query settings.

## Required and optional database objects

Build with npm ci and npm run build, then run scripts from dist/release/ in the application's parsing schema.

| Script / objects | Required? | Purpose |
|---|---|---|
| db/skeleton3d_pkg.sql - SKELETON3D_PKG | Always | Render, AJAX and validators, including patient-source validation. |
| db/001_clinic_store.sql - CA3D_CLINIC_API | Normal installation | The shared catalogue and examination API. |
| CA3D_CLINIC_TERMS | With the shared API | Both diagnoses and complaints; TERM_KIND is DIAGNOSIS or COMPLAINT. |
| CA3D_TERM_AREAS | With the shared API | Links each master term to areas/organs and optional parts. |
| CA3D_EXAM_DEFINITIONS | With the shared API | Versioned shared examination form. Version zero also marks initial catalogue creation. |
| CA3D_CLINIC_CATALOG_V | Installed with the API | Reports and administration over the same master/link tables. |
| db/install.sql | Recommended entry point | Installs all required catalogue objects and core callbacks. |
| db/002_demo_records.sql - CA3D_DEMO_RECORDS, CA3D_DEMO_RECORDS_V, CA3D_DEMO_API | Sample only | Fictional example CLOB assessment storage. |
| db/003_relational_store.sql - CA3D_ASSESSMENTS, CA3D_SITES, CA3D_SITE_TERMS, CA3D_MARKERS, CA3D_MARKER_POINTS, CA3D_EXAM_ANSWERS | Sample only | Complete example relational assessment storage. |
| CA3D_RELATIONAL_API, CA3D_ASSESSMENTS_V, CA3D_FINDINGS_V, CA3D_DIAGNOSES_V | Sample only | Save/load and reports for that relational example. |

Indexes and identity sequences support their owning tables. Neither the default installer nor the widget requires the sample patient storage tables. Do not install the sample scripts if your application stores assessments itself.

For basic anatomy alone, install only the core callbacks, hide Diagnosis Suggestions, turn Common Complaints and Initial Examination off, and disable maintenance. Stored shared terms or examination answers still require the shared API for validation.

## Maintaining the one base

CA3D_CLINIC_TERMS stores starter and locally added diagnoses and complaints together. CA3D_TERM_AREAS supplies their anatomy links. Add diagnosis / Add complaint writes to those tables. Editing rights are controlled by Clinic Permissions and Shared Catalog Maintainer Condition; users without maintenance rights can select existing entries.

For bulk imports, equivalent DML in an authorized administration process is:

```sql
declare
    l_id number;
begin
    insert into ca3d_clinic_terms (
        workspace_id,application_id,term_kind,label,specialty_code,
        term_code,coding_system,external_id,keywords,active_yn,created_by
    ) values (
        apex_custom_auth.get_security_group_id,:APP_ID,'DIAGNOSIS',
        'Locally approved valve assessment','CARDIOLOGY',
        'LOCAL-VALVE-01','HOSPITAL','YOUR-INTERNAL-ID-123','valve review','Y',:APP_USER
    ) returning term_id into l_id;
    insert into ca3d_term_areas(term_id,area_code,part_code)
    values(l_id,'HEART','MITRAL_VALVE');
end;
```

For complaints, use TERM_KIND='COMPLAINT'. Use PART_CODE='*' for a whole area, or add several link rows. Keep TERM_ID as the catalogue identity; use EXTERNAL_ID or additional nullable mapping columns for your internal IDs. Keep workspace/application ownership filters and administrative authorization in every custom maintenance query.

Use ACTIVE_YN='N' to retire an entry. Adding it again does not reactivate it. Names/codes are unique within application, kind, specialty and coding system. Keep recorded labels/codes as historical values. Refresh after direct catalogue DML.

The starter JSON files are installation seeds and standalone preview data. Installed lookups read the database tables. Upgrades do not overwrite local catalogue edits. A fresh application's first catalogue request seeds the tables once. To initialize without starter terms, call CA3D_CLINIC_API.INITIALIZE_CATALOG(p_include_starter=>false) in that application's APEX session before opening its first anatomy item. Configure the examination through its authorized editor.

## Get and restore assessment JSON

Use CLOB session state for the anatomy item and a CLOB database column for storage.

```javascript
const text = apex.item('P10_ANATOMY').getValue();
const document = skeleton3d.get('P10_ANATOMY').value();
apex.item('P10_ANATOMY').setValue(text);
```

The APEX item value includes pending edits. Invalid JSON assigned through apex.item().setValue() displays an item error and preserves the existing assessment; a valid assignment clears the error. The lower-level load() API throws so callers can handle invalid input. An empty item means no document; a document containing sites:[] explicitly records no findings.

## Save into your own CLOB table

This minimal example has no live patient source or prefill claims. Add your encounter relationship, clinical-access rules and audit process when adapting it. It needs the core/shared APIs, but no sample storage tables.

```sql
create table my_anatomy_records (
    record_id number generated always as identity primary key,
    workspace_id number not null,
    application_id number not null,
    owner_user varchar2(255) not null,
    assessment_json clob not null check (assessment_json is json),
    row_version number default 1 not null
);
```

Use hidden P10_RECORD_ID and P10_ROW_VERSION items, and a save process like this. Match the trusted specialty, sex and examination mode to the item's configuration.

```sql
declare
    l_payload clob:=apex_session_state.get_clob('P10_ANATOMY');
    l_error varchar2(4000);
    l_id number:=:P10_RECORD_ID;
    l_version number:=:P10_ROW_VERSION;
begin
    if not apex_authentication.is_authenticated then raise_application_error(-20001,'Sign in before saving.');end if;
    if l_payload is null then raise_application_error(-20001,'Supply an assessment document.');end if;
    l_error:=skeleton3d_pkg.validate_payload(l_payload,'CARDIOLOGY','M');
    if l_error is not null then raise_application_error(-20001,l_error);end if;
    l_error:=ca3d_clinic_api.validate_value(l_payload,'OPTIONAL');
    if l_error is not null then raise_application_error(-20001,l_error);end if;
    l_error:=skeleton3d_pkg.validate_patient(l_payload,null,'{}',ca3d_clinic_api.exam_definition);
    if l_error is not null then raise_application_error(-20001,l_error);end if;
    if l_id is null then
        insert into my_anatomy_records(workspace_id,application_id,owner_user,assessment_json)
        values(apex_custom_auth.get_security_group_id,:APP_ID,upper(:APP_USER),l_payload)
        returning record_id,row_version into l_id,l_version;
    else
        update my_anatomy_records set assessment_json=l_payload,row_version=row_version+1
        where record_id=l_id and row_version=l_version
          and workspace_id=apex_custom_auth.get_security_group_id
          and application_id=:APP_ID and owner_user=upper(:APP_USER);
        if sql%rowcount<>1 then raise_application_error(-20001,'Record unavailable or changed. Reload it.');end if;
        l_version:=l_version+1;
    end if;
    :P10_RECORD_ID:=l_id;:P10_ROW_VERSION:=l_version;
end;
```

Let APEX own the transaction. Add a stable encounter/request uniqueness rule to handle double submissions. For a live patient source, fetch its authorized JSON on the server and pass that as p_context to validate_patient, with the item's options and current examination definition. Derive the expected sex from the same trusted source. The submitted assessment's own context is not an authorized source. Custom AJAX/save APIs must perform these checks too.

To load a permitted record before rendering:

```sql
declare l_payload clob;l_version number;
begin
    select assessment_json,row_version into l_payload,l_version
    from my_anatomy_records
    where record_id=:P10_RECORD_ID and workspace_id=apex_custom_auth.get_security_group_id
      and application_id=:APP_ID and owner_user=upper(:APP_USER);
    apex_session_state.set_value('P10_ANATOMY',l_payload);
    :P10_ROW_VERSION:=l_version;
end;
```

## Extract selections into custom columns

```sql
select r.record_id,j.area_code,j.side_code,j.catalog_term_id,
       j.code,j.coding_system,j.recorded_label,t.external_id
from my_anatomy_records r
cross apply json_table(r.assessment_json,'$.sites[*]' columns (
    area_code varchar2(40) path '$.area',side_code varchar2(1) path '$.side',
    nested path '$.diagnoses[*]' columns (
        catalog_term_id number path '$.id',code varchar2(60) path '$.code',
        coding_system varchar2(40) path '$.system',recorded_label varchar2(400) path '$.label'
    )
)) j
left join ca3d_clinic_terms t on t.term_id=j.catalog_term_id
 and t.workspace_id=apex_custom_auth.get_security_group_id and t.application_id=:APP_ID
where r.workspace_id=apex_custom_auth.get_security_group_id
  and r.application_id=:APP_ID and r.owner_user=upper(:APP_USER);
```

Use $.complaints[*] for complaints. Table selections use source:CUSTOM and a numeric id, including seeded terms. TERM_ORIGIN distinguishes STARTER from LOCAL. A left join preserves historical findings if the current catalogue changes. For complete relational save/load, see [Relational storage](relational-storage.md).

## Patient sources and amendments

Patient Data Source still supports Page Item JSON, Static JSON, SQL JSON, PL/SQL JSON and None. Patient Items to Submit uses a multiple-item picker. Name and MR Number fallback items are optional when patient.name and patient.mrn are supplied. The public setContext patient API is removed; a Dynamic Action can populate the configured patient JSON item and call refreshContext(). Authorize Patient Access can run a server check before each patient-source read; the source query and custom save process must enforce access too.

Patient data loads normally without a refresh action or amendment dialog in the widget. A host application can call refreshContext() to refresh a saved snapshot and supplied values while keeping clinician answers/notes. Source None removes snapshot/provenance claims while retaining recorded values for review. Read-only refresh preserves the record. Patient/encounter changes are rejected. contextRefresh is application-submitted metadata; maintain the authoritative audit on the server.

## Upgrade from scoped catalogues

The installer removes Clinic Mode/Scope and diagnosis SQL attributes. This pre-production migration retains one row per exact duplicate term, combines anatomy links, updates term IDs and marker references in the supplied JSON/relational storage examples, and deletes duplicate rows. There are no alias IDs or alias columns. Back up custom stores and remap any IDs there before upgrading. [Catalogue schema](catalog-schema.md) describes the resulting base.

The obsolete scope columns and CA3D_CATALOG_SCOPES table are removed. Identical examination copies consolidate; distinct forms remain in one version history and can require explicit assessment review. Conflicting non-identical terms or custom foreign keys stop migration for reconciliation. The API signatures no longer accept catalogue scope or mode arguments. Update callers to the signatures shown in this guide. This demo upgrade does not constitute production approval.

Clinical accuracy, ICD redistribution permission, female reproductive coverage and physical-device/screen-reader validation remain separate release requirements.
