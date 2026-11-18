# Diagnosis catalogue

In APEX, the default source is CA3D_CLINIC_TERMS (TERM_KIND = DIAGNOSIS), linked through CA3D_TERM_AREAS. Starter and added entries share these tables. Edit database rows or use authorized Add diagnosis; no JavaScript edits are needed. EXTERNAL_ID maps terms to host IDs. Add approved entries to the same table; there is no separate SQL diagnosis source. See [the integration guide](integration-guide.md).

The original catalog had 186 entries associated with body areas. When organ anatomy was added, the new organ identifiers had no diagnosis mappings. Selecting HEART therefore produced an empty list even though the selection and lookup code worked.

The catalog now includes 144 verified organ code records covering all 25 organ areas. Entries already present in the original catalog acquire the additional organ association. A code appears once in the combined catalog, and existing saved values retain their labels and coding system.

Codes and titles seeded from `src/catalog-seed.json` were checked against the terminal entries in WHO's ICD-10 2019 English tabular release, including the updates distributed with that release. The selected entries, organ associations and search aliases form an application starter catalog. The underlying WHO code titles are preserved. [WHO download page](https://icdcdn.who.int/icd10/index.html), [tabular release](https://icdcdn.who.int/icd10/meta/icd102019enMeta.zip).

Anatomical associations and search aliases were chosen for this application. They require clinical review for a hospital's workflow. Use the shared tables to supply the hospital's approved catalogue, classification version and coding system.

For example, the heart list includes ischemic disease, arrhythmias, valve disorders, cardiomyopathy, pericarditis, endocarditis and heart failure. These are catalog entries available for explicit selection. Their order follows the configured catalog.

The list distinguishes three empty states. A site can have no configured entries, a text filter can match no entries, or every available entry can already be selected. Each state now has its own message, and a text filter remains available when its results are empty.

The diagnosis regression suite checks coverage of all 25 organs, uniqueness of codes, valid area mappings, heart diagnosis selection and persistence, specialty filtering and mobile layout. Run it with `node qa/diagnoses.mjs`, or run all suites with `npm test`.
