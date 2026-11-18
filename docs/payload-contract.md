# Returned JSON contract

The item value is a JSON string. `skeleton3d.get(itemName).value()` returns the equivalent object. An empty item has the value `""`. Applications can retain a CLOB snapshot and extract fields into relational tables. [Save/load example](relational-storage.md)

```json
{
  "v": 2,
  "sex": "F",
  "sites": [{
    "area": "KIDNEY",
    "side": "L",
    "label": "Left kidney",
    "pain": 0,
    "note": "Fictional finding",
    "assessment": "ABNORMAL",
    "diagnoses": [{
      "code": "N20.0",
      "system": "ICD-10",
      "label": "Calculus of kidney",
      "certainty": "provisional"
    }],
    "complaints": [{
      "source": "BUILTIN",
      "code": "FLANK_PAIN",
      "system": "COMPLAINT",
      "label": "Flank pain"
    }],
    "markers": [{
      "id": "renal-finding-1",
      "kind": "POINT",
      "points": [[0.072, 1.18, -0.064]],
      "label": "Renal finding",
      "diagnosis": "ICD-10|N20.0"
    }]
  }]
}
```

## Fields and identity

| Field | Meaning |
| --- | --- |
| `v` | Payload format version, currently 1 or 2 |
| `sex` | Recorded model sex: `M`, `F` or `U` (unconfirmed) |
| `sites` | Ordered anatomy selections, retained across specialty changes |
| `area` | Area code such as `KNEE`, `HEART` or `KIDNEY` |
| `side` | Patient's `L` or `R`, omitted when unspecified or unpaired |
| `bone`, `boneName` | Optional bone code and name |
| `part`, `partName` | Optional individual structure code and name |
| `label` | Derived display label |
| `pain` | Numeric score from 0 to 10, omitted when unrecorded |
| `note` | Free text, up to 2000 characters in the editor |
| `assessment` | `NORMAL`, `ABNORMAL` or `NOT_ASSESSED`, omitted when unrecorded |
| `diagnoses`, `complaints` | Selected coded or custom terms |
| `markers` | Point or outline findings in model coordinates |
| `exam` | Optional examination header and keyed answers |

Use codes for joins and labels for display. Site identity follows `P|part|side`, `P|bone|side` or `A|area|side`, in that precedence. An omitted side has an empty final component and carries no bilateral assertion.

Coded term identity combines coding system and code. Custom terms include `source: "CUSTOM"` and a positive safe-integer database `id`. Their identity is `CUSTOM|id`. Optional fields include code, system and specialty. Custom IDs require server validation against workspace/application ownership, term kind and anatomical mapping.

Certainty supports `unconfirmed`, `provisional`, `differential`, `confirmed` and `refuted`. Missing certainty stays unrecorded.

Markers use `POINT` or `AREA`, finite XYZ triples, an optional identifier and a label. An outline requires at least three points. Loading accepts at most 100 points per marker. A diagnosis link references a diagnosis at the same site. Coordinates use local procedural-model space. The payload currently has no dedicated model-revision field. Retain the plugin/model revision alongside long-lived spatial annotations.

Examination answers preserve scalar types.

```json
{
  "template": "GENERAL",
  "version": 0,
  "profile": "GENERAL_EXAM_2026_2",
  "answers": {
    "pulse": { "value": 72 },
    "general": { "value": "NORMAL" },
    "qa_checkbox": { "value": false },
    "temperature": { "deferred": true, "note": "Measurement unavailable" }
  }
}
```

Actual fields and outcomes come from the configured form. The checkbox illustrates JSON typing. Zero and false remain recorded values. A deferral retains its boolean and reason. Store the form version with the answers and retain its unit definitions.

## Loading and validation

The local review patch validates the complete document before replacing state. Invalid JSON, unsupported format versions, duplicate sites, invalid terms and malformed markers throw from `load`, preserving the previous value. Invalid initial data remains in the underlying item and exposes a validation message. A valid load clears that message.

External loading clears the previous record's undo history, unfinished outline, isolation and diagnosis cache. `load` raises native change and `skeleton3dchange` events. APEX's `setValue` wrapper controls native event suppression through its usual third argument. [Oracle APEX item API](https://docs.oracle.com/en/database/oracle/apex/24.2/aexjs/item.html)

Restoration derives site labels, normalizes custom IDs to numbers and rounds marker coordinates to five decimal places. Missing version and sex remain accepted for legacy data. Exported values contain the supported clinical fields. Keep patient ID, encounter ID, authorship, timestamps and specialty in the application's own record.

`SKELETON3D_PKG.VALIDATE_PAYLOAD` checks structure in every item mode. The item callback also checks catalog ownership when custom terms appear in Standard mode. Processes saving outside normal item submission can invoke the structural and clinic validators explicitly.

Structural validation checks supported areas, types, lengths, enums, duplicate identities and marker links. Application diagnosis authority, detailed part-to-area mappings, clinical access and model-revision compatibility require domain-specific rules.

## Payload bounds

Client and server validators allow up to 1,048,576 JSON characters, 500 sites, 100 diagnoses and 100 complaints per site, 100 markers per site, 100 points per marker, 100 examination answers and 2,000 characters per examination value. Field-specific note and context limits also apply. Pain values from 0 to 10 retain their numeric precision when loaded. A bone and a part with the same identifier and side identify the same finding. A prostate finding requires the male model. Marker diagnosis references support up to 160 characters, matching relational storage. The server also verifies configured sex, specialty, and bone/part membership.

## Context amendment note (1.8)

Optional contextRefresh contains at (up to 100 characters), note (up to 500), and previousSex (M/F/U). The explicit patient refresh action supplies this note. It is submitted metadata; persist an authoritative server-side audit separately. Table-backed starter and local terms both use source CUSTOM with their numeric catalogue id. Retired examination answer keys are rejected against the configured definition.
