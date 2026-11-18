// Skeleton 3D - the skeleton itself, built from simple shapes (no model file to download or license).
// Units are metres, the figure stands on y = 0 and faces +z. The patient's RIGHT side is at -x, so a
// front view shows it on the viewer's left, as on an X-ray. Every mesh carries userData:
//   bone (id shared by the parts of one structure), name, area, side (L / R / null), kind
//   (bone, cartilage, teeth, dark, organ). Organ surfaces also supply their base color and detail flag.
// Long bones are three meshes (upper end, shaft, lower end) so an end can belong to its joint area.
import {
    BufferGeometry, CatmullRomCurve3, CylinderGeometry, Float32BufferAttribute, Group, LatheGeometry, Mesh,
    Quaternion, SphereGeometry, TubeGeometry, Vector2, Vector3
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildStructures } from "./structures.js";
import { buildOrgans } from "./organs.js";

const UP = new Vector3(0, 1, 0);
const V = p => (p.isVector3 ? p.clone() : new Vector3(p[0], p[1], p[2]));

function merge (list) {
    const flat = list.map(g => {
        const n = g.index ? g.toNonIndexed() : g;
        n.deleteAttribute("uv");
        if (!n.getAttribute("normal")) { n.computeVertexNormals(); }
        return n;
    });
    return flat.length === 1 ? flat[0] : mergeGeometries(flat, false);
}

function orient (g, a, b) {
    const dir = b.clone().sub(a).normalize();
    g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir));
    g.translate(a.x, a.y, a.z);
    return g;
}

// ellipsoid; rot = [x, y, z] turns (radians) applied before it is moved to its place
function ell (c, r, rot) {
    const g = new SphereGeometry(1, 16, 12);
    g.scale(r[0], r[1], r[2]);
    if (rot) {
        if (rot[0]) { g.rotateX(rot[0]); }
        if (rot[1]) { g.rotateY(rot[1]); }
        if (rot[2]) { g.rotateZ(rot[2]); }
    }
    g.translate(c[0], c[1], c[2]);
    return g;
}

// straight piece between two points with rounded ends; flat squeezes it front to back before it is placed
function stick (a, b, ra, rb, flat) {
    const A = V(a), B = V(b), len = A.distanceTo(B);
    const parts = [];
    const c = new CylinderGeometry(rb, ra, len, 10, 1, true);
    c.translate(0, len / 2, 0);
    const s0 = new SphereGeometry(ra, 10, 8);
    const s1 = new SphereGeometry(rb, 10, 8);
    s1.translate(0, len, 0);
    for (const g of [c, s0, s1]) {
        if (flat) { g.scale(1, 1, flat); }
        parts.push(orient(g, A, B));
    }
    return merge(parts);
}

function tube (pts, r, segs) {
    const P = pts.map(V);
    const g = new TubeGeometry(new CatmullRomCurve3(P), segs || P.length * 6, r, 8, false);
    const s0 = new SphereGeometry(r, 8, 6), s1 = new SphereGeometry(r, 8, 6);
    s0.translate(P[0].x, P[0].y, P[0].z);
    const e = P[P.length - 1];
    s1.translate(e.x, e.y, e.z);
    return merge([g, s0, s1]);
}

// flat plate over a polygon (points in order), with a thickness
function plate (pts, thick) {
    const P = pts.map(V);
    const n = P[1].clone().sub(P[0]).cross(P[2].clone().sub(P[0])).normalize().multiplyScalar(thick / 2);
    const top = P.map(p => p.clone().add(n)), bot = P.map(p => p.clone().sub(n));
    const pos = [];
    const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 1; i < P.length - 1; i++) {
        tri(top[0], top[i], top[i + 1]);
        tri(bot[0], bot[i + 1], bot[i]);
    }
    for (let i = 0; i < P.length; i++) {
        const j = (i + 1) % P.length;
        tri(top[i], bot[i], bot[j]);
        tri(top[i], bot[j], top[j]);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
}

