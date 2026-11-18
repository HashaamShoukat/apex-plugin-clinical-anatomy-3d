import links from './anatomy-links.json' with { type: 'json' };

const knownLinks = new Set(links);

export function normalizeSex(value) {
    const sex = String(value ?? '').trim().toUpperCase();
    return ['M','MALE'].includes(sex) ? 'M' : ['F','FEMALE'].includes(sex) ? 'F' : 'U';
}

export function validateSiteAnatomy(site) {
    for (const key of ['bone','part']) {
        if (site[key] && !knownLinks.has(site[key]+'|'+site.area+'|'+(site.side || '-'))) {
            return 'The '+key+' does not belong to this anatomical area and side.';
        }
    }
    if (site.bone && site.part && site.bone !== site.part) { return 'A site cannot identify different bones and parts.'; }
    return '';
}
