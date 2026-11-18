// Skeleton 3D - body areas, everyday complaints and the built-in starter list of diagnoses.
// Diagnosis codes and titles follow ICD-10 (WHO). The starter catalog covers musculoskeletal sites,
// injuries and organs. Applications can provide their approved coded list with Diagnosis Query.
import seed from "./catalog-seed.json" with {type:"json"};

// sided: the area exists on the left and on the right
export const AREAS = [
    { id: "HEAD",       name: "Head",              sided: false },
    { id: "FACE",       name: "Face",              sided: false },
    { id: "JAW",        name: "Jaw",               sided: false },
    { id: "NECK",       name: "Neck",              sided: false },
    { id: "SHOULDER",   name: "Shoulder",          sided: true  },
    { id: "UPPER_ARM",  name: "Upper arm",         sided: true  },
    { id: "ELBOW",      name: "Elbow",             sided: true  },
    { id: "FOREARM",    name: "Forearm",           sided: true  },
    { id: "WRIST",      name: "Wrist",             sided: true  },
    { id: "HAND",       name: "Hand and fingers",  sided: true  },
    { id: "CHEST",      name: "Chest and ribs",    sided: false },
    { id: "UPPER_BACK", name: "Upper and mid back", sided: false },
    { id: "LOWER_BACK", name: "Lower back",        sided: false },
    { id: "PELVIS",     name: "Pelvis",            sided: false },
    { id: "SACRUM",     name: "Sacrum and tailbone", sided: false },
    { id: "HIP",        name: "Hip",               sided: true  },
    { id: "THIGH",      name: "Thigh",             sided: true  },
    { id: "KNEE",       name: "Knee",              sided: true  },
    { id: "LOWER_LEG",  name: "Lower leg",         sided: true  },
    { id: "ANKLE",      name: "Ankle",             sided: true  },
    { id: "FOOT",       name: "Foot and toes",     sided: true  },
    { id: "BRAIN", name: "Brain", sided: false, organ: true },
    { id: "EAR", name: "Ear", sided: true, organ: true },
    { id: "EYE", name: "Eye", sided: true, organ: true },
    { id: "NOSE", name: "Nose", sided: false, organ: true },
    { id: "THROAT", name: "Throat and larynx", sided: false, organ: true },
    { id: "THYROID", name: "Thyroid gland", sided: false, organ: true },
    { id: "AIRWAY", name: "Trachea and bronchi", sided: false, organ: true },
    { id: "LUNG", name: "Lung", sided: true, organ: true },
    { id: "HEART", name: "Heart", sided: false, organ: true },
    { id: "AORTA", name: "Aorta", sided: false, organ: true },
    { id: "VENA_CAVA", name: "Vena cava", sided: false, organ: true },
    { id: "ESOPHAGUS", name: "Esophagus", sided: false, organ: true },
    { id: "LIVER", name: "Liver", sided: false, organ: true },
    { id: "GALLBLADDER", name: "Gallbladder", sided: false, organ: true },
    { id: "STOMACH", name: "Stomach", sided: false, organ: true },
    { id: "PANCREAS", name: "Pancreas", sided: false, organ: true },
    { id: "SPLEEN", name: "Spleen", sided: false, organ: true },
    { id: "SMALL_INTESTINE", name: "Small intestine", sided: false, organ: true },
    { id: "COLON", name: "Large intestine and appendix", sided: false, organ: true },
    { id: "KIDNEY", name: "Kidney", sided: true, organ: true },
    { id: "ADRENAL", name: "Adrenal gland", sided: true, organ: true },
    { id: "URETER", name: "Ureter", sided: true, organ: true },
    { id: "BLADDER", name: "Urinary bladder", sided: false, organ: true },
    { id: "URETHRA", name: "Urethra", sided: false, organ: true },
    { id: "PROSTATE", name: "Prostate", sided: false, organ: true, sex: "M" }
];

// Presets govern visible meshes, search, complaints and diagnosis choices. Saved sites are independent
// of the current view, so changing specialties never removes a patient's existing marks.
export const SPECIALTIES = [
    { id: "ALL", name: "General medicine", areas: null, layer: "ANATOMY" },
    { id: "ENT", name: "ENT", areas: ["HEAD", "FACE", "JAW", "NECK", "EAR", "NOSE", "THROAT", "THYROID", "AIRWAY"], layer: "ANATOMY" },
    { id: "OPHTHALMOLOGY", name: "Ophthalmology", areas: ["HEAD", "FACE", "EYE"], layer: "ANATOMY" },
    { id: "CARDIOLOGY", name: "Cardiology", areas: ["CHEST", "HEART", "AORTA", "VENA_CAVA"], layer: "ANATOMY" },
    { id: "UROLOGY", name: "Urology", areas: ["PELVIS", "KIDNEY", "ADRENAL", "URETER", "BLADDER", "URETHRA", "PROSTATE"], layer: "ANATOMY" },
    { id: "INTERNAL_MEDICINE", name: "Internal medicine", areas: ["CHEST", "PELVIS", "THYROID", "AIRWAY", "LUNG", "HEART", "AORTA", "VENA_CAVA", "ESOPHAGUS", "LIVER", "GALLBLADDER", "STOMACH", "PANCREAS", "SPLEEN", "SMALL_INTESTINE", "COLON", "KIDNEY", "ADRENAL", "URETER", "BLADDER", "URETHRA", "PROSTATE"], layer: "ANATOMY" },
    { id: "GASTROENTEROLOGY", name: "Gastroenterology", areas: ["ESOPHAGUS", "LIVER", "GALLBLADDER", "STOMACH", "PANCREAS", "SPLEEN", "SMALL_INTESTINE", "COLON"], layer: "ORGANS" },
    { id: "NEUROLOGY", name: "Neurology", areas: ["HEAD", "FACE", "NECK", "UPPER_BACK", "LOWER_BACK", "BRAIN", "UPPER_ARM", "FOREARM", "HAND", "THIGH", "LOWER_LEG", "FOOT"], layer: "ANATOMY" },
    { id: "PULMONOLOGY", name: "Pulmonology", areas: ["CHEST", "AIRWAY", "LUNG"], layer: "ANATOMY" },
    { id: "ORTHOPEDICS", name: "Orthopedics", areas: AREAS.filter(a => !a.organ).map(a => a.id), layer: "SKELETON" }
];

export function specialtyById (id) {
    return SPECIALTIES.find(s => s.id === String(id || "").toUpperCase()) || SPECIALTIES[0];
}

// what a patient says -> where to look. k: other words people use
export const COMPLAINTS = seed.complaints;

export function complaintsForSpecialty (id) {
    const specialty = specialtyById(id);
    return COMPLAINTS.filter(complaint => (specialty.id === "ALL" || !complaint.specialties || complaint.specialties.includes(specialty.id)) &&
        complaint.areas.some(area => !specialty.areas || specialty.areas.includes(area)));
}

export const DIAGNOSES = seed.diagnoses;

export function areaById (id) {
    return AREAS.find(a => a.id === id) || null;
}
