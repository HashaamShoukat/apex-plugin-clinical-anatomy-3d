import { Group, Mesh, SphereGeometry, MeshBasicMaterial, Vector3, BufferGeometry, Line, LineBasicMaterial, Plane, MeshStandardMaterial, Color, DoubleSide } from "three";
import { areaById } from "./catalog.js";
import { escapeHtml as esc, termKey } from "./clinical-value.js";

export class AnatomyTools {
    constructor (widget) {
        this.w = widget;
        this.features = new Set(String(widget.opts.modelTools || "").split(":"));
        this.layers = { SKELETON: true, ORGANS: true, MUSCLES: false, NERVES: false, VESSELS: false, STRUCTURES: false };
        this.opacity = { SKELETON: 0.34, ORGANS: 1, MUSCLES: 0.7, NERVES: 1, VESSELS: 1, STRUCTURES: 1 };
        this.undoValues = [];
        this.markerMode = "OFF";
        this.draft = [];
        this.materials = new Map();
        this.section = new Plane(new Vector3(0, 0, -1), 0.055);
        if (!widget.opts.modelTools) { return; }
        this.controls = document.createElement("div");
        this.controls.className = "sk3-view-controls";
        this.controls.innerHTML = `<details><summary><span><span class="sk3-eyebrow">Anatomy workspace</span>Model controls</span><span class="sk3-summary-hint">Visibility, selection & findings</span></summary><div class="sk3-control-grid"><div class="sk3-control-group"><h3>Navigate & inspect</h3><div class="sk3-model-actions">` +
            (this.enabled("PARTS") ? `<label class="sk3-check"><input type="checkbox" data-model-check="parts"> Select individual structures</label>` : "") +
            (this.enabled("LABELS") ? `<label class="sk3-check"><input type="checkbox" data-model-check="labels"> Show labels</label>` : "") + `</div></div>` +
            (this.enabled("SECTION") ? `<div class="sk3-control-group"><h3>Cross-section</h3><label class="sk3-check"><input type="checkbox" data-model-check="section"> Enable cross-section</label><label class="sk3-depth">Section depth<input type="range" min="-100" max="100" value="55" data-section-depth aria-label="Cross-section depth"></label></div>` : "") + `<div class="sk3-control-group"><h3>Findings & output</h3><div class="sk3-model-actions">` +
            (this.enabled("MARKERS") && !widget.opts.readOnly ? `<label>Marking<select data-marker-mode><option value="OFF">Select anatomy</option><option value="POINT">Point finding</option><option value="AREA">Outline an area</option></select></label><button type="button" class="sk3-chip" data-model="finish-area" hidden>Finish outline</button><button type="button" class="sk3-chip" data-model="cancel-area" hidden>Cancel outline</button><span class="sk3-draft-status" aria-live="polite"></span>` : "") +
            (this.enabled("UNDO") && !widget.opts.readOnly ? `<button type="button" class="sk3-chip" data-model="undo">Undo</button>` : "") +
            (this.enabled("EXPORT") ? `<button type="button" class="sk3-chip" data-model="export">Export annotated image</button>` : "") + `</div></div></div><div class="sk3-control-heading"><h3>Anatomy layers</h3><span>Toggle visibility and adjust opacity</span></div><div class="sk3-layer-controls">` +
            ["SKELETON", "ORGANS", ...(this.enabled("LAYERS") ? ["MUSCLES", "NERVES", "VESSELS", "STRUCTURES"] : [])].map(layer => `<label class="sk3-layer"><span>${layer.charAt(0) + layer.slice(1).toLowerCase()}</span><input type="checkbox" data-model-layer="${layer}" aria-label="Show ${layer.toLowerCase()}"${this.layers[layer] ? " checked" : ""}>` +
                (this.enabled("OPACITY") ? `<input type="range" min="0" max="100" value="${this.opacity[layer] * 100}" data-model-opacity="${layer}" aria-label="${layer.toLowerCase()} opacity">` : "") + `</label>`).join("") + `</div>` + (this.enabled("ASSESSMENT") ? `<div class="sk3-state-legend" aria-label="Finding status legend"><span><i class="sk3-status-dot sk3-status-dot--normal"></i>Normal</span><span><i class="sk3-status-dot sk3-status-dot--abnormal"></i>Abnormal</span><span><i class="sk3-status-dot"></i>Not assessed</span></div>` : "") +
            (this.enabled("LABELS") ? `<div class="sk3-browser-search"><label for="${esc(widget.id)}_structure_search">Anatomy browser</label><input id="${esc(widget.id)}_structure_search" class="sk3-input" type="search" data-model-search placeholder="Search structures, organs or bones…" aria-label="Find an anatomical structure"></div>` : "") + `<div class="sk3-structure-results"></div></details>`;
        this.controls.setAttribute('role', 'region');
        this.controls.setAttribute('aria-label', 'Model controls');
        const heading = (title, action) => `<div class="sk3-inspector-heading"><strong>${title}</strong><button type="button" class="sk3-chip" data-model="${action}" aria-label="Close ${title.toLowerCase()}">Close</button></div>`;
        this.controls.querySelector('summary').insertAdjacentHTML('afterend', heading('Model controls', 'close-controls'));
        widget.sideSlot.append(this.controls);
        this.browser = document.createElement('div');
        this.browser.className = 'sk3-browser-drawer'; this.browser.id = widget.id + '_browser'; this.browser.hidden = true;
        this.browser.setAttribute('role', 'region'); this.browser.setAttribute('aria-label', 'Anatomy browser');
        this.browser.innerHTML = heading('Anatomy browser', 'close-browser') + (!widget.opts.readOnly ? '<button type="button" class="sk3-chip" data-model="record-structure" hidden>Record selected structure</button>' : '');
        this.controls.querySelectorAll('.sk3-browser-search,.sk3-structure-results').forEach(node => this.browser.append(node));
        widget.sideSlot.append(this.browser);
        widget.root.querySelector('.sk3-viewer-actions').insertAdjacentHTML('afterbegin',
            (this.enabled('ISOLATE') ? '<button type="button" class="sk3-chip" data-model="isolate" disabled>Isolate selected</button><button type="button" class="sk3-chip" data-model="reveal">Full anatomy</button>' : '') +
            (this.enabled('LABELS') ? `<button type="button" class="sk3-chip" data-model="browser" aria-expanded="false" aria-controls="${esc(this.browser.id)}">Anatomy browser</button>` : ''));
        widget.listen(this.controls.querySelector('details'), 'toggle', () => {
            if (this.controls.querySelector('details').open) { this.browser.hidden = true; }
            this.syncInspector();
        });
        widget.listen(widget.root, 'keydown', event => {
            if (event.key === 'Escape' && (this.controls.contains(event.target) || this.browser.contains(event.target))) {
                event.preventDefault(); this.closeInspector(true);
            }
        });
        this.hidden = document.createElement("div"); this.hidden.className = "sk3-hidden-sites"; this.hidden.hidden = true;
        widget.root.insertBefore(this.hidden, widget.stage);
        this.overlay = document.createElement("div"); this.overlay.className = "sk3-label-overlay"; widget.viewport.append(this.overlay);
        this.detailPanel = document.createElement('div'); this.detailPanel.className = 'sk3-detail-panel'; this.detailPanel.hidden = true;
        widget.stage.querySelector('.sk3-viewer-header').append(this.detailPanel);
        this.markerGroup = new Group();
        widget.scene?.add(this.markerGroup);
        widget.listen(widget.root, "click", event => this.click(event));
        widget.listen(widget.root, "input", event => this.input(event));
        widget.listen(widget.root, "change", event => this.change(event));
        if (this.enabled("LABELS")) { this.renderTree(""); }
        this.updateMarking();
    }

