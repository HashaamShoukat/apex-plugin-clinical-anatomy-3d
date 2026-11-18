# Clinic workflow configuration

Every item shares the application?s diagnosis/complaint catalogue and examination form. Configure who can maintain it and whether examination is required.

Install `db/install.sql` in the parsing schema before enabling diagnosis suggestions, complaints or the examination. The install entry point includes `SKELETON3D_PKG`; then import `dist/plugin-installer.sql`. Choose CLOB session state for clinic items. Store the returned JSON in your application's visit record if needed.

| Builder setting | Values and purpose |
| --- | --- |
| Clinic Permissions (15) | TERMS allows new diagnoses and complaints for selected anatomy. EXAM_SETUP allows form configuration. Both require the condition in attribute 19. |
| Initial Examination (16) | OFF, OPTIONAL, or REQUIRED. Required fields are checked in the browser and again on the APEX server. |
| Anatomy Tools (17) | Independently enable isolation, opacity, labels/search, individual parts, point/area markers, tissue layers, certainty, finding state, undo, PNG export, and cross-section. |

Enable Diagnosis Suggestions and Common Complaints as needed. Grant TERMS only to authorized catalogue maintainers. Starter and locally added terms use the same base; there are no per-item scopes or alternate SQL diagnosis sources.

An authorized maintainer selects an organ, bone, structure or area. Add clinic diagnosis / Add clinic complaint saves a reusable term and selects it. A term can apply to the whole area or the selected structure. Existing terms appear again for the matching anatomy and can be searched. The same normalized name within the application, kind, specialty and coding system reuses its table ID. Complaints and diagnoses have independent IDs and kinds.

The focused examination starter contains Vital signs, Physical examination and Risks and individual needs. It opens from the model command bar as a popup. Physical outcomes and other short lists use pills. History, medication review and care planning can be supplied by the host application or added through a custom shared form. Abnormal findings and identified risks require notes. Numeric entry bounds catch impossible input and do not calculate clinical risk or prescribe treatment. No field is automatically marked Normal.

