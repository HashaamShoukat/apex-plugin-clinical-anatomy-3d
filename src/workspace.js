// View preferences and layout never change the patient's JSON value.
export class WorkspaceTools {
    constructor (widget) {
        this.w = widget;
        const root = widget.root;
        this.editHint = widget.stage.querySelector('.sk3-hint').textContent;
        root.style.setProperty("--sk3-stage-height", (Number(widget.opts.height) || 560) + "px");
        this.key = "sk3-layout-" + (window.apex?.env?.APP_ID || "demo") + "-" + widget.id;
        let fraction = 56;
        try { fraction = Number(localStorage.getItem(this.key)) || fraction; } catch (_) { /* private browsing */ }
        this.setSplit(fraction);
        const divider = root.querySelector(".sk3-divider");
        widget.listen(divider, "pointerdown", event => {
            if (event.button !== 0) { return; }
            event.preventDefault(); divider.setPointerCapture(event.pointerId); this.dragging = true; root.classList.add("is-resizing");
        });
        widget.listen(divider, "pointermove", event => {
            if (!this.dragging) { return; }
            const box = root.getBoundingClientRect();
            this.setSplit((event.clientX - box.left) / box.width * 100);
        });
        const stop = () => { this.dragging = false; root.classList.remove("is-resizing"); this.saveSplit(); };
        widget.listen(divider, "pointerup", stop); widget.listen(divider, "pointercancel", stop);
        widget.listen(divider, "dblclick", () => { this.setSplit(56); this.saveSplit(); });
        widget.listen(divider, "keydown", event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { return; }
            event.preventDefault();
            this.setSplit(event.key === "Home" ? 25 : event.key === "End" ? 75 : this.fraction + (event.key === "ArrowLeft" ? -3 : 3)); this.saveSplit();
        });
        const details = widget.modelTools?.controls?.querySelector("details");
        const toggle = root.querySelector('[data-act="controls"]');
        toggle.hidden = !details;
        if (details) {
            details.id = widget.id + "_controls";
            toggle.setAttribute("aria-controls", details.id);
            widget.listen(toggle, "click", () => { details.open = !details.open; });
            const sync = () => { toggle.setAttribute("aria-expanded", String(details.open)); toggle.textContent = details.open ? "Hide controls" : "Show controls"; };
            widget.listen(details, "toggle", sync); sync();
        }
        // Reuse the same controls in a native disclosure on phones. Keeping one
        // set preserves events, labels, item IDs and the clinical value.
        this.phoneMedia = window.matchMedia('(max-width:600px)');
        this.phoneTools = document.createElement('details');
        this.phoneTools.className = 'sk3-phone-tools';
        this.phoneTools.hidden = true;
        const summary = document.createElement('summary');
        summary.textContent = 'Anatomy controls';
        this.phoneTools.append(summary);
        this.phoneContent = document.createElement('div');
        this.phoneContent.className = 'sk3-phone-tools-content';
        this.phoneTools.append(this.phoneContent);
        this.toolbar = root.querySelector('.sk3-topbar');
        this.search = root.querySelector('.sk3-search');
        this.viewerHeader = root.querySelector('.sk3-viewer-header');
        root.insertBefore(this.phoneTools, this.toolbar);
        this.arrangeControls = () => {
            const phone = this.phoneMedia.matches;
            if (phone === this.phone) { return; }
            this.phone = phone;
            const focus = document.activeElement;
            if (phone) {
                for (const control of [this.toolbar,this.search,this.viewerHeader]) { if (control) { this.phoneContent.append(control); } }
            } else {
                root.insertBefore(this.toolbar,widget.stage);
                if (this.search) { root.insertBefore(this.search,widget.stage); }
                widget.stage.insertBefore(this.viewerHeader,widget.viewport);
                this.phoneTools.open = false;
            }
            this.phoneTools.hidden = !phone;
            if (focus && this.phoneContent.contains(focus)) { summary.focus(); }
            else if (focus && root.contains(focus)) { focus.focus({preventScroll:true}); }
            this.queueFit?.(); widget.resize?.();
        };
        widget.listen(this.phoneMedia,'change',this.arrangeControls);
        widget.listen(this.phoneTools,'toggle',() => { this.queueFit(); widget.resize?.(); });
        // Escape returns to the model without trapping keyboard focus in controls.
        widget.listen(this.phoneTools,'keydown',event => {
            if (event.key==='Escape' && this.phoneTools.open) { event.preventDefault(); this.phoneTools.open=false; summary.focus(); }
        });
        this.arrangeControls();
        this.fitViewport = () => {
            if (widget.destroyed) { return; }
            // Honor the configured height independently of page position and scrolling.
            const height = Math.max(320, Math.round(Number(widget.opts.height) || 560));
            if (height !== this.height) { this.height = height; root.style.setProperty('--sk3-workspace-height', height + 'px'); }
            if (this.phone) {
                // Document position stays stable on scroll. Reserve room for
                // phone navigation; a below-fold item still gets a usable model.
                const top = widget.stage.getBoundingClientRect().top + window.scrollY;
                const available = window.innerHeight - top - 88;
                const phoneHeight = Math.round(Math.max(240,Math.min(height,window.innerHeight*.6,available>=240?available:window.innerHeight*.52)));
                if (phoneHeight !== this.phoneHeight) { this.phoneHeight=phoneHeight; root.style.setProperty('--sk3-phone-height',phoneHeight+'px'); }
            }
        };
        this.queueFit = () => {
            if (this.fitFrame != null) { return; }
            this.fitFrame = requestAnimationFrame(() => { this.fitFrame = null; this.fitViewport(); });
        };
        widget.listen(window, 'resize', this.queueFit);
        this.observer = new ResizeObserver(this.queueFit); this.observer.observe(root);
        this.fitViewport();
        this.specialtyInput = widget.opts.specialtyItem ? document.getElementById(widget.opts.specialtyItem) : null;
        if (this.specialtyInput) {
            this.updateSpecialty = () => { const value = window.apex?.item ? window.apex.item(widget.opts.specialtyItem).getValue() : this.specialtyInput.value; widget.setSpecialty(value); };
            if (window.apex?.jQuery) {
                this.specialtyEvent = 'change.sk3Specialty' + widget.id;
                window.apex.jQuery(this.specialtyInput).on(this.specialtyEvent, this.updateSpecialty);
            } else { widget.listen(this.specialtyInput, 'change', this.updateSpecialty); }
            this.updateSpecialty();
        }
        this.updateReadOnly();
    }

    destroy () {
        this.observer.disconnect();
        cancelAnimationFrame(this.fitFrame);
        if (this.specialtyEvent) { window.apex?.jQuery?.(this.specialtyInput).off(this.specialtyEvent, this.updateSpecialty); }
    }

    setSplit (fraction) {
        this.fraction = Math.max(25, Math.min(75, Number(fraction) || 56));
        this.w.root.style.setProperty("--sk3-left", this.fraction + "fr");
        this.w.root.style.setProperty("--sk3-right", (100 - this.fraction) + "fr");
        const divider = this.w.root.querySelector(".sk3-divider");
        divider.setAttribute("aria-valuenow", String(Math.round(this.fraction)));
        divider.setAttribute("aria-valuetext", "Model " + Math.round(this.fraction) + " percent, findings " + Math.round(100 - this.fraction) + " percent");
        this.w.resize?.();
    }
    saveSplit () { try { localStorage.setItem(this.key, String(this.fraction)); } catch (_) { /* optional preference */ } }

    updateReadOnly () {
        const w = this.w, ro = w.opts.readOnly;
        w.root.classList.toggle("sk3--ro", ro);
        w.root.querySelector(".sk3-readonly-badge").hidden = !ro;
        w.input.readOnly = ro;
        if (ro) { w.input.removeAttribute('name'); }
        else { w.input.setAttribute('name',w.id); }
        if (!w.stage.classList.contains('sk3-stage--off')) {
            w.stage.querySelector('.sk3-hint').textContent = ro ? 'Drag to turn, scroll or pinch to zoom. Select a recorded finding to review.' : this.editHint;
        }
        for (const control of w.root.querySelectorAll('[data-seg="sex"] button,[data-seg="mode"] button')) { control.disabled = ro; }
        if (w.searchIn) { w.searchIn.closest('.sk3-search').hidden = ro; }
        if (ro) { w.closeResults(); }
        w.root.querySelectorAll('[data-marker-mode],[data-model="finish-area"],[data-model="cancel-area"],[data-model="undo"]').forEach(control => { control.hidden = ro; });
        if (ro && w.modelTools) { w.modelTools.markerMode = "OFF"; w.modelTools.draft = []; }
        w.modelTools?.updateMarking();
        w.clinic.renderMaintenance(); w.clinic.renderExam(); w.renderPanel(); w.paint();
    }
}