    enabled (feature) { return this.features.has(feature) || this.features.has("ALL"); }

    syncInspector () {
        const controlsOpen = this.controls.querySelector('details').open;
        const browserOpen = !this.browser.hidden;
        this.w.sideSlot.querySelector('.sk3-panel').hidden = controlsOpen || browserOpen;
        this.w.root.querySelector('[data-model="browser"]')?.setAttribute('aria-expanded', String(browserOpen));
    }

    closeInspector (restoreFocus = false) {
        if (!this.controls) { return; }
        const trigger = this.w.root.querySelector(this.browser.hidden ? '[data-act="controls"]' : '[data-model="browser"]');
        this.controls.querySelector('details').open = false; this.browser.hidden = true;
        this.syncInspector();
        if (restoreFocus) { trigger?.focus({ preventScroll: true }); }
    }

    resetRecord () {
        this.leaveDetail();
        if (!this.undoing) { this.undoValues = []; }
        this.draft = []; this.draftTarget = null; this.draftSite = null;
        this.isolated = null;
        this.updateMarking();
    }

    disposeMaterials () {
        for (const material of this.materials.values()) { material.dispose(); }
        this.materials.clear();
    }

    detailEntries (site) {
        const seen = new Set();
        return (this.w.model?.meshes || []).filter(mesh => {
            const data = mesh.userData;
            const key = data.part || ('BONE:' + data.base + ':' + (data.side || ''));
            if (data.kind === 'dark' || data.area !== site.area || (site.side && data.side !== site.side) || !data.base || seen.has(key)) { return false; }
            seen.add(key); return true;
        }).map(mesh => ({...mesh.userData, detailKey:mesh.userData.part || ('BONE:' + mesh.userData.base + ':' + (mesh.userData.side || ''))}));
    }