The public JCI 8th-edition hospital standards informed the broader clinical documentation categories (AOP.01.00–01.05, AOP.02.00 and COP.01.01). This is a configurable documentation starter, not an accreditation certification or a validated screening instrument. Hospital clinical governance must approve the fields, population-specific screening tools, timing, escalation and reassessment policy. [Official JCI standards overview](https://digitalassets.jointcommission.org/api/public/content/79e9f5d2cd444a1a9178ab3f9487889a?v=4d4ea7b7).

Existing configured forms are preserved. In **Configure examination**, choose **Use clinical assessment starter** to review and save the new starter explicitly. Fields support assessments, selection lists, long text, numbers, text and checkboxes, section grouping, required status, units, numeric bounds and values that require notes. A selection list uses one `VALUE|Label` per line.

Form definitions are versioned to detect conflicting configuration edits and stale submissions. When a form changes, reload and review before saving. The catalogue and examination form are shared by all items in the application. The item does not create patient history or visit comparison tables.

## Response

Existing simple selections keep `v:1`. Clinical fields use `v:2`. Custom terms use `source:CUSTOM`, a numeric `id`, `code`, `system` and `specialty`. Blank codes receive a stable DX-/CP- code. The ID references `CA3D_CLINIC_TERMS.TERM_ID`; older saved terms without a code still load. A custom record remains identified by its table ID even when it has a local or external classification code.

```json
{
  "v": 2,
  "sex": "M",
  "sites": [{
    "area": "HEART",
    "label": "Heart",
    "assessment": "ABNORMAL",
    "diagnoses": [
      {"code":"I50.9","label":"Heart failure, unspecified","system":"ICD-10","certainty":"provisional"},
      {"source":"CUSTOM","id":123,"code":"DX-0000000000000123","label":"Clinic diagnosis","specialty":"CARDIOLOGY","system":"CUSTOM","certainty":"unconfirmed"}
    ],
    "complaints": [{"source":"CUSTOM","id":124,"label":"Clinic complaint","system":"CUSTOM"}]
  }],
  "exam": {"template":"GENERAL","version":0,"answers":{"general":{"value":"NORMAL","note":""}}}
}
```

Certainty values are unconfirmed, provisional, differential, confirmed, and refuted. An empty certainty stays unrecorded. Finding states are NORMAL, ABNORMAL, and NOT_ASSESSED. Custom diagnosis and complaint IDs are validated against the server's workspace, application, term kind, label, and anatomy mapping.

Individual structures add `part` and `partName` while retaining the parent `area` and patient side. Markers use `kind:POINT` or `AREA`, local model-coordinate `points`, a label, and an optional diagnosis key (`CUSTOM|123` or `ICD-10|I50.9`). Store coordinates with the sex and model version. The current models are schematic, so markers are documentation anchors rather than measured anatomical positions.

`CA3D_CLINIC_TERMS` stores the dictionary, `CA3D_TERM_AREAS` stores area/part associations, and `CA3D_EXAM_DEFINITIONS` stores form configuration. `CA3D_CLINIC_CATALOG_V` exposes fixed relational columns from those same tables; see [Catalog schema and reporting query](catalog-schema.md). The plugin value contains the patient's selected complaints, diagnoses and examination responses. Its host application's normal submit process decides where that value is stored. Save in Session on the demo uses APEX session state only.

## Anatomy controls

Model controls expand above the canvas. Anatomy browser groups structures under body areas and organs, with search and buttons usable by touch or keyboard. Select a site before Isolate selected. Transparency reveals underlying structures. Structures adds heart chambers/valves, cornea/lens/retina and renal structures; the existing ear includes canal, ossicles and cochlea. Muscles, nerves and vessels add representative pathways and muscles. These are simplified models, not a complete anatomical atlas.

Enable Select individual structures to pick parts directly, or search for a named structure. Labels follow the camera. Point finding records a surface click. Outline an area records successive points on one site; Finish area closes an outline with at least three points. Each marker can be named and linked to a selected diagnosis. Cross-section has an adjustable depth. Reveal brings recorded anatomy back into view after a specialty, layer or isolation change. Undo is local to the current item session. Export annotated image downloads a PNG.

Drag or use arrow keys to rotate, pinch/scroll to zoom, and use Front/Back/Left/Right or Reset view to orient the model. Specialty presets provide close views of the relevant anatomy. All changes are optional settings; existing items need no configuration changes.

## Hospital catalog governance

Doctors select from the same approved application catalogue. Only designated maintainers should add terms or change the shared examination definition.

- Attribute 19, Shared Catalog Maintainer Condition, takes a server-side PL/SQL function body returning Boolean.
- The authorization-scheme setting (attribute 18) was removed. Existing attribute 18 values are ignored; attribute 19 keeps its number and existing condition.
- An empty condition, FALSE, NULL, or an evaluation error disables maintenance. `return true;` grants the selected maintenance actions to any signed-in user of that item. Use a role check when maintenance should be restricted.
- Clinic Permissions still controls which maintenance actions are available to an authorized maintainer. Examination responses and selecting existing diagnoses or complaints remain available to other doctors.

Checks run when rendering controls and again on every create/configure request. A forged browser permission or direct AJAX call cannot grant maintenance access. A page/item visibility condition is separate from this maintenance condition.

The page 401 source uses a condition that checks **CLINIC_CATALOG_ADMIN** (Clinical Catalog Administrator). No users are automatically assigned this role. Assign only approved terminology maintainers through APEX Access Control. Other doctors can select existing terms and complete the examination.

The condition alternative can use your existing hospital security package, for example:

```plsql
return apex_acl.has_user_role(
    p_application_id => :APP_ID,
    p_user_name => :APP_USER,
    p_role_static_id => 'CLINIC_CATALOG_ADMIN');
```

This centralizes naming decisions for Fever, Headache and similar terms. Exact repeated names already reuse their ID after case and whitespace normalization. Different clinical synonyms are maintained deliberately by the authorized catalog team.


## Finding the maintenance controls

With `return true;` and both Clinic Permissions checked, a **Shared clinic catalog** toolbar appears above the model. **Configure examination** is available even when Initial Examination is Off. **Add diagnosis** and **Add complaint** become available after selecting a site through the canvas, anatomy search or browser. The add dialog shows the selected anatomy and captures name, specialty, optional code and coding system. A selected part can be mapped specifically or to its parent area.


See [Workspace and JSON review](workspace-and-review.md) for drag resizing, required examination gating, finding removal, the Specialty Page Item option and read-only review.

## Save request validation

The browser examination check runs for all request names by default except CANCEL and DELETE. Set `options.skipValidationRequests` to an explicit uppercase list for other non-save actions, or `options.saveRequests` for an explicit save allowlist. Custom save button names are checked without additional configuration. Disabled and read-only items skip it. Server-side validation and save-process conditions remain the application's authority.

A failed examination load offers Retry. Check that CA3D_CLINIC_API is installed and VALID if the service is unavailable. A failed Required examination continues to gate new findings until a retry succeeds and the examination is completed.

## Catalog recovery and definition history

Adding a term with the same specialty, kind, name, code and coding system as an inactive term restores its existing catalog ID and adds the selected anatomy link. Existing names with different codes remain conflicts.

Clinic-term requests are cached for 60 seconds per anatomy, part, specialty, kind and query. Successful term creation invalidates that widget's cache. Failed requests are immediately retryable, and standard diagnosis suggestions remain available during clinic outages.

Examination definitions support at most 50 fields and 32767 characters, with typed booleans, numeric limits and bounded note conditions. Saving an unchanged definition keeps its current version. For parsing-schema maintenance after archiving older forms, CA3D_CLINIC_API.PRUNE_EXAM_HISTORY(keep_versions) retains the newest versions for the current workspace/application. At least two must be retained; the default is 20. It does not commit. This maintenance routine is not exposed through item AJAX actions.

## Shared catalogue

See [the integration guide](integration-guide.md) for required versus sample objects, catalogue maintenance and custom JSON storage. Clinic Mode, Catalogue Scope and external diagnosis SQL were removed in 1.9. The pre-production upgrade remaps stored demo references and deletes duplicate term rows.
