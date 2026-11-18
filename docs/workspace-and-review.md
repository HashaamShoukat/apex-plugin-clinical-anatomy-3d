# Clinical Anatomy 3D workspace

Clinical Anatomy 3D is the display name. The static plugin ID, `skeleton3d` JavaScript API and existing JSON formats remain compatible.

## Layout and examination

The command bar contains specialty, Anatomy/Skeleton/Organs and Initial examination. Below Area/Bone in the viewer, Isolate selected, Full anatomy, Anatomy browser and Show/Hide controls remain accessible. Isolated-organ details and structure inspection also stay inside the viewer header.

Model controls and Anatomy browser open in the right pane beside the model. Each scrolls independently and replaces findings while open; Close, Escape or Findings returns to findings. The browser supports grouped anatomy, structure search and an empty-results message. Expanding every group does not increase the viewer or page height. On phones, the pane sits below the model with a bounded height. Desktop height follows the Height attribute. At phone widths (600px or less), the same specialty, layer, search, view, appearance and selection controls move into an Anatomy controls disclosure that starts closed. Open it to adjust the viewer or search; Escape closes it and returns keyboard focus. The body appears first, with height adapted to leave room for bottom navigation (240px minimum). Scrolling does not resize the model.

Drag the divider between the model and right pane to resize both; keyboard arrows also adjust it and double-click resets it. The preference is stored locally and does not change the patient JSON.

The examination opens as a modal dialog and the starter contains only Vital signs, Physical examination, and Risks & individual needs. Physical assessments use Normal/Abnormal pills. Short selection lists also use pills. Deferred fields keep the popup open and require a reason. Nothing is automatically recorded as Normal. Existing configured definitions remain available; use Configure examination → Use clinical assessment starter to replace one explicitly.

When Initial Examination is Required, the model shows a completion prompt. Anatomy selection, new findings and selection APIs are blocked until the required answers and conditional notes are complete. The APEX server also validates the examination on submit. A read-only review can display an existing record without requiring a new examination.

Static styling lives in `src/skeleton3d.css` and the standalone page styling in `demo/demo.css`. Runtime CSS variables are used for the drag ratio, configured canvas height and projected 3D label coordinates. The demo item's APEX label uses the hidden label template; its accessible name remains available. The JSON preview has a stylesheet class instead of page-inline CSS.

## Saving and reopening a record

The host application stores the plugin JSON in its patient/visit record, normally in a CLOB column. For a later visit or review, use that JSON as the APEX item's source value. The initial render restores sites, sex, diagnoses, complaints, notes, assessment states, markers and examination answers. It highlights recorded anatomy and opens the first recorded site. Recorded findings hidden by a specialty/layer can be revealed with the existing Reveal action.

For an already rendered item:

```js
apex.item("P400_ANATOMY").setValue(savedJson);
```

The plugin API also accepts a JSON string or an object:

```js
const anatomy = skeleton3d.get("P400_ANATOMY");
anatomy.load(savedRecord);
anatomy.setReadOnly(true);
```

APEX's standard item Read Only condition is supported on initial render. An initially read-only item cannot be unlocked through the initialization callback or mutation APIs. Runtime read-only mode suppresses maintenance and data editing, disables finding/examination inputs and blocks mutation APIs. Rotation, zoom, layer changes, panel resizing, focusing recorded findings and PNG export remain view operations. A host can still load another record through `setValue`/`load` while in review mode. The demo's Save in Session remains session storage; it does not create a patient-history table.

## Findings and outlines

Each saved marker has a visible Remove action in edit mode, including markers belonging to an inactive site. Removing a diagnosis also clears its marker links. Clear state removes the site's recorded Normal/Abnormal/Not assessed state. Read-only mode does not expose these actions.

Point finding records one surface click. Outline an area collects at least three surface points on the same anatomical site. Finish outline is shown only in outline mode and remains disabled until three points exist. The point count/instruction and Cancel outline make the pending operation explicit. Finish stores an AREA marker; Cancel discards the pending points. The surfaces and coordinates remain schematic documentation anchors, not measurements.

## Specialty from another item

Set **Specialty Page Item** (attribute 20) to a page item containing `ALL`, `ENT`, `CARDIOLOGY`, `UROLOGY`, or another supported specialty code. Its session value takes precedence over static Specialty on render. Client-side changes to that source item update the viewer. Disable Specialty Switch to prevent manual preset selection.

```js
apex.item("P400_SPECIALTY").setValue("CARDIOLOGY");
```

For standalone initialization, use `specialtyItem: "P400_SPECIALTY"`. Preset/layer changes preserve the patient's recorded sites.

## Male and female models

The procedural skeleton changes pelvis width/height, hip and knee spacing, shoulder/rib-cage proportions, bone thickness, skull/jaw shape, brow and chin in addition to overall scale. The organ layer changes the urethral path and includes the prostate on the male model. These are simplified procedural variants and do not constitute a complete reproductive anatomy model.