    detailTarget (entry) {
        return { area:entry.area, side:entry.side, ...(entry.part ? {part:entry.part,partName:entry.name} : {bone:entry.base,boneName:entry.name}) };
    }

    syncControls () {
        this.controls?.querySelectorAll('[data-model-layer]').forEach(input => { input.checked = this.layers[input.dataset.modelLayer]; });
        this.controls?.querySelectorAll('[data-model-opacity]').forEach(input => { input.value = this.opacity[input.dataset.modelOpacity] * 100; });
        for (const [name, value] of [['parts', this.parts], ['labels', this.showLabels], ['section', this.crossSection]]) {
            const input = this.controls?.querySelector('[data-model-check="' + name + '"]');
            if (input) { input.checked = !!value; }
        }
    }

    exploreDetail () {
        if (!this.isolated || this.detailEntries(this.isolated).length < 2 || this.detailView) { return; }
        if (this.draft.length) { this.w.clinic.message('Finish or cancel the current outline before exploring organ details.'); return; }
        this.detailSnapshot = { layers: { ...this.layers }, opacity: { ...this.opacity }, parts: this.parts,
            crossSection: this.crossSection, layer: this.w.layer, isolated: this.isolated,
            controlsOpen: this.controls.querySelector('details').open };
        this.detailView = { area: this.isolated.area, side: this.isolated.side || null };
        this.isolated = { ...this.detailView };
        this.parts = true; this.crossSection = false;
        const entries = this.detailEntries(this.isolated);
        for (const entry of entries) { this.layers[entry.layer || (entry.kind === 'organ' ? 'ORGANS' : 'SKELETON')] = true; }
        this.layers.STRUCTURES = true;
        this.opacity.ORGANS = 0.18; this.opacity.STRUCTURES = 1;
        this.w.renderer.localClippingEnabled = false;
        if (window.matchMedia('(max-width:600px)').matches) { this.controls.querySelector('details').open = false; }
        const bones = entries.some(entry => entry.kind !== 'organ'), organs = entries.some(entry => entry.kind === 'organ');
        this.w.setLayer(bones ? (organs ? 'ANATOMY' : 'SKELETON') : 'ORGANS'); this.syncControls();
        this.w.paint(); this.w.focusSite(this.detailView, true);
    }

    leaveDetail () {
        if (!this.detailSnapshot) { return; }
        const snapshot = this.detailSnapshot;
        this.detailSnapshot = null; this.detailView = null; this.inspectedPart = null; this.inspectedTarget = null;
        this.layers = snapshot.layers; this.opacity = snapshot.opacity; this.parts = snapshot.parts;
        this.crossSection = snapshot.crossSection; this.isolated = snapshot.isolated;
        if (this.w.renderer) { this.w.renderer.localClippingEnabled = !!this.crossSection; }
        this.w.layer = snapshot.layer;
        this.controls.querySelector('details').open = snapshot.controlsOpen;
        this.syncControls();
    }

    renderDetail () {
        if (!this.detailPanel) { return; }
        const selected = this.w.sites.find(site => this.w.keyOf(site) === this.w.active);
        const isolate = this.w.root.querySelector('[data-model="isolate"]');
        if (isolate) { isolate.disabled = !selected || !this.w.renderer; }
        this.detailPanel.hidden = !this.isolated;
        if (!this.isolated) { this.detailSignature = null; return; }
        const entries = this.detailEntries(this.isolated);
        const signature = this.w.keyOf(this.isolated) + '|' + !!this.detailView + '|' + (this.inspectedPart || '') + '|' + this.w.opts.readOnly;
        if (signature === this.detailSignature) { return; }
        this.detailSignature = signature;
        this.detailPanel.innerHTML = '<div class="sk3-detail-heading"><strong>' + esc(this.w.labelOf(this.isolated)) + '</strong><div class="sk3-detail-actions">' +
            (this.detailView ? '<button type="button" class="sk3-chip" data-model="whole-organ">' + (this.detailSnapshot.isolated.part || this.detailSnapshot.isolated.bone ? 'Back to isolated structure' : entries.some(entry => entry.kind !== 'organ') ? 'Whole area' : 'Whole organ') + '</button>' : entries.length > 1 ? '<button type="button" class="sk3-chip" data-model="explore-detail">Explore details</button>' : '') +
            '</div></div>' +
            (this.detailView ? '<label>Inspect a structure<select data-detail-part><option value="">All structures</option>' + entries.map(data => '<option value="' + esc(data.detailKey) + '"' + (data.detailKey === this.inspectedPart ? ' selected' : '') + '>' + esc(data.name) + (data.side && !this.detailView.side ? ' (' + esc(data.side) + ')' : '') + '</option>').join('') + '</select></label>' +
                (this.inspectedPart && !this.w.opts.readOnly ? '<div class="sk3-detail-actions"><button type="button" class="sk3-chip sk3-chip--go" data-model="record-detail">Record finding on this structure</button></div>' : '') +
                '<p>' + (this.w.opts.readOnly ? 'Choose a structure to magnify it and review the recorded findings.' : 'Choose a structure to magnify it. Select anatomy on the model to record a finding.') + '</p>' : '<p>Isolated view. Rotate or zoom to inspect the selected anatomy.</p>');
    }