// long bone from a to b: profile = [[t, radius], ...] with t from 0 (at a) to 1 (at b). Returns one
// geometry per section between the cuts, e.g. cuts [0.2, 0.8] -> upper end, shaft, lower end
function lathe (a, b, profile, cuts) {
    const A = V(a), B = V(b), len = A.distanceTo(B);
    const rAt = t => {
        for (let i = 1; i < profile.length; i++) {
            if (t <= profile[i][0]) {
                const p = profile[i - 1], q = profile[i];
                let u = (t - p[0]) / ((q[0] - p[0]) || 1);
                u = u * u * (3 - 2 * u);
                return p[1] + (q[1] - p[1]) * u;
            }
        }
        return profile[profile.length - 1][1];
    };
    const bounds = [0].concat(cuts || [], [1]);
    const out = [];
    for (let k = 0; k < bounds.length - 1; k++) {
        const t0 = bounds[k], t1 = bounds[k + 1];
        const steps = Math.max(3, Math.ceil((t1 - t0) / 0.035));
        const pts = [];
        if (k === 0) { pts.push(new Vector2(0.0001, 0)); }
        for (let i = 0; i <= steps; i++) {
            const t = t0 + (t1 - t0) * i / steps;
            pts.push(new Vector2(Math.max(rAt(t), 0.0001), t * len));
        }
        if (k === bounds.length - 2) { pts.push(new Vector2(0.0001, len)); }
        out.push(orient(new LatheGeometry(pts, 14), A, B));
    }
    return out;
}

// a piece of an ellipsoid shell whose poles are at the ears (see the skull)
function shell (c, r, phi0, phiLen, th0, thLen) {
    const g = new SphereGeometry(1, Math.max(6, Math.round(phiLen * 8)), Math.max(4, Math.round(thLen * 7)), phi0, phiLen, th0, thLen);
    g.rotateZ(Math.PI / 2);
    g.scale(r[0], r[1], r[2]);
    g.translate(c[0], c[1], c[2]);
    return g;
}

