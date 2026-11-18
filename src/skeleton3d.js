/*! Clinical Anatomy 3D for Oracle APEX - (c) Hashaam Shoukat, MIT License. Uses three.js (MIT). */
// Item plug-in widget: a 3D skeleton the doctor turns, zooms and clicks. A click picks a body area (or a single
// bone), everyday complaints ("headache", "back pain") find the area, and each picked site takes diagnoses
// (the application's shared diagnosis catalogue), a pain score and a note.
// The item value is JSON: {"v":1,"sex":"M","sites":[{"area":"KNEE","side":"L","label":"Left knee","pain":6,
//   "note":"...","diagnoses":[{"code":"M17.9","label":"Gonarthrosis, unspecified","system":"ICD-10"}]}]}
import {
    AmbientLight, Box3, Color, DirectionalLight, HemisphereLight, MeshStandardMaterial, PerspectiveCamera,
    Raycaster, Scene, Vector2, Vector3, WebGLRenderer
} from "three";
import { MeshBVH, acceleratedRaycast, disposeBoundsTree } from 'three-mesh-bvh';
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildSkeleton } from "./model.js";
import { AREAS, COMPLAINTS, DIAGNOSES, SPECIALTIES, areaById, specialtyById, complaintsForSpecialty } from "./catalog.js";
import { ClinicTools } from "./clinic.js";
import { WorkspaceTools } from "./workspace.js";
import { PatientContext } from './patient-context.js';
import { AnatomyTools } from "./anatomy-tools.js";
import { normalizeTerm, termKey, siteKey, restoreClinicalSite, serializeClinicalSite, hasClinicalData } from "./clinical-value.js";
import { readPayload } from "./payload.js";
import { normalizeSex, validateSiteAnatomy } from './anatomy-contract.js';
import { AppearanceTools } from './appearance.js';

/* global __SK3_VERSION__ */
const VERSION = typeof __SK3_VERSION__ === "string" ? __SK3_VERSION__ : "dev";
const instances = {};
const BACK_AREAS = { UPPER_BACK: 1, LOWER_BACK: 1, SACRUM: 1, KIDNEY: 1, ADRENAL: 1, PANCREAS: 1 };
const SIDE_NAME = { L: "Left", R: "Right" };

const T = {
    male: "Male", female: "Female", byArea: "Area", byBone: "Bone",
    front: "Front", back: "Back", left: "Left", right: "Right", reset: "Reset view",
    search: "Search anatomy, complaints or diagnosis codes ...",
    complaints: "Common complaints", empty: "Select a body area or organ, or search to mark a site.",
    emptyRO: "Nothing is marked.", whichSide: "Which side?", where: "Where?", both: "Both", cancel: "Cancel",
    remove: "Remove", show: "Show on skeleton", diagnoses: "Diagnoses", suggested: "Diagnosis catalog for this site",
    filter: "Filter diagnoses ...", more: "Show all", less: "Show fewer", noDx: "No diagnoses are configured for this area.",
    allDxSelected: "All diagnoses in this list are already selected.", noMatchingDx: "No diagnoses match this filter.",
    pain: "Pain", note: "Note", notePh: "Add a note ...", hint: "Drag to turn, scroll or pinch to zoom, click to mark",
    noWebgl: "The 3D view is not available in this browser. Search and complaints still work.",
    gComplaints: "Complaints", gAreas: "Body areas", gBones: "Bones", gDx: "Diagnoses", noResult: "Nothing found",
    max: "No more sites can be added.", loading: "Loading ...", patientRight: "Patient's right", patientLeft: "Patient's left"
};

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lowerFirst = s => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const complaintTerm = complaint => complaint.source === 'CUSTOM' ? normalizeTerm(complaint,'COMPLAINT') : ({ source: "BUILTIN", code: complaint.id, label: complaint.name, system: "COMPLAINT" });

function siteLabel (site) {
    const base = site.part ? site.partName : site.bone ? site.boneName : (areaById(site.area) || { name: site.area }).name;
    return site.side ? SIDE_NAME[site.side] + " " + lowerFirst(base) : base;
}
class Skeleton3D {
    constructor (itemId, opts) {
        this.id = itemId;
        this.opts = Object.assign({
            sex: "M", sexSwitch: true, selectBy: "AREA", selectBySwitch: true, height: 560, dxSource: "BUILTIN",
            system: "ICD-10", pain: true, note: true, complaints: true, search: true, maxSites: 0, readOnly: false,
            ajaxId: null, specialtyItem: "", specialty: "ALL", specialtySwitch: true, layer: "AUTO",
            clinicPermissions: "NONE", clinicToken: "", examMode: "OFF", modelTools: ""
        }, opts || {});
        this.opts.dxSource = this.opts.dxSource === 'NONE' ? 'NONE' : 'BUILTIN';
        this.input = document.getElementById(itemId);
        this.root = document.getElementById(itemId + "_SK3");
        this.opts.readOnly = [true, 1, "true", "Y", "YES"].includes(this.opts.readOnly) || !!this.input?.readOnly;
        this.readOnlyLock = this.opts.readOnly;
        this.sites = [];
        this.active = null;      // key of the open site
        this.pending = null;     // { title, candidates: [{area, side, bone, boneName}], dx }
        this.hover = null;
        this.mode = this.opts.selectBy === "BONE" ? "BONE" : "AREA";
        this.sex = normalizeSex(this.opts.sex);
        this.specialty = specialtyById(this.opts.specialty);
        this.layer = this.specialty.layer;
        this.dxCache = {};
        this.showAll = false;
        this.dxFilter = "";
        this.disabled = false;
        this.eventHandlers = [];
        const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
        const updateTheme = () => {
            let theme = this.opts.theme;
            if (theme === 'apex') {
                let page=this.root.parentElement,style=getComputedStyle(document.body);
                while(page){const candidate=getComputedStyle(page);if(candidate.backgroundColor!=='transparent'&&candidate.backgroundColor!=='rgba(0, 0, 0, 0)'){style=candidate;break;}page=page.parentElement;}
                const rgb = style.backgroundColor.match(/[\d.]+/g)?.map(Number);
                theme = style.colorScheme === 'dark' || (rgb?.length >= 3 && (rgb.length < 4 || rgb[3] > 0) && rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722 < 128) ? 'dark' : 'light';
            }
            this.root.dataset.theme = ['dark','light'].includes(theme) ? theme : themeMedia.matches ? 'dark' : 'light';
        };
        this.themeObserver = new MutationObserver(updateTheme);
        for (const target of [document.body,document.documentElement]) { this.themeObserver.observe(target,{attributes:true,attributeFilter:['class','style','data-theme']}); }
        this.updateTheme=updateTheme;updateTheme(); this.listen(themeMedia,'change',updateTheme);
        this.exam = null;
        try { this.parse(this.input ? this.input.value : ""); }
        catch (error) { this.valueError = error.message; }
        this.active = this.sites[0] ? siteKey(this.sites[0]) : null;
        this.buildDom();
        this.appearance = new AppearanceTools(this);
        this.sexWarning = document.createElement("div"); this.sexWarning.className="sk3-sex-warning"; this.sexWarning.setAttribute("role","status"); this.sexWarning.textContent="Patient sex is unconfirmed. Sex-specific anatomy is unavailable."; this.sexWarning.hidden=this.sex!=="U"; this.root.prepend(this.sexWarning);
        this.keyOf = siteKey;
        this.labelOf = siteLabel;
        this.clinic = new ClinicTools(this);
        if (this.valueError) { this.clinic.message(this.valueError); }
        this.setLayer(this.layer);
        this.setLayer(this.opts.layer);
        this.initThree();
        this.modelTools = new AnatomyTools(this);
        this.patientContext = new PatientContext(this);
        this.workspace = new WorkspaceTools(this);
        this.paint();
        this.renderPanel();
        this.registerItem();
    }

    // ------------------------------------------------------------------ value
    listen (target, name, handler) {
        target.addEventListener(name, handler);
        this.eventHandlers.push({ target, name, handler });
    }

    destroy () {
        this.destroyed = true;
        this.anim = null;
        clearTimeout(this.searchTimer);
        clearTimeout(this.commitTimer);
        cancelAnimationFrame(this.hoverFrame);
        cancelAnimationFrame(this.resizeFrame);
        this.searchToken = null;
        this.resizeObserver?.disconnect();
        this.workspace?.destroy();
        this.themeObserver?.disconnect();
        this.patientContext?.destroy();
        for (const { target, name, handler } of this.eventHandlers) { target.removeEventListener(name, handler); }
        this.eventHandlers = [];
        window.apex?.jQuery?.(document).off('.sk3-' + this.id);
        this.controls?.dispose();
        this.modelTools?.disposeMaterials();
        this.appearance?.disposeMaterials();
        const geometries = new Set(), materials = new Set();
        this.scene?.traverse(node => {
            if (node.geometry) { geometries.add(node.geometry); }
            for (const material of Array.isArray(node.material) ? node.material : [node.material]) { if (material) { materials.add(material); } }
        });
        for (const collection of [this.mats, this.contextMats, this.organMats]) { Object.values(collection || {}).forEach(material => materials.add(material)); }
        if (this.modelTools?.markerGeometry) { geometries.add(this.modelTools.markerGeometry); }
        for (const material of [this.modelTools?.markerMaterial, this.modelTools?.draftMaterial, this.modelTools?.markerLineMaterial]) { if (material) { materials.add(material); } }
        geometries.forEach(geometry => { disposeBoundsTree.call(geometry); geometry.dispose(); });
        materials.forEach(material => material.dispose());
        this.renderer?.dispose();
        this.renderer?.forceContextLoss();
        this.root.replaceChildren();
        if (this.itemRegistered) { window.apex?.item?.create(this.id, {}); }
    }