    visible (mesh, base) {
        const layer = mesh.userData.layer || (mesh.userData.kind === "organ" ? "ORGANS" : "SKELETON");
        const extra = !["SKELETON", "ORGANS"].includes(layer);
        if (extra && !this.enabled("LAYERS") && !(this.detailView && this.isolated && this.w.matches(this.isolated, mesh.userData))) { return false; }
        if (!this.layers[layer] || this.opacity[layer] === 0) { return false; }
        if (this.isolated && !this.w.matches(this.isolated, mesh.userData)) { return false; }
        return this.w.allowsArea(mesh.userData.area) && (extra || base);
    }

    material (mesh, original, state, selected = false) {
        if (!this.controls) { return original; }
        const settings = JSON.stringify(this.opacity) + this.crossSection + this.changedSkeletonOpacity;
        if (settings !== this.materialSettings) { this.disposeMaterials(); this.materialSettings = settings; }
        const layer = mesh.userData.layer || (mesh.userData.kind === "organ" ? "ORGANS" : "SKELETON");
        let opacity = layer === "SKELETON" && this.w.layer === "SKELETON" && !this.changedSkeletonOpacity ? 1 : this.opacity[layer] ?? 1;
        if (selected && layer === 'SKELETON' && !this.changedSkeletonOpacity) { opacity = Math.max(opacity, 0.82); }
        if (this.detailView && this.inspectedPart && mesh.userData.area === this.detailView.area) {
            opacity = this.inspectedTarget && this.w.matches(this.inspectedTarget, mesh.userData) ? 1 : Math.min(opacity, 0.08);
        }
        const key = original.uuid + "|" + opacity + "|" + state + "|" + this.crossSection;
        if (!this.materials.has(key)) {
            const material = original.clone();
            if (state === "NORMAL") { material.color.set("#16845b"); }
            if (state === "ABNORMAL") { material.color.set("#d93a2c"); }
            if (state === "NOT_ASSESSED") { material.color.set("#7f8995"); }
            material.opacity = opacity; material.transparent = opacity < 1; material.depthWrite = opacity === 1;
            if (this.crossSection && layer === "ORGANS") { material.clippingPlanes = [this.section]; material.clipShadows = true; material.side = DoubleSide; }
            this.materials.set(key, material);
        }
        return this.materials.get(key);
    }

    remember (value) {
        if (!this.enabled("UNDO") || this.undoing || this.w.opts.readOnly || this.undoValues.at(-1) === value) { return; }
        this.undoValues.push(value || "");
        if (this.undoValues.length > 50) { this.undoValues.shift(); }
    }

    refresh () {
        if (!this.controls || !this.w.model) { return; }
        this.renderDetail();
        const hidden = this.w.sites.length - (this.w.visibleSites || []).length;
        this.hidden.hidden = hidden === 0;
        this.hidden.innerHTML = `${hidden} recorded site${hidden === 1 ? " is" : "s are"} outside the visible anatomy. <button type="button" class="sk3-chip" data-model="reveal">Reveal</button>`;
        this.refreshMarkers();
        this.renderOverlay();
    }

