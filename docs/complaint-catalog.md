# Common complaint starter catalog

The starter seed has 77 symptom/documentation shortcuts. Coverage is checked across all ten specialty presets:

| Specialty | Choices |
| --- | ---: |
| General medicine | 77 |
| ENT | 19 |
| Ophthalmology | 11 |
| Cardiology | 5 |
| Urology | 11 |
| Internal medicine | 33 |
| Gastroenterology | 11 |
| Neurology | 18 |
| Pulmonology | 10 |
| Orthopedics | 26 |

The previous list contained mostly musculoskeletal pain. Gastroenterology therefore had no matches and pulmonology/urology had only one. Respiratory, digestive, urinary, ENT, eye, cardiac and neurological symptom labels now have anatomical choices and searchable aliases. Specialty tags keep unrelated shortcuts out of specialty views. Neurology includes limb areas for numbness, weakness and tremor.

Shortcuts document a selected complaint; they do not assign a diagnosis or infer its cause. When several sites or sides are possible, the existing chooser asks the user. The application's anatomical associations require clinical review. Installed starters and newly added complaints use CA3D_CLINIC_TERMS with TERM_KIND = COMPLAINT and the same anatomy link table. Use EXTERNAL_ID for internal mappings. See [the integration guide](integration-guide.md).

New table selections preserve the numeric catalogue id, code, label, source CUSTOM and COMPLAINT system in the site JSON, including Standard mode. Existing BUILTIN complaint codes remain readable. Existing codes and saved values remain supported. A selected complaint can be removed and restored from saved JSON.

The starter wording was checked against primary patient-information sources:

- [NHLBI: respiratory symptoms](https://www.nhlbi.nih.gov/health/asthma/symptoms)
- [MedlinePlus: digestive symptoms](https://medlineplus.gov/ency/article/007447.htm)
- [NIDDK: urinary symptoms](https://www.niddk.nih.gov/health-information/urologic-diseases/bladder-control-problems/symptoms-causes)
- [NIDDK: flank pain and blood in urine](https://www.niddk.nih.gov/health-information/urologic-diseases/kidney-stones/symptoms-causes)
- [NEI: eye discomfort, redness, blurred vision and light sensitivity](https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/dry-eye)
- [NHLBI: palpitations](https://www.nhlbi.nih.gov/health/arrhythmias/symptoms)
- [VA/DoD: tinnitus, hearing and balance symptoms](https://www.healthquality.va.gov/guidelines/CD/tinnitus/VADoD-CPG-Tinnitus-Patient-Summary-2024_Final_508.pdf)

Reason quick picks are small underlined actions below the note field. Choosing one preserves existing text and remains editable. Their button semantics support keyboard activation while their appearance matches links.
