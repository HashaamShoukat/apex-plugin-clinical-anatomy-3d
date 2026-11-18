# Patient identity and observations

Supply one JSON object containing the patient, recording information and observations. Choose **Patient Data Source** in Oracle APEX. Every method accepts the same payload.

| Source | What to provide |
|---|---|
| Page Item containing JSON | A hidden, text or textarea item populated by SQL, PL/SQL, a Dynamic Action or other application code. Select that item in Patient & Observations Item. |
| Static JSON | Paste the object into Patient JSON. |
| SQL Query returning JSON | Zero or one row with exactly one VARCHAR2/CLOB JSON column. Use `JSON_OBJECT ... RETURNING CLOB`; SQL NULL or no rows means no live data. |
| PL/SQL Function returning JSON | A function body that returns the JSON text/CLOB, up to 32767 characters. |
| No live patient source | Omit live data; recorded snapshots can still appear when reviewing a saved record. |

Copy these complete, fictional examples and replace their values or page-item binds with your authorized patient/encounter source:

- [Full JSON payload](examples/patient-payload.json): every supported field, preset measurements, a custom observation and custom patient details.
- [SQL query](examples/patient-source.sql).
- [PL/SQL function body](examples/patient-source.plsql).
- [Dynamic Action using the selected patient JSON item](examples/patient-source.js).

## Payload fields

All top-level sections are optional. Put name, MR number and age in `patient`, alongside the observations in the same object. The separate Name/MR Item settings are display fallbacks for Page Item sources. Server JSON, SQL and PL/SQL sources must supply authoritative identity values directly.

| Section/key | Accepted value |
|---|---|
| `patient.name`, `patient.mrn` | Text, up to 200 characters. |
| `patient.id`, `patient.sex`, `patient.dateOfBirth`, `patient.encounterId` | Display text, up to 100 characters each. Dates are displayed as supplied. |
| `patient.age` | Number of years, 0–150. Supply the age; the plug-in does not calculate it from date of birth. |
| `patient.details` | Up to 12 custom facts shown in Details: unique `id`, `label`, scalar `value`, optional `unit`. String values support 400 characters. |
| `recording` | Shared `source`, `recordedBy` and `recordedAt` defaults, up to 120 characters each. Observations may override them. |
| `observations` | Up to 40 uniquely identified observations. See below. |

An observation requires `id` and `value`. IDs begin with a letter and contain only letters, digits and underscores, up to 64 characters. Values can be a finite number, text (up to 200 characters), boolean or null. Null/empty values appear as **Not recorded** in Details and never prefill examination answers. Booleans display as Yes/No. The whole payload is limited to 32767 characters.

| Optional observation key | Meaning |
|---|---|
| `label` | Display label, up to 120 characters; preset labels are used when omitted. |
| `unit` | Supplied unit, up to 40 characters. Preset units are used when omitted; an empty string suppresses the default. No unit conversion occurs. |
| `flag` | Your supplied status text, up to 40 characters. Nonempty flags other than NORMAL highlight the card. |
| `highlight` | Boolean; explicitly highlights the supplied value. No clinical thresholds are inferred. |
| `hidden` | Boolean; hides it from the summary and Details. An enabled saved snapshot still includes it. |
| `note` | Additional text shown in Details, up to 500 characters. |
| `source`, `recordedBy`, `recordedAt` | Recording information, up to 120 characters each; overrides shared defaults. |
| `examField` | Configured examination field ID to prefill; otherwise the observation ID is used. |
| `readOnly` | Boolean; locks the imported examination value and deferral control while leaving notes available. |

Custom observation IDs and labels are supported. These presets provide default labels and units:

| ID | Label | Default unit |
|---|---|---|
| `bp_systolic` | Systolic BP | mmHg |
| `bp_diastolic` | Diastolic BP | mmHg |
| `pulse` | Pulse | beats/min |
| `respiratory_rate` | Respiratory rate | breaths/min |
| `temperature` | Temperature | °C |
| `spo2` | Oxygen saturation | % |
| `weight` | Weight | kg |
| `height` | Height | cm |
| `bmi` | BMI | kg/m² |
| `glucose` | Blood glucose | mmol/L |
| `pain` | Pain score | /10 |

## Display & Prefill Options (formerly Context Options)

These are settings, not patient values. Leave `{}` for defaults.