    refreshMarkers () {
        if (!this.markerGroup) { return; }
        const visibleSites = this.w.visibleSites || [];
        const signature = JSON.stringify([this.w.model.group.scale.x, visibleSites.map(site => site.markers || []), this.draft]);
        if (signature === this.markerSignature) { return; }
        this.markerSignature = signature;
        for (const child of [...this.markerGroup.children]) {
            if (child.isLine) { child.geometry.dispose(); }
            this.markerGroup.remove(child);
        }
        this.markerGeometry ||= new SphereGeometry(0.005, 10, 8);
        this.markerMaterial ||= new MeshBasicMaterial({ color: '#2e66d2', depthTest: false });
        this.draftMaterial ||= new MeshBasicMaterial({ color: '#e29e28', depthTest: false });
        this.markerLineMaterial ||= new LineBasicMaterial({ color: '#2e66d2', depthTest: false, transparent: true });
        const scale = this.w.model.group.scale.x;
        const add = (points, draft = false) => {
            const vectors = points.map(point => new Vector3(...point).multiplyScalar(scale));
            const geometry = new BufferGeometry().setFromPoints(vectors.length > 1 && !draft ? vectors.concat(vectors[0]) : vectors);
            if (vectors.length > 1) { this.markerGroup.add(new Line(geometry, this.markerLineMaterial)); }
            else { geometry.dispose(); }
            for (const point of vectors) {
                const marker = new Mesh(this.markerGeometry, draft ? this.draftMaterial : this.markerMaterial);
                marker.position.copy(point); marker.scale.setScalar(scale); marker.renderOrder = 20; this.markerGroup.add(marker);
            }
        };
        for (const site of visibleSites) {
            for (const marker of site.markers || []) { add(marker.points); }
        }
        if (this.draft.length) { add(this.draft, true); }
    }

    updateMarking () {
        if (!this.controls) { return; }
        const drawing = this.markerMode === "AREA" && !this.w.opts.readOnly;
        const finish = this.controls.querySelector('[data-model="finish-area"]');
        const cancel = this.controls.querySelector('[data-model="cancel-area"]');
        if (finish) { finish.hidden = !drawing; finish.disabled = this.draft.length < 3; }
        if (cancel) { cancel.hidden = !drawing || !this.draft.length; }
        const status = this.controls.querySelector('.sk3-draft-status');
        if (status) { status.textContent = drawing ? this.draft.length + ' points - click at least 3 points on one site, then Finish outline.' : this.markerMode === "POINT" ? 'Click the model to add a point finding.' : ''; }
    }

    handlePick (site) {
        if (!this.enabled("MARKERS") || this.markerMode === "OFF" || this.w.opts.readOnly) { return false; }
        if (!this.w.canEdit()) { return true; }
        const hit = this.w.lastIntersection;
        if (!hit) { return false; }
        const point = this.w.model.group.worldToLocal(hit.point.clone()).toArray();
        if (this.markerMode === "POINT") {
            const existing = this.w.sites.find(row => this.w.keyOf(row) === this.w.keyOf(site)) || this.w.addSite(site);
            if (existing) { this.addMarker(existing, [point], "POINT"); }
        } else {
            if (this.draft.length && this.draftSite !== this.w.keyOf(site)) { this.w.clinic.message("Keep this outline on the same anatomical site, or finish/cancel it before starting another."); return true; }
            if (this.draft.length >= 100) { this.w.clinic.message("Finish this outline before adding more points. Each outline supports up to 100 points."); return true; }
            this.draftSite = this.w.keyOf(site); this.draftTarget = site; this.draft.push(point); this.w.paint();
        }
        this.updateMarking();
        return true;
    }

    addMarker (site, points, kind) {
        if (!this.w.canEdit() || !site) { return; }
        if (!["POINT", "AREA"].includes(kind) || !Array.isArray(points) || points.length < (kind === "AREA" ? 3 : 1) || points.length > 100 ||
            !points.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) {
            this.w.clinic.message("Use finite XYZ coordinates and up to 100 points per finding. An outline requires at least three points.");
            return;
        }
        if ((site.markers || []).length >= 100) { this.w.clinic.message('Each site supports up to 100 markers.'); return; }
        this.w.checkpoint();
        site.markers = site.markers || [];
        let id;
        do { id = window.crypto?.randomUUID ? window.crypto.randomUUID() : 'finding-' + Date.now().toString(36) + '-' + (this.markerSequence = (this.markerSequence || 0) + 1).toString(36); }
        while (site.markers.some(marker => marker.id === id));
        site.markers.push({ id, kind, points, label: "Finding " + (site.markers.length + 1), diagnosis: null });
        this.w.commit(); this.w.open(site);
    }

