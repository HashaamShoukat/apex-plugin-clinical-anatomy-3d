// Schematic structures for selection and annotation, in model metres. Not an anatomical atlas.
export function buildStructures (add, ell, tube) {
    function shape (id, name, area, side, geometry, layer, color) {
        const mesh = add(id, name, area, side, geometry, "organ");
        Object.assign(mesh.userData, { part: id, layer, color, detail: false });
    }
    const organ = (id, name, area, side, center, size, color = "#d89987") => shape(id, name, area, side, ell(center, size), "STRUCTURES", color);
    // Schematic subdivisions: independently selectable documentation anchors, not diagnostic geometry.
    for (const [id,name,area,center,size,color] of [
        ['PANCREATIC_HEAD','Pancreatic head','PANCREAS',[-0.025,1.159,-0.017],[0.018,0.015,0.019],'#d0a365'],
        ['PANCREATIC_BODY','Pancreatic body','PANCREAS',[0.025,1.165,-0.017],[0.032,0.012,0.017],'#b98a52'],
        ['PANCREATIC_TAIL','Pancreatic tail','PANCREAS',[0.076,1.172,-0.017],[0.018,0.009,0.012],'#e0bb7d'],
        ['GASTRIC_CARDIA','Cardia','STOMACH',[0.046,1.225,0.006],[0.012,0.014,0.014],'#d99d8f'],
        ['GASTRIC_FUNDUS','Fundus','STOMACH',[0.086,1.221,0.020],[0.020,0.022,0.025],'#ddab96'],
        ['GASTRIC_BODY','Gastric body','STOMACH',[0.074,1.186,0.026],[0.027,0.032,0.027],'#c57e78'],
        ['GASTRIC_PYLORUS','Pyloric region','STOMACH',[0.031,1.153,0.044],[0.019,0.012,0.014],'#b86b69']
    ]) { organ(id,name,area,null,center,size,color); }
    organ("RIGHT_ATRIUM", "Right atrium", "HEART", null, [-0.012, 1.356, 0.045], [0.018, 0.02, 0.019], "#798db2");
    organ("LEFT_ATRIUM", "Left atrium", "HEART", null, [0.035, 1.356, 0.022], [0.018, 0.019, 0.018], "#c57173");
    organ("RIGHT_VENTRICLE", "Right ventricle", "HEART", null, [0.002, 1.321, 0.065], [0.021, 0.03, 0.015], "#8b9cc0");
    organ("LEFT_VENTRICLE", "Left ventricle", "HEART", null, [0.035, 1.316, 0.044], [0.023, 0.037, 0.021], "#c46365");
    for (const [id, name, position] of [
        ["TRICUSPID_VALVE", "Tricuspid valve", [-0.006, 1.338, 0.053]], ["MITRAL_VALVE", "Mitral valve", [0.029, 1.338, 0.03]],
        ["AORTIC_VALVE", "Aortic valve", [0.009, 1.361, 0.048]], ["PULMONARY_VALVE", "Pulmonary valve", [0.023, 1.361, 0.07]]
    ]) { organ(id, name, "HEART", null, position, [0.008, 0.002, 0.007], "#f1ddbc"); }
    for (const s of [-1, 1]) {
        const side = s === 1 ? "L" : "R", x = s * 0.032;
        organ('LUNG_SUPERIOR_LOBE','Superior lobe','LUNG',side,[s*0.078,1.395,-0.003],[0.037,0.047,0.043],'#dda0ac');
        organ('LUNG_INFERIOR_LOBE','Inferior lobe','LUNG',side,[s*0.084,1.291,-0.023],[0.039,0.045,0.043],'#b66c83');
        if (side === 'R') { organ('LUNG_MIDDLE_LOBE','Middle lobe','LUNG',side,[-0.079,1.331,0.027],[0.037,0.024,0.029],'#cb8498'); }
        organ('MEDIAL_MENISCUS','Medial meniscus','KNEE',side,[s*0.083,0.471,0.003],[0.014,0.003,0.019],'#c8d7dc');
        organ('LATERAL_MENISCUS','Lateral meniscus','KNEE',side,[s*0.117,0.471,0.003],[0.013,0.003,0.018],'#a8c1cc');
        shape('ANTERIOR_CRUCIATE','Anterior cruciate ligament','KNEE',side,tube([[s*0.096,0.461,0.012],[s*0.104,0.490,-0.010]],0.003),'STRUCTURES','#dfcbae');
        shape('POSTERIOR_CRUCIATE','Posterior cruciate ligament','KNEE',side,tube([[s*0.103,0.461,-0.013],[s*0.096,0.491,0.009]],0.003),'STRUCTURES','#c4b091');
        organ("CORNEA", "Cornea", "EYE", side, [x, 1.653, 0.090], [0.010, 0.010, 0.003], "#96c8d4");
        organ("LENS", "Lens", "EYE", side, [x, 1.653, 0.081], [0.007, 0.007, 0.003], "#e2dfc5");
        organ("RETINA", "Retina", "EYE", side, [x, 1.653, 0.067], [0.011, 0.011, 0.002], "#ba715e");
        const kx = s * 0.072, ky = s === 1 ? 1.18 : 1.16;
        organ("RENAL_CORTEX", "Renal cortex", "KIDNEY", side, [kx, ky, -0.064], [0.026, 0.048, 0.022], "#c68679");
        for (let i = 0; i < 3; i++) {
            organ("RENAL_MEDULLA", "Renal medulla", "KIDNEY", side, [kx + s * 0.006, ky - 0.024 + i * 0.023, -0.046], [0.013, 0.01, 0.012], "#a85f61");
        }
        organ("RENAL_CALYCES", "Renal calyces", "KIDNEY", side, [kx - s * 0.01, ky, -0.043], [0.008, 0.027, 0.007], "#e2cbaa");
        // Representative bilateral muscles and peripheral pathways.
        for (const [id, name, area, center, size] of [
            ["DELTOID", "Deltoid", "SHOULDER", [s * 0.19, 1.43, 0.004], [0.042, 0.054, 0.041]],
            ["PECTORALIS", "Pectoralis major", "CHEST", [s * 0.09, 1.38, 0.087], [0.078, 0.045, 0.019]],
            ["BICEPS", "Biceps brachii", "UPPER_ARM", [s * 0.225, 1.26, 0.025], [0.026, 0.08, 0.024]],
            ["QUADRICEPS", "Quadriceps", "THIGH", [s * 0.10, 0.69, 0.028], [0.047, 0.15, 0.034]],
            ["GASTROCNEMIUS", "Gastrocnemius", "LOWER_LEG", [s * 0.10, 0.33, -0.025], [0.033, 0.105, 0.032]]
        ]) { shape(id, name, area, side, ell(center, size), "MUSCLES", "#b45c62"); }
        for (const [id, name, area, points] of [
            ["BRACHIAL_ARTERY", "Brachial artery", "UPPER_ARM", [[s * 0.15, 1.42, 0.01], [s * 0.21, 1.29, 0.015], [s * 0.25, 1.12, 0.025]]],
            ["FEMORAL_ARTERY", "Femoral artery", "THIGH", [[s * 0.04, 0.98, 0.025], [s * 0.09, 0.8, 0.03], [s * 0.10, 0.53, 0.025]]]
        ]) { shape(id, name, area, side, tube(points, 0.004), "VESSELS", "#bd4d52"); }
        for (const [id, name, area, points] of [
            ["MEDIAN_NERVE", "Median nerve", "FOREARM", [[s * 0.23, 1.15, 0.035], [s * 0.27, 1.01, 0.035], [s * 0.29, 0.86, 0.04]]],
            ["SCIATIC_NERVE", "Sciatic nerve", "THIGH", [[s * 0.06, 0.97, -0.055], [s * 0.10, 0.79, -0.05], [s * 0.10, 0.55, -0.035]]]
        ]) { shape(id, name, area, side, tube(points, 0.003), "NERVES", "#ddbe55"); }
    }
    shape("SPINAL_CORD", "Spinal cord", "UPPER_BACK", null, tube([[0, 1.6, -0.026], [0, 1.43, -0.055], [0, 1.25, -0.057], [0, 1.08, -0.035]], 0.004), "NERVES", "#ddbe55");
}
