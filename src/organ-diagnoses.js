// Compatibility export derived from the single starter seed. Runtime lists live in CA3D_CLINIC_TERMS.
import seed from './catalog-seed.json' with {type:'json'};
import { AREAS } from './catalog.js';
const organs=new Set(AREAS.filter(area=>area.organ).map(area=>area.id));
export const ORGAN_DIAGNOSES=seed.diagnoses.filter(row=>row.areas.some(area=>organs.has(area))).map(row=>[row.code,row.label,row.areas.join(':'),row.k]);