    siteHtml (site, open) {
        if (!this.controls) { return ""; }
        let html = "";
        if (this.enabled("ASSESSMENT") && open && !this.w.opts.readOnly) {
            html += `<div class="sk3-finding-state"><label>Finding state<select data-model-assessment${this.w.opts.readOnly ? " disabled" : ""}><option value="">Not recorded</option>` +
                [["NOT_ASSESSED", "Not assessed"], ["NORMAL", "Normal"], ["ABNORMAL", "Abnormal"]].map(([value, label]) => `<option value="${value}"${site.assessment === value ? " selected" : ""}>${label}</option>`).join("") + `</select></label><button type="button" class="sk3-chip" data-model="clear-assessment">Clear state</button></div>`;
        } else if (site.assessment) {
            html += `<p class="sk3-recorded-state">Finding: <strong>${esc(({NORMAL:"Normal",ABNORMAL:"Abnormal",NOT_ASSESSED:"Not assessed"})[site.assessment] || site.assessment)}</strong></p>`;
        }
        if (site.markers?.length) {
            html += `<div class="sk3-marker-list">` + site.markers.map((marker, index) => `<div><input data-marker-label="${index}" aria-label="Finding label" maxlength="120" value="${esc(marker.label)}"${this.w.opts.readOnly ? " disabled" : ""}><select data-marker-diagnosis="${index}" aria-label="Finding diagnosis"${this.w.opts.readOnly ? " disabled" : ""}><option value="">Diagnosis not linked</option>` +
                site.diagnoses.map(term => `<option value="${esc(termKey(term))}"${marker.diagnosis === termKey(term) ? " selected" : ""}>${esc(term.label)}</option>`).join("") + `</select>` +
                (this.w.opts.readOnly ? "" : `<button type="button" class="sk3-chip sk3-marker-remove" data-model="remove-marker" data-index="${index}" aria-label="Remove finding">Remove</button>`) + `</div>`).join("") + `</div>`;
        }
        return html;
    }

    renderOverlay () {
        if (!this.overlay || !this.w.camera) { return; }
        const labels = [];
        const occupied = [];
        const project = position => {
            const point = position.clone().project(this.w.camera);
            return { x: (point.x + 1) * this.w.viewport.clientWidth / 2, y: (1 - point.y) * this.w.viewport.clientHeight / 2, visible: point.z > -1 && point.z < 1 };
        };
        if (this.showLabels) {
            const seen = new Set();
            for (const mesh of this.w.model.meshes) {
                const data = mesh.userData, key = (data.part || data.base) + data.side;
                if (!mesh.visible || data.detail || data.kind === "dark" || seen.has(key)) { continue; }
                seen.add(key);
                if (!mesh.geometry.boundingBox) { mesh.geometry.computeBoundingBox(); }
                const center = mesh.geometry.boundingBox.getCenter(new Vector3()).applyMatrix4(mesh.matrixWorld);
                const point = project(center);
                if (!point.visible || point.x < 20 || point.y < 60 || point.x > this.w.viewport.clientWidth - 80 || point.y > this.w.viewport.clientHeight - 30 || occupied.some(p => Math.abs(p.x - point.x) < 95 && Math.abs(p.y - point.y) < 27)) { continue; }
                occupied.push(point); labels.push({ ...point, label: data.side ? (data.side === "L" ? "Left " : "Right ") + data.name : data.name });
                if (labels.length >= 18) { break; }
            }
        }
        for (const site of this.w.visibleSites || []) {
            for (const marker of site.markers || []) {
                const point = project(new Vector3(...marker.points[0]).multiplyScalar(this.w.model.group.scale.x));
                if (point.visible) { labels.push({ ...point, label: marker.label || "Finding", marker: true }); }
            }
        }
        const signature = JSON.stringify(labels.map(label => [label.label, !!label.marker]));
        if (signature !== this.labelSignature || this.overlay.childElementCount !== labels.length) {
            this.labelSignature = signature;
            this.overlay.innerHTML = labels.map(label => '<span class="' + (label.marker ? 'is-finding' : '') + '">' + esc(label.label) + '</span>').join('');
        }
        this.overlay.querySelectorAll('span').forEach((node, index) => { node.style.setProperty('--sk3-label-x', Math.round(labels[index].x) + 'px'); node.style.setProperty('--sk3-label-y', Math.round(labels[index].y) + 'px'); });
    }

    reveal () {
        this.leaveDetail();
        this.isolated = null; this.draft = []; this.w.setLayer("ANATOMY");
        for (const site of this.w.sites) {
            for (const mesh of (this.w.model?.meshes || []).filter(mesh => this.w.matches(site, mesh.userData))) { this.layers[mesh.userData.layer || (mesh.userData.kind === "organ" ? "ORGANS" : "SKELETON")] = true; }
        }
        this.layers.SKELETON = true; this.layers.ORGANS = true;
        this.controls.querySelectorAll("[data-model-layer]").forEach(input => { input.checked = this.layers[input.dataset.modelLayer]; });
        this.w.paint(); this.w.home(true);
    }