| Option | Default | Effect |
|---|---|---|
| `fields` | All supplied fields | Choose from name, mrn, id, age, sex, dateOfBirth, encounterId, details, observations. Custom details appear in the dialog. |
| `labels` | Standard labels | Rename identity labels, for example `{"mrn":"MRN"}`. |
| `observationIds` | All supplied observations | Filter which observation IDs appear in the summary and Details. |
| `maxVisibleObservations` | 6 | Show 1–12 measurement cards above the viewer. Paired BP counts as one card. Remaining observations stay in Details. |
| `prefillExam` | true | Fill empty, matching examination fields. False displays observations without filling answers. |
| `lockPrefilled` | false | Lock all imported examination values; individual rows can use readOnly. Notes remain editable. |
| `saveContext` | false | Save the complete patient/observation snapshot inside the anatomy JSON. |
| `patientDataRequired` | false | Block editing and saving if the configured patient source is unavailable. |

Example: keep the default display and save a snapshot:

```json
{"saveContext":true}
```

Example: show selected identity fields and measurements, with a custom MR label:

```json
{
  "fields": ["name", "mrn", "age", "sex", "details", "observations"],
  "labels": {"mrn": "MRN"},
  "observationIds": ["bp_systolic", "bp_diastolic", "pulse", "temperature", "weight"],
  "maxVisibleObservations": 6,
  "prefillExam": true,
  "lockPrefilled": false,
  "saveContext": true
}
```

Use JSON booleans, not quoted strings. Invalid or unknown settings show a configuration message. Display filters do not remove hidden data from saved snapshots. A loaded historical snapshot takes precedence for display. If current source values are needed, the host application can call refreshContext() before saving. The widget has no separate refresh button or amendment dialog. With new snapshots off, prefilled examination answers and their recording provenance are still saved.

## Prefill and refresh

Prefill matches `examField` (or `id`) to a configured examination field, requiring the same unit and valid field type/range/selection. Existing answers, notes and deferrals are preserved. The plug-in never marks an assessment normal from vital signs. Examination mode OFF only displays observations. Editing an unlocked examination value removes its prefill marker and does not rewrite the supplied observation.

SQL and PL/SQL support page/application item binds. List changing page items in **Patient Items to Submit**, then run this in a Dynamic Action after input changes:

```js
await skeleton3d.get('P402_ANATOMY').refreshContext();
```

Page-item JSON sources refresh on change. Clear or load the correct assessment before switching patients; refresh preserves existing answers and historical snapshots. Source failures display a retryable warning. Findings without patient snapshots or prefill claims can still be saved by default. Set patientDataRequired to true to require the source; saved snapshots and prefill claims always require successful server verification. The host application remains responsible for patient access and record authorization.

Single/double-click selection affects the 3D model. Search, browser and explicit action buttons use one activation; dragging never selects. The Save to Table example uses fictional data and requires a title and at least one selected anatomical site.

## Source authorization

Patient SQL and PL/SQL sources must enforce access for the authenticated user on every render and refresh. Submitted page items are caller-controlled inputs. Protect identifiers with the application's session-state controls and check patient/encounter access in the server query. The host application is responsible for authorization and auditing.

## Server verification

APEX saves re-read the configured Static JSON, SQL or PL/SQL patient source. Submitted patient identity, observations and recording details must match its normalized snapshot. Prefill source details and values must match the server observation; removing a lock, deleting a locked answer or changing its value is rejected. Editing an unlocked answer clears its prefill marker and remains allowed.

Page Item sources provide display data. In APEX they do not prefill examinations, and client-only snapshots or prefill history require an authoritative server source before saving. Use an authorized SQL or PL/SQL source for clinical snapshots. The former JavaScript/API patient source was removed.

Historical sources should return the recorded, authorized encounter snapshot when editing an existing assessment. A changed source triggers an explicit reload/review error instead of silently rewriting history. Protect source query parameters and check patient/encounter access using authenticated server context.

The source patient.sex controls the recorded model when present. Otherwise the configured model or Sex Page Item supplies it. M/Male and F/Female are recognized; other values remain U (unconfirmed), with a visible warning and sex-specific anatomy unavailable. Editable APEX items lock the model to that server value. Read-only review restores the sex stored in the historical record. The standalone API also accepts U and never defaults an unknown value to male.

## Snapshot amendments and source changes

The application can call refreshContext() when it needs to refresh a saved snapshot and supplied prefill values. The widget adds no extra action button or reason dialog. Clinician-entered answers and notes are preserved. Source None removes snapshot/provenance claims while keeping values for review. Read-only refresh never changes the document. Patient/encounter identity changes are rejected, and incompatible findings must be removed before a sex correction. Host applications own authorization and audit logging. See [the integration guide](integration-guide.md#patient-sources-and-amendments).

Name Item and MR Number Item are optional legacy fallbacks for missing identity keys in a Page Item source. Leave both blank when patient.name and patient.mrn are supplied. Patient Items to Submit uses the multiple-item picker. The JavaScript/API source and setContext method were removed in 1.8.
