import {Color} from 'three';

// Display preferences do not enter the assessment document or its undo history.
export class AppearanceTools {
    constructor(widget) {
        this.w=widget;
        this.key='sk3-appearance-'+(window.apex?.env?.APP_ID || 'demo')+'-'+widget.id;
        let saved={};try{saved=JSON.parse(localStorage.getItem(this.key)||'{}')||{};}catch(_){}
        if(['apex','auto','light','dark'].includes(saved.theme))widget.opts.theme=saved.theme;
        if(['CLINICAL','NEON'].includes(saved.mode))widget.opts.colorMode=saved.mode;
        if(/^#[0-9a-f]{6}$/i.test(saved.color || ''))widget.opts.neonColor=saved.color;
        widget.updateTheme();
        this.mode=String(widget.opts.colorMode || 'CLINICAL').toUpperCase()==='NEON'?'NEON':'CLINICAL';
        this.color=/^#[0-9a-f]{6}$/i.test(widget.opts.neonColor || '')?widget.opts.neonColor:'#36f5ff';
        this.materials=new Map();
        this.controls=document.createElement('div');this.controls.className='sk3-appearance';
        this.controls.setAttribute('role','group');this.controls.setAttribute('aria-label','Viewer appearance');
        this.controls.innerHTML='<label>Colors<select data-appearance="mode" aria-label="Viewer color mode"><option value="CLINICAL">Clinical</option><option value="NEON">Neon</option></select></label><label data-neon-tint>Tint<input type="color" data-appearance="tint" aria-label="Neon color"></label><label>Theme<select data-appearance="theme" aria-label="Viewer theme"><option value="apex">APEX page</option><option value="auto">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>';
        widget.root.querySelector('.sk3-viewer-actions').append(this.controls);
        widget.listen(this.controls,'change',event=>{
            const key=event.target.dataset.appearance;
            if(key==='mode')this.setMode(event.target.value);
            if(key==='tint')this.setColor(event.target.value);
            if(key==='theme')this.setTheme(event.target.value);
        });
        this.sync();
    }

    sync() {
        this.w.root.dataset.colorMode=this.mode.toLowerCase();
        this.w.root.style.setProperty('--sk3-neon',this.color);
        const accent=new Color(this.color),hsl={};accent.getHSL(hsl);accent.setHSL(hsl.h,Math.max(.5,hsl.s),Math.max(.6,hsl.l));
        this.w.root.style.setProperty('--sk3-neon-accent','#'+accent.getHexString());
        this.controls.querySelector('[data-appearance="mode"]').value=this.mode;
        this.controls.querySelector('[data-appearance="tint"]').value=this.color;
        this.controls.querySelector('[data-neon-tint]').hidden=this.mode!=='NEON';
        this.controls.querySelector('[data-appearance="theme"]').value=['apex','light','dark'].includes(this.w.opts.theme)?this.w.opts.theme:'auto';
    }

    setMode(value) {
        const mode=String(value).toUpperCase();
        if(!['CLINICAL','NEON'].includes(mode))throw Error('Color mode must be CLINICAL or NEON.');
        this.disposeMaterials();this.mode=mode;this.save();this.sync();this.w.paint();return this.mode;
    }

    setColor(value) {
        if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw Error('Neon color must be a six-digit hex color.');
        this.disposeMaterials();this.color=value.toLowerCase();this.save();this.sync();this.w.paint();return this.color;
    }

    setTheme(value) {
        if(!['apex','auto','light','dark'].includes(value))throw Error('Theme must be apex, auto, light or dark.');
        this.w.opts.theme=value;this.save();this.w.updateTheme();this.sync();return value;
    }

    save(){try{localStorage.setItem(this.key,JSON.stringify({theme:this.w.opts.theme,mode:this.mode,color:this.color}));}catch(_){}}

    startPaint() {
        const tools=this.w.modelTools;
        const signature=JSON.stringify(tools?.opacity)+tools?.crossSection+tools?.changedSkeletonOpacity;
        if(signature!==this.materialSignature){this.disposeMaterials();this.materialSignature=signature;}
    }

    material(mesh,original,highlighted) {
        if(this.mode!=='NEON'||mesh.userData.kind==='dark')return original;
        const layer=mesh.userData.layer || (mesh.userData.kind==='organ'?'ORGANS':'SKELETON');
        const offset={SKELETON:0,ORGANS:.18,STRUCTURES:.38,MUSCLES:.62,NERVES:.82,VESSELS:.5}[layer] || 0;
        const key=original.uuid+'|'+offset+'|'+highlighted;
        if(!this.materials.has(key)) {
            const material=original.clone();
            if(!highlighted){material.color.set(this.color).offsetHSL(offset,0,0);}
            material.emissive.copy(material.color);material.emissiveIntensity=highlighted ? .22 : .35;
            material.roughness=.42;material.metalness=.05;
            this.materials.set(key,material);
        }
        return this.materials.get(key);
    }

    disposeMaterials(){for(const material of this.materials.values())material.dispose();this.materials.clear();}
}