    exportImage () {
        if (!this.w.renderer) { return; }
        this.w.renderer.render(this.w.scene, this.w.camera);
        const canvas = document.createElement("canvas"), source = this.w.canvas;
        canvas.width = source.width; canvas.height = source.height + 100;
        const context = canvas.getContext("2d"); context.fillStyle = "#f3f5f8"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0);
        const ratio = source.width / this.w.viewport.clientWidth;
        context.font = Math.round(12 * ratio) + "px sans-serif";
        for (const label of this.overlay.querySelectorAll("span")) { context.fillStyle = label.classList.contains("is-finding") ? "#174aab" : "#263341"; context.fillText(label.textContent, parseFloat(label.style.getPropertyValue('--sk3-label-x')) * ratio, parseFloat(label.style.getPropertyValue('--sk3-label-y')) * ratio); }
        context.fillStyle = "#263341"; context.fillText(this.w.specialty.name + " · " + this.w.layer, 16, source.height + 24);
        const link = document.createElement("a"); link.download = "anatomy-findings.png"; link.href = canvas.toDataURL("image/png"); link.click();
    }

    renderTree (query) {
        if (!this.enabled("LABELS") || !this.w.model || !this.controls) { return; }
        this.browserTarget = null;
        const record = this.browser.querySelector('[data-model="record-structure"]');
        if (record) { record.hidden = true; }
        const seen = new Set(), words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
        this.structureResults = this.w.model.meshes.filter(mesh => {
            const data = mesh.userData, key = data.area + "|" + (data.part || data.base) + "|" + data.side;
            const extra = data.layer && !["SKELETON", "ORGANS"].includes(data.layer);
            const text = (data.name + " " + (areaById(data.area)?.name || data.area)).toLowerCase();
            if (data.kind === "dark" || !this.w.allowsArea(data.area) || (extra && !this.enabled("LAYERS")) || seen.has(key) || !words.every(word => text.includes(word))) { return false; }
            seen.add(key); return true;
        }).map(mesh => mesh.userData);
        const groups = new Map();
        this.structureResults.forEach((data, index) => {
            if (!groups.has(data.area)) { groups.set(data.area, []); }
            groups.get(data.area).push({ data, index });
        });
        const html = [...groups].sort((a, b) => (areaById(a[0])?.name || a[0]).localeCompare(areaById(b[0])?.name || b[0])).map(([area, rows]) =>
            '<details' + (words.length ? ' open' : '') + '><summary>' + esc(areaById(area)?.name || area) + ' (' + rows.length + ')</summary><div class="sk3-tree-parts">' + rows.map(({data,index}) =>
                '<button type="button" class="sk3-chip" data-model="structure" data-structure="' + index + '">' + esc(data.name) + (data.side ? ' (' + data.side + ')' : '') + '</button>').join('') + '</div></details>').join('');
        this.browser.querySelector(".sk3-structure-results").innerHTML = '<div class="sk3-anatomy-tree">' + (html || '<p>No structures match.</p>') + '</div>';
    }

    click (event) {
        const button = event.target.closest("[data-model]");
        if (!button || this.w.disabled) { return; }
        const section = button.closest(".sk3-site");
        const site = this.w.sites.find(row => this.w.keyOf(row) === (section?.dataset.key || this.w.active));
        const action = button.dataset.model;
        if (action === 'browser') {
            const open = this.browser.hidden;
            this.controls.querySelector('details').open = false; this.browser.hidden = !open;
            this.syncInspector();
            if (open) { this.browser.querySelector('[data-model-search]')?.focus({ preventScroll: true }); }
        }
        if (action === 'close-browser' || action === 'close-controls') { this.closeInspector(true); }
        if (action === "isolate" && site) { this.leaveDetail(); this.isolated = { ...site }; this.w.paint(); this.w.focusSite(site); }
        if (action === 'explore-detail') { this.exploreDetail(); }
        if (action === 'whole-organ') { this.leaveDetail(); this.w.setLayer(this.w.layer); this.w.paint(); this.w.focusSite(this.isolated); }
        if (action === 'record-detail' && this.detailView) {
            const entry = this.detailEntries(this.detailView).find(data => data.detailKey === this.inspectedPart);
            if (entry) { this.closeInspector(); this.w.addSite(this.detailTarget(entry)); }
        }
        if (action === "reveal") { this.reveal(); }
        if (action === "export") { this.exportImage(); }
        if (action === 'record-structure' && this.browserTarget) { this.w.addSite(this.browserTarget); return; }
        if (button.hasAttribute('data-structure')) {
            const data = this.structureResults[Number(button.dataset.structure)];
            if (!data) { return; }
            this.leaveDetail();
            const layer = data.layer || (data.kind === "organ" ? "ORGANS" : "SKELETON");
            this.layers[layer] = true;
            if (!this.opacity[layer]) { this.opacity[layer] = 1; }
            this.isolated = null;
            this.w.setLayer(data.kind === "organ" ? "ANATOMY" : "SKELETON");
            this.controls.querySelectorAll("[data-model-layer]").forEach(input => { input.checked = this.layers[input.dataset.modelLayer]; });
            const candidate = { area: data.area, side: data.side, part: data.part || data.base, partName: data.name };
            this.browserTarget = candidate;
            const record = this.browser.querySelector('[data-model="record-structure"]');
            if (record) { record.hidden = false; record.textContent = 'Record ' + data.name + (data.side ? ' (' + data.side + ')' : ''); }
            const selected = candidate;
            this.w.paint();
            if (selected) { this.w.focusSite(selected); }
            return;
        }
        if (!this.w.canEdit()) { return; }
        if (action === "undo" && this.undoValues.length) { this.undoing = true; this.w.setValue(this.undoValues.pop(), false); this.undoing = false; }
        if (action === "finish-area" && this.draft.length >= 3) {
            const target = this.w.sites.find(row => this.w.keyOf(row) === this.draftSite) || (this.draftTarget && this.w.addSite(this.draftTarget));
            if (target) { this.addMarker(target, this.draft.slice(), "AREA"); }
            this.draft = []; this.updateMarking(); this.w.paint();
        }
        if (action === "cancel-area") { this.draft = []; this.draftTarget = null; this.updateMarking(); this.w.paint(); }
        if (action === "clear-assessment" && site) { this.w.checkpoint(); delete site.assessment; this.w.commit(); this.w.paint(); this.w.renderPanel(); }
        if (action === "remove-marker" && site) { this.w.checkpoint(); site.markers.splice(Number(button.dataset.index), 1); this.w.commit(); this.w.paint(); this.w.renderPanel(); }
    }

    change (event) {
        const target = event.target, section = target.closest(".sk3-site"), site = this.w.sites.find(row => this.w.keyOf(row) === (section?.dataset.key || this.w.active));
        if (target.hasAttribute('data-detail-part') && this.detailView) {
            this.inspectedPart = target.value || null;
            const entry = this.detailEntries(this.detailView).find(data => data.detailKey === this.inspectedPart);
            this.inspectedTarget = entry ? this.detailTarget(entry) : null;
            this.w.paint();
            this.w.focusSite(entry ? this.detailTarget(entry) : this.detailView, true);
            return;
        }
        if (target.dataset.modelCheck) {
            if (target.dataset.modelCheck === "parts") { this.parts = target.checked; }
            if (target.dataset.modelCheck === "labels") { this.showLabels = target.checked; }
            if (target.dataset.modelCheck === "section") { this.crossSection = target.checked; if (this.w.renderer) { this.w.renderer.localClippingEnabled = target.checked; } }
            this.w.paint();
        }
        if (target.dataset.modelLayer) { this.layers[target.dataset.modelLayer] = target.checked; this.w.paint(); }
        if (target.hasAttribute("data-marker-mode")) { this.markerMode = this.w.opts.readOnly ? "OFF" : target.value; this.draft = []; this.updateMarking(); this.w.paint(); }
        if (!site || !this.w.canEdit()) { return; }
        if (target.hasAttribute("data-model-assessment")) { this.w.checkpoint(); site.assessment = target.value || null; this.w.commit(); this.w.paint(); }
        if (target.hasAttribute("data-marker-diagnosis")) { this.w.checkpoint(); site.markers[Number(target.dataset.markerDiagnosis)].diagnosis = target.value || null; this.w.commit(); }
    }

    input (event) {
        const target = event.target;
        if (target.hasAttribute("data-section-depth")) { this.section.constant = Number(target.value) / 1000; this.w.invalidate(); }
        if (target.dataset.modelOpacity) { this.opacity[target.dataset.modelOpacity] = Number(target.value) / 100; if (target.dataset.modelOpacity === "SKELETON") { this.changedSkeletonOpacity = true; } this.w.paint(); }
        if (target.hasAttribute("data-model-search")) {
            this.renderTree(target.value);
        }
        if (target.hasAttribute("data-marker-label") && this.w.canEdit()) {
            const section = target.closest(".sk3-site");
            const site = this.w.sites.find(row => this.w.keyOf(row) === (section?.dataset.key || this.w.active));
            if (site) { site.markers[Number(target.dataset.markerLabel)].label = target.value; this.w.commitLater(); this.w.modelTools.renderOverlay(); }
        }
    }
}