    parse (text) {
        const v = readPayload(text);
        const nextSex = v.sex || normalizeSex(this.opts.sex);
        this.sexMismatch = !!(this.opts.sexLocked && v.sex && v.sex !== normalizeSex(this.opts.sex));
        if (nextSex !== 'M' && v.sites.some(site => site.area === 'PROSTATE')) { throw Error('A prostate finding requires confirmed male sex.'); }
        const sites = [];
        for (const s of v.sites) {
            const restored = {
                area: s.area, side: s.side === "L" || s.side === "R" ? s.side : null,
                bone: s.bone || null, boneName: s.boneName || s.bone || null,
                pain: typeof s.pain === "number" && s.pain >= 0 && s.pain <= 10 ? s.pain : null,
                note: s.note ? String(s.note) : "",
                diagnoses: (Array.isArray(s.diagnoses) ? s.diagnoses : []).map(d => normalizeTerm(d)).filter(Boolean)
            };
            restoreClinicalSite(s, restored);
            sites.push(restored);
        }
        this.sites = sites;
        this.exam = v.exam || null;
        this.recordContext = v.context || null;
        this.contextRefresh = v.contextRefresh || null;
        this.sex = nextSex;
        this.valueError = null;
    }
    serialize () {
        const context = this.patientContext?.snapshot() || this.recordContext;
        if (!this.sites.length && !this.exam && !context && !this.contextRefresh) { return ""; }
        return JSON.stringify({
            v: context || this.contextRefresh || hasClinicalData(this.sites, this.exam) ? 2 : 1, sex: this.sex,
            ...(context ? { context } : {}),
            ...(this.contextRefresh ? {contextRefresh:this.contextRefresh} : {}),
            ...(this.exam ? { exam: this.exam } : {}),
            sites: this.sites.map(s => {
                const o = { area: s.area };
                if (s.side) { o.side = s.side; }
                if (s.bone) { o.bone = s.bone; o.boneName = s.boneName; }
                o.label = siteLabel(s);
                if (s.pain != null) { o.pain = s.pain; }
                if (s.note) { o.note = s.note; }
                o.diagnoses = s.diagnoses.map(d => ({ ...d }));
                serializeClinicalSite(s, o);
                return o;
            })
        });
    }
    commit (silent) {
        clearTimeout(this.commitTimer);
        this.commitTimer = null;
        const v = this.serialize();
        if (this.input && this.input.value !== v) {
            if (!silent) { this.modelTools?.remember(this.input.value); }
            this.input.value = v;
            if (silent && !this.hasUserChanges) { this.initialValue = v; }
            if (!silent) {
                this.hasUserChanges = true;
                this.fire("change");
                this.fire("skeleton3dchange", v ? JSON.parse(v) : { v: 1, sex: this.sex, sites: [] });
            }
        }
    }
    commitLater () {
        this.hasUserChanges = true;
        clearTimeout(this.commitTimer);
        this.commitTimer = setTimeout(() => { if (!this.destroyed) { this.commit(); } }, 300);
    }
    flushCommit () { if (this.commitTimer != null) { this.commit(); } }
    checkpoint () { this.modelTools?.remember(this.input?.value || ""); }
    fire (name, data) {
        if (window.apex && window.apex.jQuery && this.input) {
            window.apex.jQuery(this.input).trigger(name, data);
        } else if (this.input) {
            this.input.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: data }));
        }
    }

    // ------------------------------------------------------------------ DOM
    buildDom () {
        const o = this.opts, ro = o.readOnly;
        const seg = (name, items, cur) => `<div class="sk3-seg" role="group" data-seg="${name}">` +
            items.map(i => `<button type="button" class="sk3-seg-b${i[0] === cur ? " is-on" : ""}" data-val="${i[0]}" aria-pressed="${i[0] === cur}">${esc(i[1])}</button>`).join("") + "</div>";
        this.root.classList.toggle("sk3--ro", !!ro);
        this.root.innerHTML =
            `<div class="sk3-topbar"><strong class="sk3-toolbar-title">Anatomy workspace</strong>` +
                (o.specialtySwitch ? `<label class="sk3-specialty-label" for="${esc(this.id)}_specialty">Specialty<select id="${esc(this.id)}_specialty" class="sk3-specialty">` +
                    SPECIALTIES.map(s => `<option value="${s.id}"${s.id === this.specialty.id ? " selected" : ""}>${esc(s.name)}</option>`).join("") + `</select></label>` : `<span class="sk3-specialty-name">${esc(this.specialty.name)}</span>`) +
                seg("layer", [["ANATOMY", "Anatomy"], ["SKELETON", "Skeleton"], ["ORGANS", "Organs"]], this.layer) +
                `<span class="sk3-readonly-badge" hidden>Read only</span><div class="sk3-toolbar-actions"><button type="button" class="sk3-chip" data-clinic="show-exam" hidden>Initial examination</button></div>` +
            `</div>` +
            (o.search && !ro ? `<div class="sk3-search"><input type="search" class="sk3-search-in" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${esc(this.id)}_results" placeholder="${esc(T.search)}" aria-label="${esc(T.search)}" autocomplete="off"><div id="${esc(this.id)}_results" class="sk3-results" role="listbox" aria-label="Search results" hidden></div><span class="sk3-search-status sk3-sr-only" role="status"></span></div>` : "") +
            `<div class="sk3-stage" id="${esc(this.id)}_stage">` +
                `<div class="sk3-viewer-header"><div class="sk3-viewer-switches">` +
                `<div class="sk3-tools sk3-tools--l">` +
                    (o.sexSwitch && !ro ? seg("sex", [["M", T.male], ["F", T.female]], this.sex) : `<span class="sk3-tag">${this.sex === "U" ? "Sex unconfirmed" : this.sex === "F" ? T.female : T.male}</span>`) +
                    (o.selectBySwitch && !ro ? seg("mode", [["AREA", T.byArea], ["BONE", T.byBone]], this.mode) : "") +
                `</div>` +
                `<div class="sk3-tools sk3-tools--r">` +
                    seg("view", [["front", T.front], ["back", T.back], ["right", T.right], ["left", T.left]], "") +
                    `<button type="button" class="sk3-btn" data-act="reset" title="${esc(T.reset)}" aria-label="${esc(T.reset)}">&#8635;</button>` +
                `</div>` +
                `</div><div class="sk3-viewer-actions"><button type="button" class="sk3-chip" data-act="controls" aria-expanded="false">Show controls</button></div>` +
                `<div class="sk3-selection-bar"><span class="sk3-selection-label" aria-live="polite"></span><div><button type="button" class="sk3-chip" data-act="focus-selected" disabled>Focus selected</button><button type="button" class="sk3-chip" data-act="findings" disabled>Findings</button></div></div></div>` +
                `<div class="sk3-model-viewport"><canvas class="sk3-canvas" tabindex="0" aria-label="3D anatomy, skeleton and organs"></canvas>` +
                `<div class="sk3-sides"><span>${esc(T.patientRight)}</span><span>${esc(T.patientLeft)}</span></div>` +
                `<div class="sk3-tip" hidden></div>` +
                `<div class="sk3-hint">${esc(o.selectionGesture === 'DOUBLE' ? 'Drag to turn, scroll or pinch to zoom. Double-click or double-tap anatomy to record a finding.' : T.hint)}</div>` +
            `</div></div>` +
            `<div class="sk3-divider" role="separator" tabindex="0" aria-label="Resize model and findings panels" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-controls="${esc(this.id)}_stage ${esc(this.id)}_panel"><span></span></div>` +
            `<div class="sk3-side-slot"><div class="sk3-panel" id="${esc(this.id)}_panel">` +
                `<div class="sk3-body"></div>` +
            `</div></div>`;
        this.stage = this.root.querySelector(".sk3-stage");
        this.viewport = this.root.querySelector(".sk3-model-viewport");
        this.sideSlot = this.root.querySelector(".sk3-side-slot");
        this.canvas = this.root.querySelector(".sk3-canvas");
        this.tip = this.root.querySelector(".sk3-tip");
        this.body = this.root.querySelector(".sk3-body");
        this.sidesEl = this.root.querySelector(".sk3-sides");
        this.searchIn = this.root.querySelector(".sk3-search-in");
        this.results = this.root.querySelector(".sk3-results");

        this.listen(this.root, "click", e => this.onClick(e));
        this.listen(this.root, "input", e => this.onInput(e));
        this.listen(this.root, "focusout", () => this.flushCommit());
        this.listen(this.root, "change", e => {
            if (e.target.classList.contains("sk3-specialty")) { this.setSpecialty(e.target.value); }
            if (e.target !== this.input) { e.stopPropagation(); }
        });
        if (this.searchIn) {
            this.listen(this.searchIn, "keydown", e => {
                if (e.key === "Escape") { this.searchIn.value = ""; this.closeResults(); return; }
                if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) && !this.results.hidden) {
                    e.preventDefault();
                    const buttons = [...this.results.querySelectorAll('[data-res]')];
                    if (!buttons.length) { return; }
                    const current = buttons.findIndex(button => button.getAttribute('aria-selected') === 'true');
                    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : current < 0 ?
                        (e.key === 'ArrowDown' ? 0 : buttons.length - 1) : (current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                    buttons.forEach((button, index) => button.setAttribute('aria-selected', String(index === next)));
                    this.searchIn.setAttribute('aria-activedescendant', buttons[next].id);
                    buttons[next].scrollIntoView({ block: 'nearest' });
                }
                if (e.key === "Enter") {
                    e.preventDefault();
                    const first = this.results.querySelector('[data-res][aria-selected="true"]') || this.results.querySelector("[data-res]");
                    if (first) { first.click(); }
                }
            });
            this.listen(document, "click", e => { if (!e.composedPath().includes(this.root)) { this.closeResults(); } });
        }
    }

    // ------------------------------------------------------------------ three.js
    initThree () {
        try {
            this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        } catch (e) {
            this.renderer = null;
            this.stage.classList.add("sk3-stage--off");
            this.stage.querySelector(".sk3-hint").textContent = T.noWebgl;
            return;
        }
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.scene = new Scene();
        this.camera = new PerspectiveCamera(28, 1, 0.05, 30);
        this.scene.add(new HemisphereLight(0xffffff, 0x8a8f99, 1.5));
        this.scene.add(new AmbientLight(0xffffff, 0.35));
        this.light = new DirectionalLight(0xffffff, 1.9);
        this.scene.add(this.light);
        this.scene.add(this.camera);
        const mat = (c, extra) => new MeshStandardMaterial(Object.assign({ color: new Color(c), roughness: 0.62, metalness: 0.02 }, extra || {}));
        this.mats = {
            bone: mat("#e9dfc8"), cartilage: mat("#c9d6dc"), teeth: mat("#f7f5ee", { roughness: 0.35 }), dark: mat("#3b2f2a", { roughness: 0.9 }),
            hover: mat("#fff6dd", { emissive: new Color("#6b5a2e"), emissiveIntensity: 0.35 }),
            hint: mat("#f5b83d", { emissive: new Color("#7a4d00"), emissiveIntensity: 0.25 }),
            sel: mat("#f08a7e", { emissive: new Color("#7a1d14"), emissiveIntensity: 0.2 }),
            active: mat("#e03a2c", { emissive: new Color("#8f1408"), emissiveIntensity: 0.4 })
        };
        this.contextMats = {};
        for (const kind of ["bone", "cartilage", "teeth", "dark"]) {
            this.contextMats[kind] = this.mats[kind].clone();
            Object.assign(this.contextMats[kind], { transparent: true, opacity: 0.34, depthWrite: false });
        }
        this.organMats = {};
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = false;
        this.controls.zoomToCursor = true;
        this.controls.rotateSpeed = 0.9;
        this.controls.addEventListener("change", () => { this.updateSides(); this.invalidate(); });
        this.raycaster = new Raycaster();
        this.setModel();
        this.home(false);

        let down = null;
        this.listen(this.canvas, "pointerdown", e => { down = e.button === 0 && e.isPrimary !== false ? { x: e.clientX, y: e.clientY, t: Date.now(), id:e.pointerId } : null; this.stage.classList.add("is-used"); });
        this.listen(this.canvas, "pointerup", e => {
            if (down && down.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && Date.now() - down.t < 600) { this.activatePick(e); }
            else { this.selectionTap = null; }
            down = null;
        });
        this.listen(this.canvas, "pointermove", event => {
            if (event.pointerType !== 'mouse' || event.buttons) { return; }
            this.hoverEvent = event;
            if (this.hoverFrame) { return; }
            this.hoverFrame = requestAnimationFrame(() => {
                this.hoverFrame = null;
                if (!this.destroyed) { this.onHover(this.hoverEvent); }
            });
        });
        this.listen(this.canvas, "pointerleave", () => { cancelAnimationFrame(this.hoverFrame); this.hoverFrame = null; this.setHover(null); });
        this.listen(this.canvas, "keydown", e => {
            const k = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, -0.15], ArrowDown: [0, 0.15] }[e.key];
            if (k) { e.preventDefault(); this.orbitBy(k[0], k[1]); }
        });
        this.queueResize = () => {
            if (this.resizeFrame != null) { return; }
            this.resizeFrame = requestAnimationFrame(() => { this.resizeFrame = null; if (!this.destroyed) { this.resize(); } });
        };
        if (window.ResizeObserver) {
            this.resizeObserver = new ResizeObserver(this.queueResize);
            this.resizeObserver.observe(this.stage);
            this.resizeObserver.observe(this.viewport);
        }
        this.listen(window, "resize", this.queueResize);
        this.resize();
    }
    setModel () {
        if (this.model) {
            this.scene.remove(this.model.group);
            this.model.meshes.forEach(m => { disposeBoundsTree.call(m.geometry); m.geometry.dispose(); });
        }
        this.model = buildSkeleton(this.sex);
        this.meshIndex = new Map();
        for (const mesh of this.model.meshes) {
            const d=mesh.userData;
            if(!mesh.geometry.boundsTree)mesh.geometry.boundsTree=new MeshBVH(mesh.geometry);
            mesh.raycast=acceleratedRaycast;
            for (const key of new Set(['A|'+d.area+'|','A|'+d.area+'|'+(d.side||''),'P|'+d.base+'|','P|'+d.base+'|'+(d.side||''),'P|'+(d.part||d.base)+'|','P|'+(d.part||d.base)+'|'+(d.side||'')])) {
                if(!this.meshIndex.has(key))this.meshIndex.set(key,[]);this.meshIndex.get(key).push(mesh);
            }
        }
        this.scene.add(this.model.group);
        this.boneIndex = null;
        this.modelSex = this.sex;
        this.modelTools?.renderTree(this.root.querySelector("[data-model-search]")?.value || "");
        this.paint();
    }
    allowsArea (id) {
        const a = areaById(id);
        return !!a && (!a.sex || a.sex === this.sex) && (!this.specialty.areas || this.specialty.areas.includes(id));
    }
    availableAreas () {
        return AREAS.filter(a => this.allowsArea(a.id));
    }
    availableComplaints () {
        if (this.clinic?.tableCatalog) { return (this.clinic.catalogComplaints || []).filter(complaint => complaint.areas.some(area => this.allowsArea(area))); }
        return complaintsForSpecialty(this.specialty.id).filter(complaint => complaint.areas.some(area => this.allowsArea(area)));
    }
    setSpecialty (id) {
        const configured = specialtyById(this.opts.specialtyItem ? (window.apex?.item ? window.apex.item(this.opts.specialtyItem).getValue() : document.getElementById(this.opts.specialtyItem)?.value) : this.opts.specialty);
        if (!this.opts.specialtySwitch && configured.id !== 'ALL' && specialtyById(id).id !== configured.id) { this.clinic?.message('The specialty is controlled by this page.'); return false; }
        this.modelTools?.leaveDetail();
        this.specialty = specialtyById(id);
        const select = this.root.querySelector(".sk3-specialty");
        if (select) { select.value = this.specialty.id; }
        const label = this.root.querySelector(".sk3-specialty-name");
        if (label) { label.textContent = this.specialty.name; }
        this.pending = null;
        this.setHover(null);
        this.closeResults();
        this.dxFilter = "";
        this.setLayer(this.specialty.layer);
        this.modelTools?.renderTree(this.root.querySelector("[data-model-search]")?.value || "");
        this.renderPanel();
        this.clinic?.loadComplaints().then(() => this.renderPanel()).catch(error => this.clinic.message(error.message));
        if (this.renderer) { this.home(true); }
    }
    setLayer (layer) {
        if (!["ANATOMY", "SKELETON", "ORGANS"].includes(layer)) { return; }
        const areas = this.availableAreas();
        if (layer === "SKELETON" && !areas.some(a => !a.organ)) { return; }
        if (layer === "ORGANS" && !areas.some(a => a.organ)) { return; }
        this.layer = layer;
        this.root.querySelectorAll('[data-seg="layer"] button').forEach(b => {
            const on = b.getAttribute("data-val") === layer;
            const value = b.getAttribute("data-val");
            b.disabled = (value === "SKELETON" && !areas.some(a => !a.organ)) || (value === "ORGANS" && !areas.some(a => a.organ));
            b.classList.toggle("is-on", on);
            b.setAttribute("aria-pressed", on);
        });
        this.setHover(null);
        this.paint();
    }
    resize () {
        if (!this.renderer) { return; }
        const w = this.viewport.clientWidth, h = this.viewport.clientHeight;
        if (!w || !h) { return; }
        const first = !this.sized;
        this.sized = true;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        if (first || !this.stage.classList.contains("is-used")) { this.home(false); }
        this.invalidate();
    }
    fitDistance (height, width) {
        const t = Math.tan(this.camera.fov * Math.PI / 360);
        return Math.max(height / 2 / t, width / 2 / (t * this.camera.aspect)) * 1.08;
    }
    home (animate) {
        if (!this.renderer || this.destroyed) { return; }
        // room under the feet for the captions
        const box = new Box3();
        for (const m of this.model.meshes) { if (m.visible) { box.expandByObject(m); } }
        if (box.isEmpty()) { return; }
        const size = box.getSize(new Vector3()), target = box.getCenter(new Vector3());
        const h = this.model.height;
        const d = this.fitDistance(size.y * 1.16 + 0.08, size.x * 1.12 + 0.08);
        target.y -= size.y * 0.015;
        this.controls.minDistance = 0.25;
        this.controls.maxDistance = Math.max(d * 1.6, h * 3);
        this.moveTo(target.clone().add(new Vector3(0, 0, d)), target, animate);
    }
    moveTo (pos, target, animate) {
        if (!animate) {
            this.anim = null;
            this.camera.position.copy(pos);
            this.controls.target.copy(target);
            this.controls.update();
            this.updateSides();
            this.invalidate();
            return;
        }
        const p0 = this.camera.position.clone(), t0 = this.controls.target.clone(), start = performance.now(), ms = 420;
        // turn around the figure instead of cutting through it: blend direction and distance separately
        const d0 = p0.clone().sub(t0), d1 = pos.clone().sub(target), r0 = d0.length(), r1 = d1.length();
        const a0 = Math.atan2(d0.x, d0.z), a1raw = Math.atan2(d1.x, d1.z);
        let da = a1raw - a0;
        while (da > Math.PI) { da -= 2 * Math.PI; }
        while (da < -Math.PI) { da += 2 * Math.PI; }
        const e0 = Math.asin(Math.max(-1, Math.min(1, d0.y / r0))), e1 = Math.asin(Math.max(-1, Math.min(1, d1.y / r1)));
        const token = this.anim = {};
        const step = now => {
            if (this.anim !== token) { return; }
            let u = Math.min((now - start) / ms, 1);
            u = u * u * (3 - 2 * u);
            const r = r0 + (r1 - r0) * u, a = a0 + da * u, el = e0 + (e1 - e0) * u;
            this.controls.target.lerpVectors(t0, target, u);
            this.camera.position.set(Math.sin(a) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(a) * Math.cos(el) * r).add(this.controls.target);
            this.controls.update();
            if (u < 1) { requestAnimationFrame(step); } else { this.anim = null; }
        };
        requestAnimationFrame(step);
    }
    orbitBy (da, de) {
        const t = this.controls.target, d = this.camera.position.clone().sub(t), r = d.length();
        const a = Math.atan2(d.x, d.z) + da, el = Math.max(-1.4, Math.min(1.4, Math.asin(d.y / r) + de));
        this.moveTo(new Vector3(Math.sin(a) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(a) * Math.cos(el) * r).add(t), t.clone(), false);
    }
    setView (name) {
        if (!this.renderer) { return; }
        const dir = { front: [0, 0, 1], back: [0, 0, -1], right: [-1, 0, 0], left: [1, 0, 0] }[name];
        if (!dir) { return; }
        const t = this.controls.target.clone(), r = this.camera.position.distanceTo(t);
        this.moveTo(new Vector3(dir[0] * r, 0, dir[2] * r).add(t), t, true);
    }
    meshesFor (site) { return this.meshIndex?.get(siteKey(site)) || []; }
    matches (site, ud) {
        if (site.part) { return (ud.part || ud.base) === site.part && (!site.side || ud.side === site.side); }
        if (site.bone) { return ud.base === site.bone && (!site.side || ud.side === site.side); }
        return ud.area === site.area && (!site.side || ud.side === site.side);
    }
    activatePick (event) {
        if (this.opts.selectionGesture !== 'DOUBLE' || (this.modelTools?.markerMode && this.modelTools.markerMode !== 'OFF')) { this.pick(event); return; }
        const data = this.hit(event);
        if (!data) { this.selectionTap = null; return; }
        const site = this.siteOf(data), key = siteKey(site), previous = this.selectionTap, now = performance.now();
        if (previous && previous.key === key && now - previous.time <= 450 && Math.hypot(previous.x-event.clientX, previous.y-event.clientY)<10) {
            this.selectionTap = null; this.pick(event);
        } else {
            this.selectionTap = { key, time:now, x:event.clientX, y:event.clientY }; this.setHover(site);
        }
    }
    focusSite (site, detail = false) {
        if (!this.allowsArea(site.area)) { this.clinic.message('This site is outside the configured specialty or patient anatomy.'); return false; }
        if (!this.renderer) { return; }
        const isolated = this.modelTools?.isolated;
        if (isolated && (isolated.area !== site.area || (isolated.side && site.side && isolated.side !== site.side))) {
            this.modelTools.leaveDetail(); this.modelTools.isolated = null; this.paint();
        }
        const organ = (areaById(site.area) || {}).organ;
        if (organ && this.layer === "SKELETON") { this.setLayer("ANATOMY"); }
        if (!organ && this.layer === "ORGANS") { this.setLayer("SKELETON"); }
        const box = new Box3();
        let any = false;
        for (const m of this.model.meshes) {
            if (this.matches(site, m.userData)) { box.expandByObject(m); any = true; }
        }
        if (!any) { return; }
        const c = box.getCenter(new Vector3()), size = box.getSize(new Vector3());
        const padding = detail ? 0.015 : 0.18;
        const d = Math.max(this.fitDistance(size.y * 1.9 + padding, size.x * 1.9 + padding), detail ? 0.1 : 0.55);
        this.controls.minDistance = detail ? Math.min(0.08, d * 0.6) : 0.25;
        if (detail) {
            const direction = this.camera.position.clone().sub(this.controls.target).normalize();
            this.moveTo(c.clone().addScaledVector(direction, d), c, true); return;
        }
        const back = BACK_AREAS[site.area] ? -1 : 1;
        this.moveTo(new Vector3(c.x, c.y + 0.04, c.z + back * d), c, true);
    }
    updateSides () {
        // the caption under the figure tells which side of the patient is on which side of the screen
        if (!this.sidesEl) { return; }
        const d = this.camera.position.clone().sub(this.controls.target);
        const a = Math.atan2(d.x, d.z);
        const front = Math.abs(a) < Math.PI / 4, back = Math.abs(a) > Math.PI * 3 / 4;
        this.sidesEl.hidden = !(front || back);
        this.sidesEl.classList.toggle("is-flip", back);
    }
    invalidate () {
        if (!this.renderer || this.queued) { return; }
        this.queued = true;
        requestAnimationFrame(() => {
            this.queued = false;
            if (this.destroyed) { return; }
            this.light.position.copy(this.camera.position).add(new Vector3(0.6, 1.2, 0.4));
            this.renderer.render(this.scene, this.camera);
            this.modelTools?.renderOverlay();
        });
    }
    // colour every mesh for its state: open site, other sites, a pending question, hover
    paint () {
        if (!this.renderer) { return; }
        this.appearance?.startPaint();
        const act = this.sites.find(s => siteKey(s) === this.active);
        const recordedMeshes = new Map();
        for(const site of this.sites){for(const mesh of this.meshesFor(site)){if(!recordedMeshes.has(mesh))recordedMeshes.set(mesh,site);}}
        for (const m of this.model.meshes) {
            const ud = m.userData;
            const organ = ud.kind === "organ";
            const extra = ud.layer && !["SKELETON", "ORGANS"].includes(ud.layer);
            const baseVisible = this.allowsArea(ud.area) && (organ ? this.layer !== "SKELETON" : this.layer !== "ORGANS");
            m.visible = this.modelTools ? this.modelTools.visible(m, baseVisible) : !extra && baseVisible;
            let mat = this.mats[ud.kind] || this.mats.bone;
            if (organ || extra) {
                if (!this.organMats[ud.color]) {
                    this.organMats[ud.color] = new MeshStandardMaterial({ color: new Color(ud.color), roughness: 0.47, metalness: 0 });
                }
                mat = this.organMats[ud.color];
            } else if (this.layer === "ANATOMY") {
                mat = this.contextMats[ud.kind];
            }
            if (ud.kind !== "dark") {
                if (act && this.matches(act, ud)) {
                    mat = this.mats.active;
                } else if (recordedMeshes.has(m)) {
                    mat = this.mats.sel;
                } else if (this.pending && this.pending.candidates.some(s => this.matches(s, ud))) {
                    mat = this.mats.hint;
                } else if (this.hover && this.matches(this.hover, ud)) {
                    mat = this.mats.hover;
                }
            }
            const recorded = recordedMeshes.get(m);
            m.material = this.modelTools?.material(m, mat, recorded?.assessment, !!recorded) || mat;
            if(this.appearance){m.material=this.appearance.material(m,m.material,!!recorded || mat===this.mats.hover || mat===this.mats.hint);}
        }
        this.visibleSites = this.sites.filter(site=>this.meshesFor(site).some(mesh=>mesh.visible));
        this.visibleMeshes = this.model.meshes.filter(mesh=>mesh.visible);
        this.modelTools?.refresh();
        this.invalidate();
    }
    hit (e) {
        const r = this.canvas.getBoundingClientRect();
        const p = new Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.raycaster.setFromCamera(p, this.camera);
        const hits = this.raycaster.intersectObjects(this.visibleMeshes || this.model.meshes.filter(m => m.visible), false)
            .filter(hit => !(hit.object.material.clippingPlanes || []).some(plane => plane.distanceToPoint(hit.point) < 0));
        let chosen = hits[0];
        if (this.modelTools?.detailView) {
            chosen = hits.find(hit => hit.object.userData.part === this.modelTools.inspectedPart) || hits.find(hit => hit.object.userData.layer === 'STRUCTURES') || chosen;
        }
        if (this.layer === "ANATOMY" && this.mode !== "BONE" && !this.modelTools?.parts && this.modelTools?.markerMode !== "POINT" && this.modelTools?.markerMode !== "AREA") {
            const organ = hits.find(h => h.object.userData.kind === "organ");
            if (organ) { chosen = organ; }
        }
        this.lastIntersection = chosen || null;
        return chosen ? chosen.object.userData : null;
    }
    siteOf (ud) {
        const area = areaById(ud.area);
        if (this.modelTools?.parts && ud.kind !== "dark") {
            return { area: ud.area, side: area?.sided ? ud.side : null, part: ud.part || ud.base, partName: ud.name };
        }
        if (this.mode === "BONE" && ud.kind !== "dark" && ud.kind !== "organ") {
            return { area: ud.area, side: ud.side, bone: ud.base, boneName: ud.name };
        }
        return { area: ud.area, side: area && area.sided ? ud.side : null, bone: null, boneName: null };
    }
    onHover (e) {
        const ud = this.hit(e);
        if (!ud) { this.setHover(null); return; }
        const site = this.siteOf(ud);
        this.setHover(site);
        const r = this.viewport.getBoundingClientRect();
        const sub = site.bone ? (areaById(ud.area) || {}).name : (ud.side ? SIDE_NAME[ud.side] + " " + lowerFirst(ud.name) : ud.name);
        this.tip.innerHTML = `<b>${esc(siteLabel(site))}</b><span>${esc(sub || "")}</span>`;
        this.tip.hidden = false;
        this.tip.style.left = Math.max(0, Math.min(e.clientX - r.left + 14, r.width - this.tip.offsetWidth)) + "px";
        this.tip.style.top = (e.clientY - r.top + 14) + "px";
    }
    setHover (site) {
        const a = this.hover ? siteKey(this.hover) : "", b = site ? siteKey(site) : "";
        if (!site) { this.tip.hidden = true; }
        this.canvas.style.cursor = site ? "pointer" : "";
        if (a === b) { return; }
        this.hover = site;
        this.paint();
    }
    pick (e) {
        const ud = this.hit(e);
        if (!ud || this.disabled) { return; }
        const site = this.siteOf(ud);
        if (this.modelTools?.handlePick(site)) { return; }
        const have = this.sites.find(s => siteKey(s) === siteKey(site));
        if (have) {
            this.open(have);
        } else if (!this.opts.readOnly) {
            const dx = this.pending && this.pending.dx && this.pending.candidates.some(c => c.area === site.area) ? this.pending.dx : null;
            this.addSite(site, dx, false, this.pending?.complaint);
        }
    }

    // ------------------------------------------------------------------ sites
    canEdit (openExam = true) {
        if (this.destroyed || this.valueError || this.patientContext?.validationMessage() || this.opts.readOnly || this.disabled) { return false; }
        if (this.clinic?.isBlocked()) { if (openExam) { this.clinic.openExam(); } return false; }
        return true;
    }
    addSite (site, dx, quiet, complaint) {
        if (!this.canEdit()) { return null; }
        const area = areaById(site.area);
        if (!area || (area.sex && area.sex !== this.sex)) { this.clinic.message('This anatomy is unavailable for the current model.'); return null; }
        const anatomyError = validateSiteAnatomy(site);
        if (anatomyError || !this.allowsArea(site.area)) { this.clinic.message(anatomyError || 'This anatomy is outside the configured specialty.'); return null; }
        let s = this.sites.find(x => siteKey(x) === siteKey(site));
        if (!s) {
            if (this.sites.length >= (this.opts.maxSites > 0 ? Math.min(500, this.opts.maxSites) : 500)) {
                this.note(T.max);
                return null;
            }
            s = { area: site.area, side: site.side || null, bone: site.bone || null, boneName: site.boneName || null,
                part: site.part || null, partName: site.partName || null, pain: null, note: "", diagnoses: [], complaints: [], markers: [] };
            this.sites.push(s);
        }
        const diagnosis = dx && normalizeTerm(dx, this.opts.system);
        if (diagnosis && !s.diagnoses.some(d => termKey(d) === termKey(diagnosis))) {
            if (s.diagnoses.length >= 100) { this.clinic.message('Each site supports up to 100 diagnoses.'); return s; }
            s.diagnoses.push(diagnosis);
        }
        if (complaint) { this.addComplaint(s, complaint, true); }
        this.pending = null;
        this.commit();
        if (!quiet) {
            this.open(s);
            this.fire("skeleton3dselect", { area: s.area, side: s.side, bone: s.bone, label: siteLabel(s) });
        }
        return s;
    }
    addComplaint (site, complaint, quiet = false) {
        if (!this.canEdit()) { return; }
        const normalized = normalizeTerm(complaint, "COMPLAINT");
        if (!normalized) { return; }
        site.complaints = site.complaints || [];
        if (!site.complaints.some(term => termKey(term) === termKey(normalized))) {
            if (site.complaints.length >= 100) { this.clinic.message('Each site supports up to 100 complaints.'); return; }
            site.complaints.push(normalized);
        }
        if (!quiet) { this.commit(); this.open(site); }
    }
    open (site) {
        this.active = siteKey(site);
        this.showAll = false;
        this.dxFilter = "";
        this.paint();
        this.renderPanel();
    }
    removeSite (key) {
        if (this.destroyed || this.valueError || this.opts.readOnly || this.disabled) { return; }
        this.sites = this.sites.filter(s => siteKey(s) !== key);
        if (this.active === key) { this.active = this.sites.length ? siteKey(this.sites[this.sites.length - 1]) : null; }
        this.commit();
        this.paint();
        this.renderPanel();
    }
    note (text) {
        this.clinic.message(text);
    }
    // a complaint, an area or a diagnosis was chosen from the list: add what is certain, ask for the rest
    choose (title, candidates, dx, complaint) {
        if (!this.canEdit()) { return; }
        const sure = candidates.length === 1 ? candidates : [];
        if (dx && !sure.length) {
            // a diagnosis that fits the open site goes straight to it
            const act = this.sites.find(s => siteKey(s) === this.active);
            const fits = act && candidates.some(c => (!c.part || c.part === act.part) && (c.area === act.area || this.areasOf(act).includes(c.area)));
            if (fits) { this.addSite(act, dx); return; }
        }
        if (sure.length) {
            const s = this.addSite(sure[0], dx, false, complaint);
            if (s) { this.focusSite(s); }
            return;
        }
        this.pending = { title, candidates, dx: dx || null, complaint: complaint || null };
        this.active = null;
        this.paint();
        this.renderPanel();
        if (candidates.length) {
            const areas = candidates.map(c => c.area).filter((a, i, l) => l.indexOf(a) === i);
            if (areas.length === 1) { this.focusSite({ area: areas[0], side: null, bone: candidates[0].bone }); } else { this.home(true); }
        }
    }
    candidatesFor (areaIds) {
        const out = [];
        for (const id of areaIds) {
            const a = areaById(id);
            if (!a || !this.allowsArea(id)) { continue; }
            if (a.sided) { out.push({ area: id, side: "L" }, { area: id, side: "R" }); } else { out.push({ area: id, side: null }); }
        }
        return out;
    }
    areasOf (site) {
        if (!site.bone || !this.model) { return [site.area]; }
        const list = [site.area];
        for (const m of this.model.meshes) {
            if (m.userData.base === site.bone && list.indexOf(m.userData.area) < 0) { list.push(m.userData.area); }
        }
        return list;
    }

    // ------------------------------------------------------------------ diagnoses
    server (data) {
        return new Promise((resolve, reject) => {
            window.apex.server.plugin(this.opts.ajaxId, data, { dataType: "json", success: resolve, error: (x, s, m) => reject(new Error(m || s)) });
        });
    }
    normalize (rows) {
        return (rows || []).filter(row => row && row.code != null && String(row.code).trim() && row.label != null && String(row.label).trim())
            .map(r => ({ code: String(r.code), label: String(r.label), areas: r.areas ? String(r.areas).toUpperCase().split(/[:,\s]+/).filter(Boolean) : [], system: r.system || this.opts.system, k: "" }));
    }
    async dxFor (areas, query = "") {
        const standard = await this.standardDxFor(areas);
        const site = this.sites.find(row => siteKey(row) === this.active);
        let local = [];
        try { local = await this.clinic.terms("DIAGNOSIS", areas, query, site?.part || site?.bone || ""); }
        catch (error) { if (!standard.length) { throw error; } this.clinic.message('Clinic diagnoses unavailable. Standard suggestions remain available. ' + error.message); }
        return standard.concat(local);
    }
    standardDxFor (areas) {
        const src = this.opts.dxSource;
        if (src === "NONE") { return Promise.resolve([]); }
        if (this.opts.ajaxId && src !== 'SQL') { return Promise.resolve([]); }
        const list = DIAGNOSES.filter(d => d.areas.some(a => areas.indexOf(a) >= 0));
        list.sort((a, b) => (a.areas[0] === areas[0] ? 0 : 1) - (b.areas[0] === areas[0] ? 0 : 1));
        return Promise.resolve(list);
    }
    async dxSearch (term) {
        const standard = await this.standardDxSearch(term);
        try { return standard.concat(await this.clinic.terms("DIAGNOSIS", this.availableAreas().map(area => area.id), term, "", true)); }
        catch (error) { if (!standard.length) { throw error; } this.clinic.message('Clinic diagnoses unavailable. Standard suggestions remain available. ' + error.message); return standard; }
    }
    standardDxSearch (term) {
        const src = this.opts.dxSource;
        if (src === "NONE") { return Promise.resolve([]); }
        if (this.opts.ajaxId && src !== 'SQL') { return Promise.resolve([]); }
        const words = term.toLowerCase().split(/\s+/).filter(Boolean);
        return Promise.resolve(DIAGNOSES.filter(d => {
            const hay = (d.code + " " + d.label + " " + d.k).toLowerCase();
            return d.areas.some(a => this.allowsArea(a)) && words.every(w => hay.indexOf(w) >= 0);
        }).slice(0, 12));
    }

    // ------------------------------------------------------------------ search
    bones () {
        if (!this.boneIndex && this.model) {
            const seen = {};
            this.boneIndex = [];
            for (const m of this.model.meshes) {
                const ud = m.userData;
                if (ud.kind === "dark" || ud.kind === "organ" || seen[ud.base]) { continue; }
                seen[ud.base] = 1;
                this.boneIndex.push({ base: ud.base, name: ud.name, area: ud.area, sided: !!ud.side });
            }
        }
        return (this.boneIndex || []).filter(b => this.allowsArea(b.area));
    }
    runSearch (term) {
        const q = term.trim().toLowerCase();
        if (q.length < 2) { this.closeResults(); return; }
        const words = q.split(/\s+/);
        const has = text => words.every(w => text.toLowerCase().indexOf(w) >= 0);
        // names that start with what was typed come first
        const rank = list => list.sort((x, y) => (x.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) - (y.name.toLowerCase().indexOf(q) === 0 ? 0 : 1));
        const groups = [];
        if (this.opts.complaints) {
            const c = rank(this.availableComplaints().filter(x => has(x.name + " " + x.k))).slice(0, 5);
            if (c.length) { groups.push([T.gComplaints, c.map(x => ({ t: "c", id: x.id, main: x.name, sub: x.areas.map(a => areaById(a).name).join(", ") }))]); }
        }
        const a = rank(this.availableAreas().filter(x => has(x.name))).slice(0, 5);
        if (a.length) { groups.push([T.gAreas, a.map(x => ({ t: "a", id: x.id, main: x.name, sub: "" }))]); }
        const b = rank(this.bones().filter(x => has(x.name))).slice(0, 6);
        if (b.length) { groups.push([T.gBones, b.map(x => ({ t: "b", id: x.base, main: x.name, sub: areaById(x.area).name }))]); }
        const token = this.searchToken = {};
        this.results.querySelectorAll('[aria-selected="true"]').forEach(button => button.setAttribute('aria-selected', 'false'));
        const draw = (dx, failed = false) => {
            if (this.searchToken !== token) { return; }
            const previous = this.results.querySelector('[data-res][aria-selected="true"]');
            const previousKey = previous ? previous.dataset.res + '|' + previous.dataset.id : null;
            const all = groups.slice();
            dx = dx.filter(d => !d.areas.length || d.areas.some(a => this.allowsArea(a)));
            if (dx.length) { all.push([T.gDx, dx.map((d, i) => ({ t: "d", id: i, main: d.label, code: d.code, sub: d.areas.map(x => (areaById(x) || {}).name).filter(Boolean).slice(0, 3).join(", ") }))]); }
            this.searchDx = dx;
            let resultIndex = 0;
            this.results.innerHTML = all.length
                ? all.map(g => `<div class="sk3-res-g">${esc(g[0])}</div>` + g[1].map(r =>
                    `<button type="button" class="sk3-res" id="${esc(this.id)}_result_${resultIndex++}" role="option" aria-selected="false" data-res="${r.t}" data-id="${esc(r.id)}">` + (r.code ? `<code>${esc(r.code)}</code>` : "") + `<span>${esc(r.main)}</span>` + (r.sub ? `<small>${esc(r.sub)}</small>` : "") + `</button>`).join("")).join("")
                : failed ? "" : `<div class="sk3-res-none">${esc(T.noResult)}</div>`;
            if (failed) { this.results.insertAdjacentHTML('beforeend', '<div class="sk3-load-error" role="alert">Diagnosis or clinic search is unavailable. <button type="button" class="sk3-link" data-act="retry-search">Retry search</button></div>'); }
            this.results.hidden = false;
            this.searchIn.setAttribute('aria-expanded', 'true');
            this.searchIn.removeAttribute('aria-activedescendant');
            const selected = [...this.results.querySelectorAll('[data-res]')].find(button => button.dataset.res + '|' + button.dataset.id === previousKey);
            if (selected) { selected.setAttribute('aria-selected', 'true'); this.searchIn.setAttribute('aria-activedescendant', selected.id); }
            this.root.querySelector('.sk3-search-status').textContent = resultIndex + ' search results' + (failed ? '. Some results could not be loaded.' : '');
        };
        draw([]);
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => Promise.allSettled([
            this.dxSearch(term.trim()), this.clinic.terms("COMPLAINT", this.availableAreas().map(area => area.id), term.trim(), "", true)
        ]).then(results => {
            if (this.searchToken !== token) { return; }
            const diagnoses = results[0].status === 'fulfilled' ? results[0].value : [];
            const complaints = results[1].status === 'fulfilled' ? results[1].value : [];
            this.searchComplaints = complaints;
            if (complaints.length) { groups.push(["Clinic complaints", complaints.map((row, index) => ({ t: "lc", id: index, main: row.label, sub: "" }))]); }
            draw(diagnoses,results.some(result=>result.status === 'rejected'));
        }).catch(() => { if (this.searchToken === token) { draw([], true); } }), this.opts.ajaxId ? 280 : 0);
    }
    closeResults () {
        if (this.results) { this.results.hidden = true; this.results.innerHTML = ""; }
        if (this.searchIn) { this.searchIn.setAttribute('aria-expanded', 'false'); this.searchIn.removeAttribute('aria-activedescendant'); }
        const status = this.root.querySelector('.sk3-search-status');
        if (status) { status.textContent = ''; }
        this.searchToken = null;
    }
    termCandidates (term) {
        if (!term.links?.length) { return this.candidatesFor(term.areas); }
        return term.links.flatMap(link => this.candidatesFor([link.area]).map(site => {
            if (!link.part) { return site; }
            const data = this.model?.meshes.find(mesh => mesh.userData.area === link.area && (mesh.userData.part || mesh.userData.base) === link.part)?.userData;
            return { ...site, part: link.part, partName: data?.name || link.part };
        }));
    }
    pickResult (type, id) {
        if (type === "c") {
            const c = this.availableComplaints().find(x => x.id === id);
            this.choose(c.name, (c.source === 'CUSTOM' ? this.termCandidates(c) : this.candidatesFor(c.areas)), null, complaintTerm(c));
        } else if (type === "lc") {
            const complaint = this.searchComplaints[Number(id)];
            this.choose(complaint.label, this.termCandidates(complaint), null, complaint);
        } else if (type === "a") {
            this.choose(areaById(id).name, this.candidatesFor([id]));
        } else if (type === "b") {
            const b = this.bones().find(x => x.base === id);
            const mk = side => ({ area: b.area, side, bone: b.base, boneName: b.name });
            this.choose(b.name, b.sided ? [mk("L"), mk("R")] : [mk(null)]);
        } else if (type === "d") {
            const d = this.searchDx[Number(id)];
            const areas = d.areas.filter(x => areaById(x));
            if (areas.length) {
                this.choose((d.code ? d.code + " " : "") + d.label, this.termCandidates(d), d);
            } else {
                // a diagnosis without an area goes to the open site
                const act = this.sites.find(s => siteKey(s) === this.active);
                if (act) { this.addSite(act, d); } else { this.choose((d.code ? d.code + " " : "") + d.label, this.candidatesFor(this.availableAreas().map(x => x.id)), d); }
            }
        }
        if (this.searchIn) { this.searchIn.value = ""; }
        this.closeResults();
    }

    // ------------------------------------------------------------------ panel
    renderPanel () {
        if (this.destroyed) { return; }
        const o = this.opts, ro = o.readOnly;
        const focused=document.activeElement, hadFocus=this.body.contains(focused);
        const focusData=hadFocus ? {id:focused.id,tag:focused.tagName,data:{...focused.dataset},site:focused.closest('[data-key]')?.dataset.key,selection:[focused.selectionStart,focused.selectionEnd]} : null;
        const scroll=this.body.scrollTop;
        const complaintsExpanded = this.body.querySelector('.sk3-more-complaints')?.open;
        const selected = this.sites.find(site => siteKey(site) === this.active);
        this.root.querySelector('.sk3-selection-label').textContent = selected ? siteLabel(selected) : (this.sites.length ? this.sites.length + ' recorded sites' : 'Select anatomy to record a finding');
        this.root.querySelector('[data-act="focus-selected"]').disabled = !selected || !this.renderer;
        this.root.querySelector('[data-act="findings"]').disabled = !this.sites.length;
        let h = "";
        if (this.pending) {
            const p = this.pending, sidedOnly = p.candidates.length === 2 && p.candidates[0].area === p.candidates[1].area;
            h += `<div class="sk3-ask"><div class="sk3-ask-t"><b>${esc(p.title)}</b> <span>${esc(sidedOnly ? T.whichSide : T.where)}</span></div><div class="sk3-ask-b">` +
                p.candidates.map((c, i) => `<button type="button" class="sk3-chip sk3-chip--go" data-cand="${i}">${esc(sidedOnly ? SIDE_NAME[c.side] : siteLabel(c))}</button>`).join("") +
                (sidedOnly ? `<button type="button" class="sk3-chip sk3-chip--go" data-cand="both">${esc(T.both)}</button>` : "") +
                `<button type="button" class="sk3-chip" data-act="cancel">${esc(T.cancel)}</button></div></div>`;
        }
        if (!this.sites.length && !this.pending) {
            h += `<p class="sk3-empty">${esc(ro ? T.emptyRO : T.empty)}</p>`;
        }
        for (const s of this.sites) {
            const key = siteKey(s), on = key === this.active;
            const sub = s.bone ? (areaById(s.area) || {}).name : "";
            h += `<section class="sk3-site${on ? " is-open" : ""}" data-key="${esc(key)}">` +
                `<header class="sk3-site-h"><button type="button" class="sk3-site-t" data-act="open" aria-expanded="${on}"><i class="sk3-dot"></i><span>${esc(siteLabel(s))}</span>` + (sub ? `<small>${esc(sub)}</small>` : "") +
                (s.pain != null ? `<em class="sk3-pain-b">${esc(T.pain)} ${s.pain}/10</em>` : "") + `</button>` +
                `<button type="button" class="sk3-ic" data-act="focus" title="${esc(T.show)}" aria-label="${esc(T.show)}">&#9678;</button>` +
                (ro ? "" : `<button type="button" class="sk3-ic" data-act="remove" title="${esc(T.remove)}" aria-label="${esc(T.remove)} ${esc(siteLabel(s))}">&#215;</button>`) +
                `</header>`;
            if (s.diagnoses.length) {
                h += `<ul class="sk3-dx">` + s.diagnoses.map((d, i) => `<li>${d.code ? `<code>${esc(d.code)}</code>` : `<small>Clinic</small>`}<span>${esc(d.label)}</span>` +
                    this.clinic.certaintyHtml(d, i) + (ro ? "" : `<button type="button" class="sk3-ic sk3-ic--s" data-act="undx" data-i="${i}" aria-label="${esc(T.remove)} ${esc(d.label)}">&#215;</button>`) + `</li>`).join("") + `</ul>`;
            }
            if (on && !ro) {
                if (o.dxSource !== "NONE") { h += `<div class="sk3-sug" data-sug="${esc(key)}"><div class="sk3-sug-t">${esc(T.suggested)}</div><div class="sk3-sug-l">${esc(T.loading)}</div></div>`; }
                if (o.pain) {
                    h += `<div class="sk3-row"><label>${esc(T.pain)}</label><div class="sk3-nrs" role="group" aria-label="${esc(T.pain)} 0-10">` +
                        Array.from({ length: 11 }, (x, i) => `<button type="button" class="sk3-nrs-b${s.pain === i ? " is-on" : ""}" data-pain="${i}" aria-pressed="${s.pain === i}">${i}</button>`).join("") + `</div></div>`;
                }
                if (o.note) { h += `<div class="sk3-row"><label for="${esc(this.id)}_note">${esc(T.note)}</label><textarea id="${esc(this.id)}_note" class="sk3-note" rows="3" maxlength="2000" placeholder="${esc(T.notePh)}">${esc(s.note)}</textarea></div>`; }
            } else if (s.note) {
                h += `<p class="sk3-note-ro">${esc(s.note)}</p>`;
            }
            h += this.clinic.siteHtml(s, on);
            h += this.modelTools?.siteHtml(s, on) || "";
            h += `</section>`;
        }
        const organs = this.availableAreas().filter(a => a.organ);
        if (organs.length && !ro) {
            h += `<details class="sk3-anatomy"${this.sites.length ? "" : " open"}><summary>Organs</summary><div class="sk3-quick-l">` +
                organs.map(a => `<button type="button" class="sk3-chip" data-area="${a.id}">${esc(a.name)}</button>`).join("") + `</div></details>`;
        }
        const complaints = this.availableComplaints();
        if (o.complaints && !ro && complaints.length) {
            const button = c => `<button type="button" class="sk3-chip" data-complaint="${c.id}">${esc(c.name)}</button>`;
            h += `<div class="sk3-quick"><div class="sk3-quick-t">${esc(T.complaints)}</div><div class="sk3-quick-l">` +
                complaints.slice(0, 12).map(button).join("") + `</div>` +
                (complaints.length > 12 ? `<details class="sk3-more-complaints"${complaintsExpanded ? ' open' : ''}><summary>More complaints (${complaints.length - 12})</summary><div class="sk3-quick-l">${complaints.slice(12).map(button).join('')}</div></details>` : '') + `</div>`;
        }
        this.body.innerHTML = h;
        if(focusData){
            const scope=[...this.body.querySelectorAll('[data-key]')].find(node=>node.dataset.key===focusData.site)||this.body;
            const controls=[...scope.querySelectorAll('button,input,select,textarea,summary')];
            const target=(focusData.id && document.getElementById(focusData.id)) || controls.find(node=>node.tagName===focusData.tag&&Object.entries(focusData.data).every(([key,value])=>node.dataset[key]===value)) || controls.find(node=>node.dataset.act==='open') || this.searchIn || this.canvas;
            target?.focus({preventScroll:true});
            if(target?.setSelectionRange && focusData.selection[0]!=null){try{target.setSelectionRange(...focusData.selection);}catch(_){}}
        }
        this.body.scrollTop=scroll;
        this.clinic.renderMaintenance();
        this.renderSuggestions();
        this.clinic.renderSite(this.sites.find(site => siteKey(site) === this.active));
    }
    renderSuggestions () {
        const box = this.body.querySelector(".sk3-sug");
        const site = this.sites.find(s => siteKey(s) === this.active);
        if (!box || !site) { return; }
        const key = this.active;
        const requestedFilter = this.dxFilter;
        const token = this.suggestionsToken = {};
        this.dxFor(this.areasOf(site), requestedFilter).then(list => {
            const now = this.body.querySelector(".sk3-sug");
            if (this.suggestionsToken !== token || !now || now.getAttribute("data-sug") !== key || this.dxFilter !== requestedFilter) { return; }
            const f = this.dxFilter.toLowerCase();
            let rows = list.filter(d => !site.diagnoses.some(x => termKey(x) === termKey(d)));
            const total = rows.length;
            if (f) { rows = rows.filter(d => (d.code + " " + d.label + " " + (d.k || "")).toLowerCase().indexOf(f) >= 0); }
            const cut = this.showAll || f ? rows : rows.slice(0, 7);
            this.sugRows = cut;
            const l = now.querySelector(".sk3-sug-l");
            const emptyMessage = !list.length ? T.noDx : !total ? T.allDxSelected : T.noMatchingDx;
            l.innerHTML = (total > 7 || f ? `<input type="search" class="sk3-sug-f" placeholder="${esc(T.filter)}" aria-label="${esc(T.filter)}" value="${esc(this.dxFilter)}">` : "") +
                (cut.length ? cut.map((d, i) => `<button type="button" class="sk3-sug-b" data-dx="${i}">${d.code ? `<code>${esc(d.code)}</code>` : `<small>Clinic</small>`}<span>${esc(d.label)}</span></button>`).join("") : `<p class="sk3-empty">${esc(emptyMessage)}</p>`) +
                (!f && total > 7 ? `<button type="button" class="sk3-link" data-act="more">${esc(this.showAll ? T.less : T.more + " (" + total + ")")}</button>` : "");
            if (this.refocusFilter) {
                const fi = l.querySelector(".sk3-sug-f");
                if (fi) { fi.focus(); fi.setSelectionRange(fi.value.length, fi.value.length); }
                this.refocusFilter = false;
            }
        }).catch(() => {
            if (this.suggestionsToken !== token || !box.isConnected) { return; }
            this.sugRows = [];
            box.querySelector('.sk3-sug-l').innerHTML = '<div class="sk3-load-error" role="alert">Unable to load diagnoses. <button type="button" class="sk3-link" data-act="retry-diagnoses">Retry</button></div>';
        });
    }
    onInput (e) {
        if (this.opts.readOnly || this.disabled) { return; }
        const t = e.target;
        if (t === this.searchIn) { this.runSearch(t.value); return; }
        if (t.classList.contains("sk3-sug-f")) { this.dxFilter = t.value; this.refocusFilter = true; this.renderSuggestions(); return; }
        if (t.classList.contains("sk3-note")) {
            const s = this.sites.find(x => siteKey(x) === this.active);
            if (s) { s.note = t.value; this.commitLater(); }
        }
    }
    onClick (e) {
        const b = e.target.closest("button");
        if (!b || !this.root.contains(b) || this.disabled) { return; }
        const seg = b.closest("[data-seg]");
        if (seg) {
            const name = seg.getAttribute("data-seg"), val = b.getAttribute("data-val");
            if (name === "view") { this.setView(val); return; }
            if (name === "layer") { this.setLayer(val); if (this.renderer) { this.home(true); } return; }
            if (name === "sex" && !this.canEdit()) { return; }
            seg.querySelectorAll("button").forEach(x => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-pressed", x === b); });
            if (name === "sex") { this.setSex(val); }
            if (name === "mode") { this.mode = val; this.setHover(null); if (val === "BONE") { this.setLayer("SKELETON"); } }
            return;
        }
        const section = b.closest(".sk3-site"), key = section ? section.getAttribute("data-key") : null;
        const site = key ? this.sites.find(s => siteKey(s) === key) : null;
        const act = b.getAttribute("data-act");
        if (act === 'retry-diagnoses') { this.renderSuggestions(); return; }
        if (act === 'retry-search') { this.runSearch(this.searchIn.value); return; }
        if (act === 'focus-selected') {
            const selected = this.sites.find(site => siteKey(site) === this.active);
            if (selected) { this.focusSite(selected); this.stage.scrollIntoView({ block: 'nearest' }); this.canvas.focus({ preventScroll: true }); }
            return;
        }
        if (act === 'findings') {
            this.modelTools?.closeInspector();
            const target = this.body.querySelector('.sk3-site.is-open .sk3-site-t') || this.body.querySelector('.sk3-site-t');
            target?.scrollIntoView({ block: 'nearest' }); target?.focus({ preventScroll: true }); return;
        }
        if (b.hasAttribute("data-area")) {
            const id = b.getAttribute("data-area");
            this.choose(areaById(id).name, this.candidatesFor([id]));
            return;
        }
        if (b.hasAttribute("data-res")) { this.pickResult(b.getAttribute("data-res"), b.getAttribute("data-id")); return; }
        if (b.hasAttribute("data-complaint")) {
            const c = this.availableComplaints().find(x => x.id === b.getAttribute("data-complaint"));
            this.choose(c.name, this.candidatesFor(c.areas), null, complaintTerm(c));
            this.root.querySelector(".sk3-panel").scrollTop = 0;
            return;
        }
        if (b.hasAttribute("data-cand")) {
            const p = this.pending, v = b.getAttribute("data-cand");
            if (!p) { return; }
            if (v === "both") {
                const additions = p.candidates.filter(candidate => !this.sites.some(site => siteKey(site) === siteKey(candidate))).length;
                if (this.sites.length + additions > (this.opts.maxSites > 0 ? Math.min(500, this.opts.maxSites) : 500)) { this.note(T.max); return; }
                this.addSite(p.candidates[0], p.dx, true, p.complaint);
                const s = this.addSite(p.candidates[1], p.dx, false, p.complaint);
                if (s) { this.focusSite({ area: s.area, side: null, bone: s.bone }); }
            } else {
                const s = this.addSite(p.candidates[Number(v)], p.dx, false, p.complaint);
                if (s) { this.focusSite(s); }
            }
            return;
        }
        if (b.hasAttribute("data-dx") && site) {
            const d = this.sugRows[Number(b.getAttribute("data-dx"))];
            if (d) { this.addSite(site, d); }
            return;
        }
        if (b.hasAttribute("data-pain") && site && this.canEdit()) {
            const n = Number(b.getAttribute("data-pain"));
            site.pain = site.pain === n ? null : n;
            this.commit();
            this.renderPanel();
            return;
        }
        if (act === "reset") { this.stage.classList.remove("is-used"); this.home(true); }
        if (act === "cancel") { this.pending = null; this.paint(); this.renderPanel(); }
        if (act === "more") { this.showAll = !this.showAll; this.renderSuggestions(); }
        if (act === "open" && site) { if (this.active === key && !this.opts.readOnly) { this.active = null; this.paint(); this.renderPanel(); } else { this.open(site); } }
        if (act === "focus" && site) { this.open(site); this.focusSite(site); }
        if (act === "remove" && site) { this.removeSite(key); }
        if (act === "undx" && site && this.canEdit()) { const removed = site.diagnoses.splice(Number(b.getAttribute("data-i")), 1)[0]; if (removed) { (site.markers || []).forEach(marker => { if (marker.diagnosis === termKey(removed)) { marker.diagnosis = null; } }); } this.commit(); this.renderPanel(); }
    }
    setSex (sex) {
        if (!this.canEdit()) { return; }
        sex = normalizeSex(sex);
        if (this.opts.sexLocked && sex !== normalizeSex(this.opts.sex)) { this.clinic.message('The model sex is controlled by the patient source.'); return false; }
        if (sex === this.sex) { return; }
        if (sex !== 'M' && this.sites.some(site => site.area === 'PROSTATE')) {
            this.clinic.message('Remove the prostate finding before changing the model sex.');
            return;
        }
        this.sex = sex;
        this.sexWarning.hidden=sex!=="U";
        this.dxCache = {};
        if (this.renderer) {
            this.setModel();
            if (!this.stage.classList.contains("is-used")) { this.home(false); }
        }
        const seg = this.root.querySelector('[data-seg="sex"]');
        if (seg) { seg.querySelectorAll("button").forEach(x => { const on = x.getAttribute("data-val") === sex; x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", on); }); }
        const tag = this.root.querySelector(".sk3-tag");
        if (tag) { tag.textContent = sex === "U" ? "Sex unconfirmed" : sex === "F" ? T.female : T.male; }
        this.commit();
        this.renderPanel();
    }

    // ------------------------------------------------------------------ APEX item
    setValue (text, silent) {
        this.parse(text);
        clearTimeout(this.commitTimer); this.commitTimer = null;
        this.selectionTap = null;
        this.dxCache = {};
        this.suggestionsToken = null;
        this.anim = null;
        this.closeResults();
        this.setHover(null);
        this.modelTools?.resetRecord();
        this.valueError = null;
        this.active = this.sites[0] ? siteKey(this.sites[0]) : null;
        this.pending = null;
        if (this.input) { this.input.value = this.serialize(); }
        this.setSexQuiet();
        this.paint();
        this.renderPanel();
        if (this.exam && this.clinic && !this.clinic.enabled) { this.clinic.enabled=true; this.clinic.ready=this.clinic.load(); }
        this.clinic?.renderExam();
        this.patientContext?.refresh();
        this.clinic?.message("");
        if (!silent) { this.fire("change"); this.fire("skeleton3dchange", this.input.value ? JSON.parse(this.input.value) : { v: 1, sex: this.sex, sites: [] }); }
    }
    setSexQuiet () {
        this.sexWarning.hidden=this.sex!=="U";
        if (this.renderer && this.model && this.modelSex !== this.sex) { this.setModel(); }
        this.modelSex = this.sex;
        const seg = this.root.querySelector('[data-seg="sex"]');
        if (seg) { seg.querySelectorAll("button").forEach(x => { const on = x.getAttribute("data-val") === this.sex; x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", on); }); }
        const tag = this.root.querySelector(".sk3-tag");
        if (tag) { tag.textContent = this.sex === "U" ? "Sex unconfirmed" : this.sex === "F" ? T.female : T.male; }
    }
    registerItem () {
        this.modelSex = this.sex;
        if (!window.apex || !window.apex.item || !this.input) { return; }
        const self = this;
        this.initialValue ??= this.serialize();
        this.itemRegistered = true;
        window.apex.item.create(this.id, {
            getValue () { self.flushCommit(); return self.input.value; },
            setValue (v, d, suppress) {
                try { self.setValue(v, true); }
                catch (error) { self.valueError = error.message; self.clinic.message(error.message); return; }
                if (!suppress) { self.fire('skeleton3dchange', self.input.value ? JSON.parse(self.input.value) : { v: 1, sex: self.sex, sites: [] }); }
            },
            isChanged () { return self.serialize() !== self.initialValue; },
            displayValueFor (v) {
                try { return (JSON.parse(v).sites || []).map(s => s.label).join(", "); } catch (e) { return ""; }
            },
            enable () { self.disabled = false; self.root.classList.remove("is-disabled"); self.input.disabled = false; },
            disable () { self.disabled = true; self.root.classList.add("is-disabled"); self.input.disabled = true; },
            isDisabled () { return self.disabled; },
            getValidity () { return { valid: self.disabled || !self.valueError && !self.patientContext?.validationMessage() && (self.clinic.skipSubmitValidation || !self.clinic.validate().length) }; },
            getValidationMessage () { return self.valueError || self.patientContext?.validationMessage() || (self.clinic.skipSubmitValidation ? "" : self.clinic.validate()[0]) || ""; },
            setFocusTo () { return window.apex.jQuery(self.searchIn || self.canvas); }
        });
    }
}

const api = {
    version: VERSION,
    attachJsonPreview (itemId, elementId) {
        const input = document.getElementById(itemId), output = document.getElementById(elementId);
        if (!input || !output) { return () => {}; }
        const render = () => {
            try {
                const value = window.apex?.item ? window.apex.item(itemId).getValue() : input.value;
                output.textContent = value == null || value === '' ? 'No sites recorded.' : JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2);
            } catch (_) { output.textContent = 'The item value is not valid JSON. Review the anatomy item before saving.'; }
        };
        if (window.apex?.jQuery) { window.apex.jQuery(input).off('change.sk3Preview').on('change.sk3Preview', render); }
        else { input.addEventListener('change',render); }
        render();
        return () => { if (window.apex?.jQuery) { window.apex.jQuery(input).off('change.sk3Preview'); } else { input.removeEventListener('change',render); } };
    },
    // initFn: the item's Initialization JavaScript Function - gets the options and may change or return them
    init (itemId, opts, initFn) {
        if (instances[itemId] && instances[itemId].root && document.body.contains(instances[itemId].root)) { return api.get(itemId); }
        if (instances[itemId]) { instances[itemId].destroy(); }
        let o = Object.assign({}, opts || {});
        if (typeof initFn === "function") { o = initFn(o) || o; }
        if ([true, 1, "true", "Y", "YES"].includes(opts?.readOnly)) { o.readOnly = true; }
        instances[itemId] = new Skeleton3D(itemId, o);
        return api.get(itemId);
    },
    // skeleton3d.get("P10_BODY_MAP"): the item's own functions
    get (itemId) {
        const w = instances[itemId];
        if (!w) { return null; }
        return {
            destroy: () => { w.destroy(); delete instances[itemId]; },
            load: value => { w.setValue(value, false); return w.serialize(); },
            refreshContext: () => w.patientContext.reload(),
            setReadOnly: readOnly => { w.opts.readOnly = w.readOnlyLock || !!readOnly; w.workspace.updateReadOnly(); },
            value: () => (w.serialize() ? JSON.parse(w.serialize()) : { v: 1, sex: w.sex, sites: [] }),
            select: (area, side, diagnosis) => {
                const a = areaById(String(area || "").toUpperCase());
                if (!a || !w.allowsArea(a.id)) { return null; }
                if (a.sided && !['L','R'].includes(side)) { w.clinic.message('Choose Left or Right before recording this site.'); return null; }
                const s = w.addSite({ area: a.id, side: a.sided ? side : null }, diagnosis || null);
                return s ? siteLabel(s) : null;
            },
            complaint: id => {
                const c = w.availableComplaints().find(x => x.id === String(id).toUpperCase() || x.code === String(id).toUpperCase() || x.name.toLowerCase() === String(id).toLowerCase());
                const candidates = c ? (c.source === 'CUSTOM' ? w.termCandidates(c) : w.candidatesFor(c.areas)) : [];
                if (candidates.length) { w.choose(c.name, candidates, null, complaintTerm(c)); }
                return candidates.length > 0;
            },
            clear: () => { if (w.canEdit()) { w.setValue("", false); } },
            setSex: sex => w.setSex(sex),
            view: name => w.setView(name),
            resetView: () => { w.stage.classList.remove("is-used"); w.home(true); },
            focus: (area, side) => w.focusSite({ area: String(area).toUpperCase(), side: side || null }),
            areas: () => w.availableAreas().map(a => Object.assign({}, a)),
            setSpecialty: id => w.setSpecialty(id),
            setLayer: layer => w.setLayer(String(layer).toUpperCase()),
            setColorMode: mode => w.appearance.setMode(mode),
            setNeonColor: color => w.appearance.setColor(color),
            setTheme: theme => w.appearance.setTheme(theme),
            specialties: () => SPECIALTIES.map(s => ({ id: s.id, name: s.name, areas: s.areas && s.areas.slice() })),
            complaints: () => w.availableComplaints().map(c => ({ id: c.id, name: c.name, areas: c.areas.slice() })),
            widget: w
        };
    }
};

if (typeof window !== "undefined") { window.skeleton3d = api; }
export default api;
