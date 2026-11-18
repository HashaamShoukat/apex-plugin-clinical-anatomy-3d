# Shared catalogue tables

Every anatomy item in an APEX application uses one shared catalogue. There are no item scopes or Clinic Mode settings. Workspace and application ownership still isolate installations.

| Object | Purpose |
|---|---|
| CA3D_CLINIC_TERMS | Diagnoses and complaints in the same master table; TERM_KIND distinguishes them. |
| CA3D_TERM_AREAS | Organ/area/part mappings for each term. A term can have multiple mappings. |
| CA3D_EXAM_DEFINITIONS | Versioned history of the application's shared examination form. |
| CA3D_CLINIC_CATALOG_V | One row per term/anatomy mapping, for reporting and administration. |
| CA3D_CLINIC_API | Search, creation, form configuration and server validation. |

There is no catalogue-scope table or CATALOG_SCOPE column in the current schema.

TERM_ID is the stable numeric identity. LABEL, TERM_CODE, CODING_SYSTEM, TERM_KIND, SPECIALTY_CODE, ACTIVE_YN and anatomy links control choices. KEYWORDS provides search aliases; SPECIALTY_FILTER optionally restricts one shared term to several specialty presets. EXTERNAL_ID maps to the host system's ID. Add additional nullable mapping columns if needed; keep TERM_ID stable.

Use the same table for new diagnoses and complaints. An authorized user's Add diagnosis / Add complaint action inserts a master row and the selected anatomy link. Entries are available throughout the application. Database-admin changes appear after refreshing the viewer or its 60-second search cache expires.

Example administration/report query:

```sql
select id,kind,name,code,coding_system,external_id,area_code,part_code
from ca3d_clinic_catalog_v
where workspace_id=apex_custom_auth.get_security_group_id
  and application_id=:APP_ID
  and active_yn='Y'
order by kind,name,area_code,part_code;
```

The reporting view uses the same master rows. Keep the workspace/application filters and your administrative access checks.

## Removing the former demo scopes

Earlier demo releases stored duplicate starter rows in CLINIC and SK3_DEMO. The pre-production consolidation retains one master row, combines anatomy mappings, rewrites duplicate IDs and marker references in the supplied storage examples, and deletes the duplicate rows. It leaves no alias IDs or mapping column. Custom tables holding old IDs must be remapped before this upgrade.

Query the base table directly or use CA3D_CLINIC_CATALOG_V. Join TERM_ID to EXTERNAL_ID to find your internal code. Different records that conflict on code/name are reported before consolidation. Retained deactivated entries stay inactive.

Identical copied examination forms consolidate into one. Different forms remain in the shared version history; old assessments may require explicit form review. Version zero is retained as the one-time catalogue initialization marker, so no separate initialization table is needed.
