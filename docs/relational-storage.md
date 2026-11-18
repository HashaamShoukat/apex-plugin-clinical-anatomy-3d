# Saving into application tables

The item returns JSON as its transport format. APEX processes can extract that document into application columns, and dashboards can query those columns directly. [003_relational_store.sql](../db/003_relational_store.sql) implements a complete optional example.

| Table | Data |
| --- | --- |
| `CA3D_ASSESSMENTS` | Encounter reference, specialty, model sex, examination header, ownership, row version, timestamps, patient context, the last context amendment note and optional full JSON snapshot |
| `CA3D_SITES` | Area, side, bone, structure, assessment, pain and note |
| `CA3D_SITE_TERMS` | Diagnoses and complaints with coding system, code, catalog ID, label and certainty |
| `CA3D_MARKERS` | Finding identifier, kind, label and diagnosis link |
| `CA3D_MARKER_POINTS` | Ordered XYZ coordinates |
| `CA3D_EXAM_ANSWERS` | Field ID, typed value, deferral, note and prefill history |

Install `db/install.sql`, then install `db/003_relational_store.sql` once in a development schema. The example uses Oracle JSON features documented for Database 19c and requires the plug-in packages for APEX 26.1 or later.

## APEX save process

Configure `P10_ANATOMY` with CLOB session state. Add hidden Number items `P10_ASSESSMENT_ID` and `P10_ROW_VERSION`. Populate both when editing an existing assessment. Start both empty for a new assessment.

```sql
declare
    l_id number := :P10_ASSESSMENT_ID;
    l_version number := :P10_ROW_VERSION;
begin
    -- Resolve and authorize the encounter using the application's data model.
    ca3d_relational_api.save_assessment(
        p_id            => l_id,
        p_version       => l_version,
        p_payload       => apex_session_state.get_clob('P10_ANATOMY'),
        p_encounter_ref => :P10_ENCOUNTER_REF,
        p_specialty     => :P10_SPECIALTY,
        p_keep_json     => true,
        p_exam_mode     => 'OPTIONAL'
    );
    :P10_ASSESSMENT_ID := l_id;
    :P10_ROW_VERSION := l_version;
end;
```

Use the item's actual examination mode; the catalogue is shared automatically. Keep these settings under server control. `REQUIRED` applies required-field rules. `OPTIONAL` checks supplied answers and configured note requirements. `OFF` still validates structure, shared catalog membership and any stored examination answers, including retired keys.

Set `p_keep_json => false` to save relational data with an empty snapshot column. `load_json` reconstructs the item document from the tables in either mode. When retained, `RELOAD_JSON` holds the original submitted document.

The API validates the payload before changing rows. Updates require the current row version. Parent and child merges run within a savepoint, and a failure rolls back that operation. Transaction completion belongs to APEX. An explicit document containing `sites: []` clears saved sites. This sample rejects an empty item value so clearing is explicit.

A null assessment ID creates a new assessment. Subsequent saves use the returned ID and version. Updates preserve site IDs by canonical site key, selected-term IDs by term key and marker row IDs by marker ID. Markers without an ID use their original array position. Removed children are deleted. A unique index on workspace, application, owner, encounter and specialty prevents double-submit duplicates; the example permits one assessment per encounter and specialty. Repeated assessments require a host-specific request/assessment key instead. Existing duplicate rows must be reconciled before upgrading; the installer never deletes them.

The example scopes access to the current workspace, application and account. Replace `encounter_ref` with the application's encounter relationship and clinical-access checks. Shared-team and patient access belong to the host application's authorization model.

## Load and edit

```sql
begin
    apex_session_state.set_value(
        'P10_ANATOMY',
        ca3d_relational_api.load_json(:P10_ASSESSMENT_ID)
    );
end;
```

Populate the current version and specialty when opening an editable record.

```sql
select row_version, specialty_code
  into :P10_ROW_VERSION, :P10_SPECIALTY
  from ca3d_assessments_v
 where assessment_id = :P10_ASSESSMENT_ID;
```

The generated JSON also works with `apex.item('P10_ANATOMY').setValue(...)` and `skeleton3d.get('P10_ANATOMY').load(...)`. Use the native APEX Read Only condition for review.

## Dashboard queries

Count abnormal sites by specialty and anatomy.

```sql
select specialty_code, area_code, side_code, count(*) as abnormal_sites
  from ca3d_findings_v
 where assessment_state = 'ABNORMAL'
 group by specialty_code, area_code, side_code;
```

Count diagnoses with their coding systems and certainty.

```sql
select coding_system, term_code, term_label, certainty,
       count(*) as diagnosis_count
  from ca3d_diagnoses_v
 group by coding_system, term_code, term_label, certainty;
```

Read numeric vital signs directly.

```sql
select a.encounter_ref, e.field_id, e.value_number, e.deferred_flag
  from ca3d_assessments_v a
  join ca3d_exam_answers e on e.assessment_id = a.assessment_id
 where e.field_id in ('pulse', 'temperature', 'spo2')
   and e.value_type = 'NUMBER';
```

Units come from the configured examination definition. Longitudinal applications should retain its versioned definition or store units alongside values. The findings view has one row per site. The diagnoses view has one row per diagnosis. Use `count(distinct site_id)` to count sites through the diagnosis view.

## Map into existing custom tables

Adapt the target columns below to the application's schema. Resolve encounter authorization and call `SKELETON3D_PKG.VALIDATE_PAYLOAD` first. Applications using custom terms or examinations also call `CA3D_CLINIC_API.VALIDATE_VALUE` with the configured examination mode.

```sql
insert into visit_anatomy_site (
    encounter_id, area_code, side_code, part_code, pain_score, note_text
)
select :P10_ENCOUNTER_ID, j.area_code, j.side_code, j.part_code,
       j.pain_score, j.note_text
  from json_table(
       apex_session_state.get_clob('P10_ANATOMY'),
       '$.sites[*]' error on error
       columns (
           area_code varchar2(40) path '$.area',
           side_code varchar2(1) path '$.side' null on empty,
           part_code varchar2(100) path '$.part' null on empty,
           pain_score number path '$.pain' null on empty,
           note_text varchar2(2000) path '$.note' null on empty
       )
  ) j;
```

Project diagnoses and complaints separately to retain their parent site and avoid multiplying arrays. Pair codes with their coding systems. Preserve zero pain, boolean false, null answers and documented deferrals. The full example implements these mappings and reloading. [Oracle JSON_TABLE reference](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/JSON_TABLE.html)

## Patient snapshots and source history

Patient snapshots use CONTEXT_JSON and answer provenance uses PREFILL_JSON. They are mandatory stored metadata when present, independent of p_keep_json. The installer adds these columns without replacing existing data and backfills metadata from older reload_json copies where available. Metadata already discarded by an older save without a JSON copy cannot be recovered by this migration.

For a payload containing a patient snapshot or prefill history, pass p_patient_context from an authorized server query, plus p_context_options matching the item configuration. The API compares the submitted snapshot and prefill history with that source. It also enforces patient sex supplied by the source. Pass p_patient_sex when sex is maintained separately on the server. Never pass request JSON as either trusted argument. Sources used for editing historical records must return the authorized recorded snapshot and observations for that encounter.

The optional p_specialty parameter constrains every saved site's area. For an assessment spanning specialties, use ALL. Bone and part identifiers must belong to the site's area and side.
