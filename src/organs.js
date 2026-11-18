// Procedural surface anatomy in the same coordinates as the skeleton. The patient's left is +x.
// Each surface and its vessels belong to one selectable organ, including paired organs.
import { SphereGeometry } from "three";

function tissue (center, radii, deform, rotation) {
    const g = new SphereGeometry(1, 48, 32);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (deform) { [x, y, z] = deform(x, y, z); }
        p.setXYZ(i, x * radii[0], y * radii[1], z * radii[2]);
    }
    g.computeVertexNormals();
    if (rotation) {
        g.rotateX(rotation[0]);
        g.rotateY(rotation[1]);
        g.rotateZ(rotation[2]);
    }
    g.translate(...center);
    return g;
}

export function buildOrgans (add, tube, P, sex) {
    function organ (id, name, side, geometry, color, detail = false) {
        const mesh = add(id, name, id, side, geometry, "organ");
        Object.assign(mesh.userData, { color, detail, part: id + "_" + name.toUpperCase().replace(/[^A-Z0-9]+/g, "_") });
        return mesh;
    }
    const surface = (id, name, side, center, size, color, deform, rotation) =>
        organ(id, name, side, tissue(center, size, deform, rotation), color);
    const vessel = (id, name, side, points, radius, color) =>
        organ(id, name, side, tube(points, radius), color, true);

    // Brain hemispheres, a longitudinal fissure, and curved cortical folds.
    for (const s of [-1, 1]) {
        surface("BRAIN", "Brain", null, [s * 0.032, 1.698, -0.001], [0.034, 0.049, 0.061], "#cc9e9e",
            (x, y, z) => {
                const fold = 1 + 0.035 * Math.sin(y * 22 + z * 14) * Math.cos(x * 17 - z * 11);
                return [x * fold, y * fold, z * fold];
            });
        for (let i = 0; i < 7; i++) {
            const z = -0.047 + i * 0.015;
            vessel("BRAIN", "Cerebral cortex", null, [
                [s * 0.008, 1.742, z], [s * 0.028, 1.74, z + 0.005],
                [s * 0.05, 1.725, z - 0.002], [s * 0.06, 1.703, z + 0.005]
            ], 0.0021, "#b88387");
        }
    }
    surface("BRAIN", "Cerebellum", null, [0, 1.649, -0.038], [0.044, 0.021, 0.027], "#b98c94");

    // Eyes include a separate corneal surface, iris and pupil. All parts select the same eye.
    for (const s of [-1, 1]) {
        const side = s < 0 ? "R" : "L", x = s * 0.03 * P.skull;
        surface("EYE", "Eye", side, [x, 1.655, 0.076], [0.013, 0.013, 0.013], "#f2ece4");
        surface("EYE", "Iris", side, [x, 1.655, 0.088], [0.007, 0.007, 0.0028], "#5b827e");
        surface("EYE", "Pupil", side, [x, 1.655, 0.0903], [0.0031, 0.0031, 0.0012], "#172d35");
        surface("EYE", "Corneal highlight", side, [x - 0.002, 1.658, 0.091], [0.0014, 0.0014, 0.0005], "#ffffff");
        vessel("EYE", "Optic nerve", side, [[x, 1.653, 0.064], [s * 0.024, 1.65, 0.04], [s * 0.014, 1.649, 0.014]], 0.003, "#d8c799");

        // Pinna with helix, antihelix, concha and lobule.
        const earX = s * 0.078 * P.skull;
        surface("EAR", "External ear", side, [earX, 1.651, -0.002], [0.012, 0.027, 0.015], "#d99c86",
            (a, b, c) => [a * (0.8 + 0.2 * b), b, c * (0.8 + 0.2 * b)]);
        vessel("EAR", "Helix of ear", side, [
            [earX + s * 0.007, 1.628, 0], [earX + s * 0.011, 1.642, -0.014],
            [earX + s * 0.01, 1.669, -0.014], [earX + s * 0.007, 1.678, 0],
            [earX + s * 0.008, 1.67, 0.012], [earX + s * 0.01, 1.65, 0.01]
        ], 0.0032, "#edbaa2");
        surface("EAR", "Concha of ear", side, [earX + s * 0.011, 1.65, 0.002], [0.002, 0.013, 0.007], "#a9675f");
        vessel("EAR", "Antihelix of ear", side, [
            [earX + s * 0.013, 1.638, 0.003], [earX + s * 0.014, 1.653, -0.006],
            [earX + s * 0.012, 1.668, 0]
        ], 0.0022, "#efb9a4");
        vessel("EAR", "Auditory canal", side, [[earX, 1.65, 0], [s * 0.057, 1.649, -0.004], [s * 0.041, 1.648, -0.009]], 0.0035, "#ccad8a");
        surface("EAR", "Tympanic membrane", side, [s * 0.04, 1.648, -0.01], [0.001, 0.006, 0.005], "#aac1b7");
        vessel("EAR", "Middle ear ossicles", side, [[s * 0.039, 1.651, -0.01], [s * 0.034, 1.655, -0.013], [s * 0.03, 1.65, -0.016]], 0.0011, "#e9dfc8");
        const cochlea = [];
        for (let i = 0; i <= 36; i++) {
            const a = i / 36 * Math.PI * 4.5, r = 0.006 * (1 - i / 48);
            cochlea.push([s * 0.028, 1.646 + Math.cos(a) * r, -0.018 + Math.sin(a) * r]);
        }
        vessel("EAR", "Cochlea", side, cochlea, 0.0011, "#dec896");
    }
    surface("NOSE", "Nose", null, [0, 1.64, 0.093], [0.011, 0.023, 0.012], "#d7a38c",
        (x, y, z) => [x * (1 - y * 0.3), y, z * (1 - y * 0.25)]);
    vessel("THROAT", "Pharynx and larynx", null, [[0, 1.617, 0.012], [0, 1.57, 0.02], [0, 1.519, 0.028]], 0.012, "#d69b95");
    vessel("AIRWAY", "Trachea", null, [[0, 1.52, 0.022], [0, 1.46, 0.01], [0, 1.4, 0.002]], 0.009, "#c7b8a6");
    for (let i = 0; i < 10; i++) {
        const y = 1.505 - i * 0.01;
        vessel("AIRWAY", "Tracheal cartilage", null, [[-0.008, y, 0.023], [0, y, 0.03], [0.008, y, 0.023]], 0.0016, "#eee0c9");
    }
    for (const s of [-1, 1]) {
        surface("THYROID", "Thyroid gland", null, [s * 0.013, 1.517, 0.026], [0.01, 0.022, 0.009], "#bb6d59");
        vessel("AIRWAY", "Main bronchus", null, [[0, 1.402, 0], [s * 0.035, 1.382, -0.01], [s * 0.063, 1.369, -0.015]], 0.007, "#d7c7b3");
    }

    // Asymmetric lungs with the left cardiac notch, lobar fissures and branching vessels.
    for (const s of [-1, 1]) {
        const side = s < 0 ? "R" : "L", w = (s < 0 ? 0.06 : 0.052) * P.ribW;
        surface("LUNG", "Lung", side, [s * 0.077 * P.ribW, 1.343, -0.006], [w, 0.108, 0.063], "#c78c96",
            (x, y, z) => {
                const taper = 0.83 - y * 0.16;
                const notch = s > 0 && x < 0 && z > 0 ? 1 - 0.46 * Math.exp(-((y + 0.2) ** 2) * 6) : 1;
                return [x * taper * notch, y, z * (0.92 - 0.08 * y)];
            });
        vessel("LUNG", "Oblique fissure", side, [
            [s * 0.042, 1.383, 0.039], [s * 0.077, 1.34, 0.055],
            [s * 0.111, 1.294, 0.03], [s * 0.111, 1.268, -0.014]
        ], 0.0012, "#955f6f");
        if (s < 0) {
            vessel("LUNG", "Horizontal fissure", side, [[-0.04, 1.335, 0.043], [-0.078, 1.332, 0.053], [-0.124, 1.328, 0.02]], 0.0012, "#955f6f");
        }
        vessel("LUNG", "Pulmonary vessels", side, [[s * 0.039, 1.39, 0.015], [s * 0.064, 1.376, 0.044], [s * 0.09, 1.4, 0.041]], 0.0028, "#92667b");
    }

    // Ventricular mass tapers towards the patient's left. Great vessels and coronary branches
    // give the surface its characteristic anatomical silhouette.
    surface("HEART", "Heart", null, [0.017, 1.325, 0.057], [0.043, 0.06, 0.036], "#b94748",
        (x, y, z) => [x * (0.8 + y * 0.2) - y * 0.24, y, z * (0.88 + y * 0.12)], [0, 0, -0.2]);
    surface("HEART", "Right atrium", null, [-0.016, 1.361, 0.047], [0.023, 0.022, 0.024], "#a84049");
    surface("HEART", "Left atrial appendage", null, [0.044, 1.363, 0.046], [0.017, 0.015, 0.019], "#bd5d60");
    vessel("HEART", "Ascending aorta and arch", null, [[0.009, 1.366, 0.05], [0.006, 1.405, 0.043], [0.026, 1.418, 0.023], [0.046, 1.404, 0.001], [0.035, 1.374, -0.025]], 0.009, "#b74b4a");
    vessel("HEART", "Pulmonary trunk", null, [[0.025, 1.352, 0.077], [0.022, 1.389, 0.068], [0.051, 1.395, 0.023]], 0.008, "#6586a3");
    vessel("HEART", "Coronary artery", null, [[-0.012, 1.359, 0.079], [0.011, 1.347, 0.09], [0.024, 1.319, 0.087], [0.034, 1.291, 0.072]], 0.0018, "#e3b99c");
    vessel("HEART", "Coronary branches", null, [[0.012, 1.344, 0.091], [-0.003, 1.33, 0.087], [-0.011, 1.313, 0.073]], 0.0012, "#e3b99c");
    vessel("AORTA", "Aorta", null, [[0.034, 1.402, -0.027], [0.026, 1.31, -0.037], [0.012, 1.19, -0.014], [0.01, 1.085, -0.008]], 0.007, "#b64c4c");
    vessel("VENA_CAVA", "Vena cava", null, [[-0.025, 1.45, -0.013], [-0.02, 1.35, -0.022], [-0.023, 1.2, -0.026], [-0.015, 1.08, -0.014]], 0.008, "#6385a0");

    // Liver and biliary anatomy, with a broad right lobe and a tapered left lobe.
    surface("LIVER", "Liver, right lobe", null, [-0.063, 1.222, 0.025], [0.077, 0.051, 0.067], "#8e4f45",
        (x, y, z) => [x, y * (0.83 + 0.17 * x), z * (0.91 - 0.09 * x)], [0, 0, -0.18]);
    surface("LIVER", "Liver, left lobe", null, [0.021, 1.233, 0.033], [0.065, 0.027, 0.049], "#9d594b",
        (x, y, z) => [x, y * (0.72 - x * 0.22), z * (0.78 - x * 0.2)], [0, 0, 0.1]);
    vessel("LIVER", "Falciform ligament", null, [[-0.006, 1.253, 0.066], [-0.013, 1.229, 0.089], [-0.02, 1.203, 0.08]], 0.0013, "#c6957d");
    surface("GALLBLADDER", "Gallbladder", null, [-0.042, 1.184, 0.066], [0.012, 0.023, 0.013], "#6e8b59",
        (x, y, z) => [x * (0.8 - y * 0.2), y, z * (0.8 - y * 0.2)], [0, 0, -0.22]);

    vessel("ESOPHAGUS", "Esophagus", null, [[0, 1.59, -0.004], [0, 1.42, -0.035], [0.014, 1.29, -0.028], [0.047, 1.224, 0.001]], 0.006, "#ce9990");
    surface("STOMACH", "Stomach", null, [0.066, 1.189, 0.024], [0.047, 0.055, 0.039], "#d49287",
        (x, y, z) => [x * (0.8 - y * 0.18) - 0.22 * y, y, z * (0.85 - y * 0.1)], [0, 0, -0.35]);
    vessel("STOMACH", "Pylorus", null, [[0.06, 1.151, 0.043], [0.032, 1.145, 0.054], [0.007, 1.16, 0.05]], 0.01, "#cc857a");
    for (let i = 0; i < 4; i++) {
        vessel("STOMACH", "Gastric surface vessels", null, [[0.039 + i * 0.008, 1.216, 0.052], [0.062 + i * 0.008, 1.191, 0.061], [0.059 + i * 0.007, 1.166, 0.054]], 0.00075, "#b77371");
    }
    surface("SPLEEN", "Spleen", null, [0.116, 1.205, -0.014], [0.02, 0.036, 0.027], "#815e7b", null, [0, 0, -0.2]);
    surface("PANCREAS", "Pancreas", null, [0.022, 1.164, -0.017], [0.067, 0.014, 0.019], "#c9a36a",
        (x, y, z) => {
            const lobules = 1 + 0.1 * Math.sin(x * 26) * Math.cos(z * 14);
            return [x, y * lobules * (0.8 - x * 0.2), z * lobules];
        }, [0, 0, 0.12]);

    // Retroperitoneal kidneys have a medial concavity. Ureters descend to the bladder.
    for (const s of [-1, 1]) {
        const side = s < 0 ? "R" : "L", x = s * 0.07, y = s < 0 ? 1.151 : 1.169;
        surface("KIDNEY", "Kidney", side, [x, y, -0.063], [0.028, 0.051, 0.027], "#9e5552",
            (a, b, c) => [a + s * 0.4 * Math.exp(-b * b * 8) * Math.max(0, -s * a), b, c], [0, 0, -s * 0.14]);
        surface("KIDNEY", "Renal pelvis", side, [x - s * 0.019, y, -0.047], [0.008, 0.017, 0.009], "#ddbfa2");
        vessel("KIDNEY", "Renal artery", side, [[s * 0.011, y + 0.006, -0.017], [s * 0.036, y + 0.004, -0.034], [x - s * 0.017, y + 0.005, -0.049]], 0.0031, "#bb6258");
        vessel("KIDNEY", "Renal vein", side, [[-0.018, y - 0.003, -0.02], [s * 0.036, y - 0.002, -0.03], [x - s * 0.017, y - 0.004, -0.044]], 0.0033, "#668da5");
        surface("ADRENAL", "Adrenal gland", side, [x, y + 0.053, -0.061], [0.019, 0.012, 0.016], "#d4b97b");
        vessel("URETER", "Ureter", side, [[x - s * 0.018, y - 0.009, -0.049], [s * 0.047, 1.084, -0.038], [s * 0.039, 1.005, -0.026], [s * 0.016, 0.951, 0.009]], 0.003, "#d4b48b");
    }
    surface("BLADDER", "Urinary bladder", null, [0, 0.937, 0.018], [0.031, 0.034, 0.027], "#c9a27b",
        (x, y, z) => [x * (0.85 + y * 0.15), y, z]);
    vessel("URETHRA", "Urethra", null, [[0, 0.911, 0.019], [0, 0.891, 0.026], [0, sex === "F" ? 0.88 : 0.85, 0.04]], 0.0036, "#d4b48b");
    if (sex === "M") {
        surface("PROSTATE", "Prostate", null, [0, 0.9, 0.023], [0.02, 0.013, 0.018], "#b6847d");
    }

    // Coiled small bowel inside the haustrated frame of the colon.
    const bowel = [];
    for (let row = 0; row < 6; row++) {
        for (let col = 0; col <= 8; col++) {
            const u = col / 8, direction = row % 2 ? -1 : 1;
            bowel.push([direction * (-0.063 + u * 0.126), 1.121 - row * 0.024 + Math.sin(u * Math.PI * 2) * 0.005, 0.037 + Math.sin(u * Math.PI * 3 + row) * 0.012]);
        }
    }
    vessel("SMALL_INTESTINE", "Small intestine", null, bowel, 0.008, "#d7a193");
    const colon = [
        [-0.089, 0.99, 0.035], [-0.092, 1.06, 0.038], [-0.089, 1.14, 0.045],
        [-0.052, 1.148, 0.061], [0, 1.137, 0.067], [0.06, 1.149, 0.055],
        [0.095, 1.143, 0.033], [0.096, 1.059, 0.03], [0.083, 0.993, 0.028],
        [0.048, 0.978, 0.041], [0.013, 0.998, 0.033], [0, 0.966, -0.017]
    ];
    vessel("COLON", "Large intestine", null, colon, 0.013, "#b98078");
    for (const s of [-1, 1]) {
        for (let i = 0; i < 9; i++) {
            surface("COLON", "Colonic haustra", null, [s * 0.092, 1.005 + i * 0.015, 0.034], [0.014, 0.009, 0.014], "#c58e81");
        }
    }
    vessel("COLON", "Appendix", null, [[-0.089, 0.991, 0.034], [-0.075, 0.975, 0.033], [-0.08, 0.958, 0.024]], 0.003, "#c58e81");
}