// smooth curve z(y) through the points [y, z] (y rising)
function curve (pts) {
    const at = y => {
        let i = 1;
        while (i < pts.length - 1 && y > pts[i][0]) { i++; }
        const p0 = pts[Math.max(i - 2, 0)], p1 = pts[i - 1], p2 = pts[i], p3 = pts[Math.min(i + 1, pts.length - 1)];
        const h = p2[0] - p1[0], u = Math.min(Math.max((y - p1[0]) / h, 0), 1);
        const m1 = (p2[1] - p0[1]) / ((p2[0] - p0[0]) || 1) * h, m2 = (p3[1] - p1[1]) / ((p3[0] - p1[0]) || 1) * h;
        const u2 = u * u, u3 = u2 * u;
        return (2 * u3 - 3 * u2 + 1) * p1[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[1] + (u3 - u2) * m2;
    };
    return at;
}

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"];

export const SEX = {
    M: { scale: 1,     th: 1,    shX: 0.185, ribW: 1,    pelW: 1,    pelH: 1,    hipX: 0.085, isX: 0.047, kneeX: 0.070, skull: 1,    jaw: 0.050, brow: true,  chin: 1 },
    F: { scale: 0.925, th: 0.88, shX: 0.168, ribW: 0.92, pelW: 1.09, pelH: 0.92, hipX: 0.093, isX: 0.066, kneeX: 0.066, skull: 0.96, jaw: 0.045, brow: false, chin: 0.8 }
};

export function buildSkeleton (sex) {
    const P = SEX[sex] || Object.fromEntries(Object.keys(SEX.M).map(key => [key, typeof SEX.M[key] === "number" ? (SEX.M[key]+SEX.F[key])/2 : false]));
    const group = new Group();
    const meshes = [];
    const th = P.th;

    function add (bone, name, area, side, geom, kind) {
        const g = Array.isArray(geom) ? merge(geom) : merge([geom]);
        const m = new Mesh(g);
        m.userData = { bone: side ? bone + "_" + side : bone, base: bone, name, area, side: side || null, kind: kind || "bone" };
        group.add(m);
        meshes.push(m);
        return m;
    }

    // ---------------------------------------------------------------- skull
    {
        const k = P.skull;
        const C = [0, 1.675, 0.005];
        const R = [0.074 * k, 0.086 * k, 0.094 * k];
        const o = (x, y, z) => [C[0] + x * k, C[1] + y * k, C[2] + z * k];
        const PI = Math.PI, tc = 0.62, fr = PI / 2 + 0.116;
        add("SKULL_CAVITY", "Eye sockets and nasal cavity", "FACE", null, ell(C, [R[0] * 0.93, R[1] * 0.93, R[2] * 0.93]), "dark");
        const frontal = [shell(C, R, fr, 0.84 * PI - fr, tc, PI - 2 * tc)];
        if (P.brow) { frontal.push(tube([o(-0.046, 0.012, 0.074), o(-0.02, 0.012, 0.089), o(0, 0.006, 0.092), o(0.02, 0.012, 0.089), o(0.046, 0.012, 0.074)], 0.0055)); }
        add("FRONTAL", "Frontal bone", "HEAD", null, frontal);
        add("PARIETAL", "Parietal bone", "HEAD", "R", shell(C, R, 0.84 * PI, 0.46 * PI, tc, PI / 2 - tc));
        add("PARIETAL", "Parietal bone", "HEAD", "L", shell(C, R, 0.84 * PI, 0.46 * PI, PI / 2, PI / 2 - tc));
        add("OCCIPITAL", "Occipital bone", "HEAD", null, shell(C, R, 1.3 * PI, 0.5 * PI, tc, PI - 2 * tc));
        add("SPHENOID", "Skull base (sphenoid)", "HEAD", null, shell(C, R, 1.8 * PI, 0.4 * PI, tc, PI - 2 * tc));
        add("TEMPORAL", "Temporal bone", "HEAD", "R", [shell(C, R, 0, 2 * PI, 0, tc), ell(o(-0.06, -0.062, -0.022), [0.011, 0.016, 0.012])]);
        add("TEMPORAL", "Temporal bone", "HEAD", "L", [shell(C, R, 0, 2 * PI, PI - tc, tc), ell(o(0.06, -0.062, -0.022), [0.011, 0.016, 0.012])]);
        add("NASAL", "Nasal bones", "FACE", null, ell(o(0, -0.008, 0.088), [0.009, 0.016, 0.008], [0.25, 0, 0]));
        add("MAXILLA", "Maxilla (upper jaw)", "FACE", null, [
            ell(o(0, -0.06, 0.056), [0.04, 0.026, 0.032]),
            stick(o(-0.011, -0.012, 0.086), o(-0.022, -0.056, 0.078), 0.0055, 0.011),
            stick(o(0.011, -0.012, 0.086), o(0.022, -0.056, 0.078), 0.0055, 0.011),
            tube([o(-0.046, -0.034, 0.064), o(-0.03, -0.037, 0.076), o(-0.016, -0.036, 0.082)], 0.006),
            tube([o(0.046, -0.034, 0.064), o(0.03, -0.037, 0.076), o(0.016, -0.036, 0.082)], 0.006)
        ]);
        add("SKULL_CAVITY", "Eye sockets and nasal cavity", "FACE", null, ell(o(0, -0.05, 0.083), [0.0095, 0.014, 0.007]), "dark");
        add("TEETH_UPPER", "Upper teeth", "FACE", null, tube([o(-0.03, -0.086, 0.04), o(-0.022, -0.087, 0.07), o(0, -0.088, 0.086), o(0.022, -0.087, 0.07), o(0.03, -0.086, 0.04)], 0.0058), "teeth");
        for (const s of [-1, 1]) {
            add("ZYGOMATIC", "Zygomatic bone (cheekbone)", "FACE", s < 0 ? "R" : "L", [
                ell(o(s * 0.052, -0.04, 0.056), [0.013, 0.013, 0.015]),
                stick(o(s * 0.05, 0.012, 0.07), o(s * 0.052, -0.04, 0.06), 0.0055, 0.008),
                tube([o(s * 0.058, -0.04, 0.046), o(s * 0.068, -0.037, 0.02), o(s * 0.07, -0.035, -0.004)], 0.0045)
            ]);
        }
        const jw = P.jaw;
        add("MANDIBLE", "Mandible (lower jaw)", "JAW", null, [
            tube([o(-jw, -0.1, -0.002), o(-0.04, -0.111, 0.04), o(-0.018, -0.117, 0.074), o(0, -0.118, 0.08), o(0.018, -0.117, 0.074), o(0.04, -0.111, 0.04), o(jw, -0.1, -0.002)], 0.0105, 40),
            stick(o(-jw, -0.1, -0.002), o(-0.056, -0.04, -0.008), 0.011, 0.008, 1.3),
            stick(o(jw, -0.1, -0.002), o(0.056, -0.04, -0.008), 0.011, 0.008, 1.3),
            ell(o(0, -0.118, 0.079), [0.017 * P.chin, 0.012 * P.chin, 0.009])
        ]);
        add("TEETH_LOWER", "Lower teeth", "JAW", null, tube([o(-0.029, -0.099, 0.04), o(-0.021, -0.1, 0.066), o(0, -0.101, 0.08), o(0.021, -0.1, 0.066), o(0.029, -0.099, 0.04)], 0.0052), "teeth");
        add("HYOID", "Hyoid bone", "NECK", null, tube([[-0.02, 1.562, 0.012], [-0.012, 1.556, 0.034], [0, 1.554, 0.04], [0.012, 1.556, 0.034], [0.02, 1.562, 0.012]], 0.0033));
    }

    // ---------------------------------------------------------------- spine
    const spineZ = curve([[1.03, -0.04], [1.055, -0.028], [1.13, -0.016], [1.225, -0.045], [1.33, -0.07], [1.42, -0.058], [1.495, -0.022], [1.545, -0.006], [1.6, -0.012]]);
    const thoracic = [];   // centre of each thoracic vertebra, for the ribs
    {
        const sections = [
            { n: 7,  top: 1.6,   bottom: 1.485, pre: "C", area: "NECK",       rb: [0.013, 0.0165], sp: [0.016, 0.03],  tp: 0.011, down: 0.3 },
            { n: 12, top: 1.485, bottom: 1.215, pre: "T", area: "UPPER_BACK", rb: [0.0165, 0.024], sp: [0.034, 0.03],  tp: 0.02,  down: 1.1 },
            { n: 5,  top: 1.215, bottom: 1.04,  pre: "L", area: "LOWER_BACK", rb: [0.025, 0.029],  sp: [0.03, 0.028],  tp: 0.027, down: 0.15 }
        ];
        for (const sec of sections) {
            const h = (sec.top - sec.bottom) / sec.n;
            for (let i = 0; i < sec.n; i++) {
                const f = sec.n > 1 ? i / (sec.n - 1) : 0;
                const y = sec.top - h * (i + 0.5), z = spineZ(y);
                const tilt = Math.atan2(spineZ(y + 0.005) - spineZ(y - 0.005), 0.01);
                let rb = sec.rb[0] + (sec.rb[1] - sec.rb[0]) * f;
                const sp = sec.sp[0] + (sec.sp[1] - sec.sp[0]) * f;
                const atlas = sec.pre === "C" && i === 0;
                if (atlas) { rb = 0.019; }
                const bh = h * 0.8, back = -rb * 0.78;
                const body = new CylinderGeometry(rb, rb, bh, 14);
                body.scale(1, 1, 0.78);
                const parts = [body, ell([0, 0, back - 0.006], [rb * 0.75, bh * 0.42, 0.008])];
                if (!atlas) { parts.push(stick([0, 0, back - 0.008], [0, -sp * 0.5 * sec.down, back - 0.008 - sp], 0.0045, 0.0035)); }
                for (const s of [-1, 1]) {
                    parts.push(stick([s * rb * 0.6, 0, back - 0.002], [s * (rb + sec.tp), 0.002, back - 0.012], 0.0042, 0.0034));
                }
                for (const g of parts) { g.rotateX(tilt); g.translate(0, y, z); }
                const label = sec.pre + (i + 1);
                add(label, label + (atlas ? " vertebra (atlas)" : sec.pre === "C" && i === 1 ? " vertebra (axis)" : " vertebra"), sec.area, null, parts);
                if (sec.pre === "T") { thoracic.push([y, z]); }
                // the disc under this vertebra
                const yd = y - h / 2, disc = new CylinderGeometry(rb * 0.97, rb * 0.97, h * 0.2, 14);
                disc.scale(1, 1, 0.78);
                disc.rotateX(tilt);
                disc.translate(0, yd, spineZ(yd));
                if (!atlas) { add("DISC_" + label, "Disc below " + label, sec.area, null, disc, "cartilage"); }
            }
        }
        // from the wide base (top) down to the tip
        const sacrum = orient(new CylinderGeometry(0.02, 0.056 * P.pelW, 0.112, 14).translate(0, 0.056, 0).scale(1, 1, 0.42), V([0, 1.04, -0.042]), V([0, 0.937, -0.09]));
        add("SACRUM", "Sacrum", "SACRUM", null, sacrum);
        add("COCCYX", "Coccyx (tailbone)", "SACRUM", null, stick([0, 0.935, -0.089], [0, 0.9, -0.074], 0.011, 0.004, 0.7));
    }

    // ---------------------------------------------------------------- ribs and sternum
    {
        const stZ = 0.09;
        add("MANUBRIUM", "Manubrium (top of breastbone)", "CHEST", null, ell([0, 1.405, stZ - 0.004], [0.03 * P.ribW, 0.026, 0.008]));
        add("STERNUM", "Sternum (breastbone)", "CHEST", null, ell([0, 1.322, stZ], [0.02 * P.ribW, 0.064, 0.007]));
        add("XIPHOID", "Xiphoid process", "CHEST", null, ell([0, 1.245, stZ - 0.002], [0.008, 0.017, 0.004]));
        const W = [0.055, 0.08, 0.1, 0.113, 0.123, 0.13, 0.135, 0.138, 0.137, 0.13, 0.118, 0.1];
        const ZF = [0.05, 0.07, 0.082, 0.09, 0.095, 0.098, 0.1, 0.1, 0.096, 0.09, 0.085, 0.07];
        const DROP = [0.03, 0.05, 0.07, 0.085, 0.095, 0.105, 0.115, 0.12, 0.12, 0.11, 0.09, 0.06];
        const END = [2.79, 2.79, 2.79, 2.79, 2.79, 2.74, 2.66, 2.45, 2.3, 2.15, 1.95, 1.5];
        const STY = [1.415, 1.385, 1.355, 1.325, 1.3, 1.275, 1.258];
        for (const s of [-1, 1]) {
            const side = s < 0 ? "R" : "L";
            const ends = [];
            for (let i = 0; i < 12; i++) {
                const [ty, tz] = thoracic[i];
                const zb = tz - 0.04, zf = ZF[i], cz = (zb + zf) / 2, b = (zf - zb) / 2, w = W[i] * P.ribW, p0 = 0.22;
                const pts = [];
                const n = 14;
                for (let j = 0; j <= n; j++) {
                    const phi = p0 + (END[i] - p0) * j / n;
                    const u = (phi - p0) / (Math.PI - p0);
                    pts.push([s * w * Math.sin(phi), ty + 0.006 - DROP[i] * Math.pow(u, 1.3), cz - b * Math.cos(phi)]);
                }
                ends.push(pts[n]);
                add("RIB" + (i + 1), ORDINAL[i] + " rib", "CHEST", side, tube(pts, 0.0048, 44));
            }
            const cart = [];
            for (let i = 0; i < 7; i++) {
                const e = ends[i], t = [s * 0.017 * P.ribW, STY[i], stZ];
                cart.push(tube([e, [(e[0] + t[0]) / 2, (e[1] + t[1]) / 2 - 0.008 * (i > 3 ? 1 : 0), (e[2] + t[2]) / 2 + 0.006], t], 0.0045, 10));
            }
            for (let i = 7; i < 10; i++) {
                const e = ends[i], u = ends[i - 1];
                cart.push(tube([e, [(e[0] + u[0]) / 2 - s * 0.012, (e[1] + u[1]) / 2 + 0.004, (e[2] + u[2]) / 2 + 0.006], [u[0] - s * 0.02, u[1] + 0.012, u[2] + 0.004]], 0.0042, 10));
            }
            add("COSTAL_CARTILAGE", "Costal cartilage", "CHEST", side, cart, "cartilage");
        }
    }

    // ---------------------------------------------------------------- shoulders, arms and hands
    const FINGERS = ["thumb", "index finger", "middle finger", "ring finger", "little finger"];
    for (const s of [-1, 1]) {
        const side = s < 0 ? "R" : "L";
        const X = P.shX;
        add("CLAVICLE", "Clavicle (collarbone)", "SHOULDER", side, tube([[s * 0.022, 1.428, 0.078], [s * 0.07, 1.44, 0.074], [s * 0.13, 1.45, 0.02], [s * (X - 0.012), 1.453, -0.022]], 0.0075 * th, 24));
        add("SCAPULA", "Scapula (shoulder blade)", "SHOULDER", side, [
            plate(s < 0
                ? [[s * 0.072, 1.44, -0.108], [s * (X - 0.03), 1.412, -0.05], [s * (X - 0.045), 1.37, -0.075], [s * 0.092, 1.285, -0.118]]
                : [[s * 0.072, 1.44, -0.108], [s * 0.092, 1.285, -0.118], [s * (X - 0.045), 1.37, -0.075], [s * (X - 0.03), 1.412, -0.05]], 0.007),
            tube([[s * 0.078, 1.405, -0.114], [s * 0.13, 1.428, -0.092], [s * (X - 0.012), 1.452, -0.04], [s * (X - 0.004), 1.452, -0.018]], 0.0068),
            ell([s * (X - 0.03), 1.41, -0.04], [0.011, 0.019, 0.014]),
            tube([[s * (X - 0.04), 1.425, -0.04], [s * (X - 0.04), 1.432, -0.01], [s * (X - 0.03), 1.418, 0.012]], 0.0055)
        ]);
        const E = [s * (X + 0.03), 1.115, -0.02];
        const hum = lathe([s * (X + 0.004), 1.428, -0.02], E, [[0, 0.018 * th], [0.08, 0.019 * th], [0.2, 0.0125 * th], [0.6, 0.011 * th], [0.85, 0.013 * th], [0.95, 0.019 * th], [1, 0.015 * th]], [0.22, 0.78]);
        add("HUMERUS", "Humerus", "SHOULDER", side, [hum[0], ell([s * (X - 0.008), 1.42, -0.02], [0.024 * th, 0.024 * th, 0.024 * th]), ell([s * (X + 0.016), 1.418, -0.016], [0.014 * th, 0.016 * th, 0.016 * th])]);
        add("HUMERUS", "Humerus", "UPPER_ARM", side, hum[1]);
        add("HUMERUS", "Humerus", "ELBOW", side, [hum[2], ell([E[0] - s * 0.028, 1.12, -0.02], [0.012 * th, 0.011, 0.01]), ell([E[0] + s * 0.024, 1.12, -0.02], [0.011 * th, 0.01, 0.01]), ell([E[0], 1.106, -0.014], [0.029 * th, 0.012, 0.013])]);
        const Wr = [s * (X + 0.065), 0.86, 0];
        const ulna = lathe([E[0] - s * 0.012, 1.128, -0.032], [Wr[0] - s * 0.02, 0.868, -0.004], [[0, 0.013 * th], [0.06, 0.0145 * th], [0.15, 0.0095 * th], [0.7, 0.0065 * th], [0.95, 0.006 * th], [1, 0.007 * th]], [0.2, 0.8]);
        add("ULNA", "Ulna", "ELBOW", side, ulna[0]);
        add("ULNA", "Ulna", "FOREARM", side, ulna[1]);
        add("ULNA", "Ulna", "WRIST", side, ulna[2]);
        const rad = lathe([E[0] + s * 0.016, 1.093, -0.012], [Wr[0] + s * 0.012, 0.862, 0], [[0, 0.0105 * th], [0.04, 0.011 * th], [0.1, 0.0075 * th], [0.6, 0.008 * th], [0.9, 0.013 * th], [1, 0.015 * th]], [0.2, 0.8]);
        add("RADIUS", "Radius", "ELBOW", side, rad[0]);
        add("RADIUS", "Radius", "FOREARM", side, rad[1]);
        add("RADIUS", "Radius", "WRIST", side, rad[2]);
        // carpal bones: thumb side first
        const carp = [
            ["SCAPHOID", "Scaphoid", 0.018, 0.846, 0.002], ["LUNATE", "Lunate", 0.004, 0.847, 0.001], ["TRIQUETRUM", "Triquetrum", -0.011, 0.846, 0], ["PISIFORM", "Pisiform", -0.02, 0.842, 0.009],
            ["TRAPEZIUM", "Trapezium", 0.023, 0.831, 0.004], ["TRAPEZOID", "Trapezoid", 0.01, 0.83, 0.001], ["CAPITATE", "Capitate", -0.003, 0.829, 0.001], ["HAMATE", "Hamate", -0.016, 0.83, 0.001]
        ];
        for (const c of carp) {
            add(c[0], c[1], "WRIST", side, ell([Wr[0] + s * c[2], c[3], c[4]], c[0] === "PISIFORM" ? [0.005, 0.005, 0.005] : [0.0078 * th, 0.0075, 0.0068]));
        }
        const mcBase = [[0.026, 0.824, 0.008], [0.017, 0.82, 0.002], [0.004, 0.819, 0.001], [-0.009, 0.82, 0.001], [-0.021, 0.822, 0.001]];
        const mcHead = [[0.048, 0.788, 0.026], [0.023, 0.754, 0.004], [0.005, 0.751, 0.003], [-0.012, 0.756, 0.003], [-0.027, 0.764, 0.003]];
        const phLen = [[0.03, 0.025], [0.041, 0.024, 0.019], [0.046, 0.029, 0.02], [0.042, 0.027, 0.02], [0.033, 0.019, 0.017]];
        const PH = ["Proximal", "Middle", "Distal"];
        for (let f = 0; f < 5; f++) {
            const a = V([Wr[0] + s * mcBase[f][0], mcBase[f][1], mcBase[f][2]]), b = V([Wr[0] + s * mcHead[f][0], mcHead[f][1], mcHead[f][2]]);
            add("METACARPAL" + (f + 1), ORDINAL[f] + " metacarpal", "HAND", side, stick(a, b, 0.0062 * th, 0.0058 * th));
            const dir = b.clone().sub(a).normalize();
            if (f > 0) { dir.lerp(new Vector3(0, -1, 0.06), 0.6).normalize(); }
            let p = b.clone().addScaledVector(dir, 0.004);
            for (let j = 0; j < phLen[f].length; j++) {
                const q = p.clone().addScaledVector(dir, phLen[f][j] - 0.003);
                const r = (f === 0 ? 0.0056 : 0.005) * th * (1 - j * 0.13);
                const which = f === 0 ? (j === 0 ? "Proximal" : "Distal") : PH[j];
                add("PHALANX_H" + (f + 1) + "_" + (j + 1), which + " phalanx of " + FINGERS[f], "HAND", side, stick(p, q, r, r * 0.85));
                p = q.clone().addScaledVector(dir, 0.003);
            }
        }
    }

    // ---------------------------------------------------------------- pelvis, legs and feet
    const TOES = ["great toe", "2nd toe", "3rd toe", "4th toe", "little toe"];
    for (const s of [-1, 1]) {
        const side = s < 0 ? "R" : "L";
        const hx = P.hipX, pw = P.pelW, ph = P.pelH, top = 1.01 + 0.075 * ph;
        add("ILIUM", "Ilium (hip bone)", "PELVIS", side, [
            ell([s * 0.088 * pw, 1.003, -0.02], [0.013, 0.076 * ph, 0.078], [0, s * 0.5, -s * 0.36]),
            tube([[s * 0.118 * pw, 1.03, 0.05], [s * 0.142 * pw, top - 0.012, 0.015], [s * 0.132 * pw, top, -0.035], [s * 0.085 * pw, top - 0.02, -0.075], [s * 0.047, 1.04, -0.088]], 0.0085, 30),
            ell([s * (hx - 0.012), 0.942, -0.008], [0.03, 0.034, 0.034]),
            stick([s * 0.118 * pw, 1.03, 0.05], [s * (hx + 0.012), 0.955, 0.02], 0.009, 0.012)
        ]);
        const sym = [s * 0.009, 0.89, 0.062], tub = [s * P.isX, 0.842, -0.03], mid = [s * (P.isX * 0.62 + 0.004), 0.852, 0.022];
        add("PUBIS", "Pubis", "PELVIS", side, [
            tube([[s * (hx - 0.022), 0.932, 0.022], [s * (hx * 0.5), 0.916, 0.05], sym], 0.011, 14),
            ell([s * 0.014, 0.886, 0.06], [0.012, 0.021, 0.01]),
            tube([[sym[0] + s * 0.006, 0.872, 0.056], mid], 0.0105, 8)
        ]);
        add("ISCHIUM", "Ischium (sit bone)", "PELVIS", side, [
            tube([[s * (hx - 0.012), 0.908, -0.02], [s * (P.isX + 0.012), 0.868, -0.036], tub, [s * (P.isX * 0.85), 0.84, -0.008], mid], 0.0115, 20),
            ell(tub, [0.013, 0.016, 0.014])
        ]);
        // femur
        const H = [s * hx, 0.925, 0], T = [s * (hx + 0.05), 0.905, -0.008], K = [s * P.kneeX, 0.5, 0.005];
        const fem = lathe([s * (hx + 0.046), 0.922, -0.007], K, [[0, 0.015 * th], [0.1, 0.0165 * th], [0.25, 0.0145 * th], [0.5, 0.0135 * th], [0.75, 0.0145 * th], [0.9, 0.022 * th], [1, 0.028 * th]], [0.2, 0.8]);
        add("FEMUR", "Femur (thigh bone)", "HIP", side, [fem[0], ell(H, [0.024 * th, 0.024 * th, 0.024 * th]), stick(H, T, 0.014 * th, 0.015 * th),
            ell([T[0] + s * 0.006, T[1] + 0.012, T[2]], [0.016 * th, 0.022, 0.018 * th]), ell([s * (hx + 0.03), 0.872, -0.014], [0.009, 0.01, 0.009])]);
        add("FEMUR", "Femur (thigh bone)", "THIGH", side, fem[1]);
        add("FEMUR", "Femur (thigh bone)", "KNEE", side, [fem[2], ell([K[0] - s * 0.021, 0.487, -0.004], [0.02 * th, 0.022, 0.03 * th]), ell([K[0] + s * 0.021, 0.487, -0.004], [0.02 * th, 0.022, 0.03 * th])]);
        add("PATELLA", "Patella (kneecap)", "KNEE", side, ell([K[0], 0.497, 0.042], [0.02 * th, 0.022 * th, 0.01]));
        // tibia and fibula
        const ax = P.kneeX - 0.002;
        const tib = lathe([K[0], 0.468, 0], [s * ax, 0.085, 0], [[0, 0.036 * th], [0.04, 0.036 * th], [0.1, 0.026 * th], [0.25, 0.016 * th], [0.6, 0.0125 * th], [0.85, 0.013 * th], [0.95, 0.018 * th], [1, 0.02 * th]], [0.2, 0.8]);
        add("TIBIA", "Tibia (shin bone)", "KNEE", side, tib[0]);
        add("TIBIA", "Tibia (shin bone)", "LOWER_LEG", side, tib[1]);
        add("TIBIA", "Tibia (shin bone)", "ANKLE", side, [tib[2], ell([s * (ax - 0.02), 0.076, 0.002], [0.01, 0.017, 0.013])]);
        const fib = lathe([K[0] + s * 0.036, 0.447, -0.018], [s * (ax + 0.03), 0.06, -0.008], [[0, 0.007 * th], [0.03, 0.011 * th], [0.1, 0.0065 * th], [0.85, 0.006 * th], [0.95, 0.01 * th], [1, 0.008 * th]], [0.2, 0.8]);
        add("FIBULA", "Fibula", "KNEE", side, fib[0]);
        add("FIBULA", "Fibula", "LOWER_LEG", side, fib[1]);
        add("FIBULA", "Fibula", "ANKLE", side, fib[2]);
        // foot: offsets from the ankle, + = away from the midline
        const fx = d => s * (ax + d);
        add("TALUS", "Talus (ankle bone)", "ANKLE", side, ell([fx(0), 0.062, 0.012], [0.02 * th, 0.016, 0.028]));
        add("CALCANEUS", "Calcaneus (heel bone)", "FOOT", side, ell([fx(0.004), 0.032, -0.03], [0.02 * th, 0.024, 0.042]));
        add("NAVICULAR", "Navicular", "FOOT", side, ell([fx(-0.01), 0.05, 0.05], [0.018 * th, 0.012, 0.01]));
        add("CUBOID", "Cuboid", "FOOT", side, ell([fx(0.022), 0.03, 0.058], [0.014 * th, 0.012, 0.018]));
        add("CUNEIFORM_MEDIAL", "Medial cuneiform", "FOOT", side, ell([fx(-0.023), 0.04, 0.072], [0.008, 0.012, 0.012]));
        add("CUNEIFORM_INTERMEDIATE", "Intermediate cuneiform", "FOOT", side, ell([fx(-0.008), 0.044, 0.07], [0.007, 0.01, 0.011]));
        add("CUNEIFORM_LATERAL", "Lateral cuneiform", "FOOT", side, ell([fx(0.006), 0.041, 0.071], [0.007, 0.01, 0.012]));
        const mtBase = [[-0.024, 0.04, 0.086], [-0.009, 0.043, 0.084], [0.005, 0.039, 0.085], [0.019, 0.032, 0.08], [0.031, 0.026, 0.072]];
        const mtHead = [[-0.03, 0.013, 0.152], [-0.013, 0.012, 0.16], [0.003, 0.011, 0.154], [0.019, 0.01, 0.146], [0.034, 0.01, 0.134]];
        const toeLen = [[0.028, 0.022], [0.022, 0.012, 0.01], [0.02, 0.011, 0.009], [0.018, 0.01, 0.009], [0.016, 0.008, 0.008]];
        const PH = ["Proximal", "Middle", "Distal"];
        for (let f = 0; f < 5; f++) {
            const a = V([fx(mtBase[f][0]), mtBase[f][1], mtBase[f][2]]), b = V([fx(mtHead[f][0]), mtHead[f][1], mtHead[f][2]]);
            const r = (f === 0 ? 0.0078 : 0.0052) * th;
            add("METATARSAL" + (f + 1), ORDINAL[f] + " metatarsal", "FOOT", side, stick(a, b, r * 1.1, r));
            const dir = new Vector3(s * (mtHead[f][0] - mtBase[f][0]) * 0.3, -0.04, 1).normalize();
            let p = b.clone().addScaledVector(dir, 0.004);
            for (let j = 0; j < toeLen[f].length; j++) {
                const q = p.clone().addScaledVector(dir, toeLen[f][j] - 0.002);
                q.y = Math.max(q.y, 0.007);
                const pr = (f === 0 ? 0.0068 : 0.0044) * th * (1 - j * 0.1);
                const which = f === 0 ? (j === 0 ? "Proximal" : "Distal") : PH[j];
                add("PHALANX_F" + (f + 1) + "_" + (j + 1), which + " phalanx of " + TOES[f], "FOOT", side, stick(p, q, pr, pr * 0.9));
                p = q.clone().addScaledVector(dir, 0.002);
            }
        }
    }

    buildOrgans(add, tube, P, sex);
    buildStructures(add, ell, tube);
    group.scale.setScalar(P.scale);
    group.updateMatrixWorld(true);
    return { group, meshes, height: 1.765 * P.scale };
}
