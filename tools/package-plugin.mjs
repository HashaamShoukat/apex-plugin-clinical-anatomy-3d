import { readFileSync, writeFileSync } from 'node:fs';

const read = file => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const quote = text => "'" + String(text).replaceAll("'", "''") + "'";
const id = value => {
    if (!/^\d+$/.test(String(value))) { throw Error('Missing stable component ID'); }
    return 'wwv_flow_imp.id(' + value + ')';
};
const property = (source, name, indent = 4) => source.match(new RegExp('^ {' + indent + '}' + name + ': (.+)$', 'm'))?.[1];
const section = (source, name) => source.match(new RegExp('^    ' + name + ' \\{\\n([\\s\\S]*?)^    \\}', 'm'))?.[1] || '';
const help = source => {
    const body = section(source, 'help') || section(source, 'information');
    const fenced = body.match(/helpText:\s*```(?:html)?\n([\s\S]*?)\n\s*```/);
    return fenced ? fenced[1].replace(/^ {12}/gm, '') : property(body, 'helpText', 8) || '';
};
const textValue = value => /^".*"$/.test(value) ? JSON.parse(value) : value;
const sqlText = text => 'wwv_flow_string.join(wwv_flow_t_varchar2(' + (text.match(/[\s\S]{1,1200}/g) || ['']).map(quote).join(',\n') + '),null)';
const call = (name, parameters) => 'wwv_flow_imp_shared.' + name + '(\n ' + parameters.map(([key, value]) => 'p_' + key + '=>' + value).join('\n,') + '\n);\n';

// Generate every component from the APEXlang definitions. Stable component IDs
// preserve existing item references without retaining an application export.
export function packagePlugin(version) {
    const ids = JSON.parse(read('plugin/component-ids.json'));
    const plugin = read('dist/plugin.apx');
    const pluginId = id(ids.plugin);
    const versionTag = plugin.match(/\?v=([^\s]+)/)[1];
    let sql = `-- Clinical Anatomy 3D ${version}. Import into the application selected in APEX Builder.
set define off verify off feedback off
whenever sqlerror exit sql.sqlcode rollback
begin
wwv_flow_imp.import_begin(
 p_version_yyyy_mm_dd=>'2026.03.30'
,p_release=>'26.1.0'
,p_default_workspace_id=>null
,p_default_application_id=>null
,p_default_id_offset=>0
,p_default_owner=>null
);
wwv_flow_imp.g_mode := 'REPLACE';
`;
    sql += call('create_plugin', [
        ['id', pluginId], ['plugin_type', quote('ITEM TYPE')], ['name', quote(property(plugin, 'staticId'))],
        ['display_name', quote(property(plugin, 'name'))], ['apexlang_name', quote('skeleton3d')],
        ['supported_component_types', quote('APEX_APPLICATION_PAGE_ITEMS')],
        ['image_prefix', "nvl(wwv_flow_application_install.get_static_plugin_file_prefix('ITEM TYPE','COM.HASHAAM.SKELETON_3D'),'')"],
        ['javascript_file_urls', quote('#PLUGIN_FILES#js/skeleton3d.min.js?v=' + versionTag)],
        ['css_file_urls', quote('#PLUGIN_FILES#css/skeleton3d.min.css?v=' + versionTag)],
        ['api_version', '3'], ['render_function', quote('skeleton3d_pkg.render')], ['ajax_function', quote('skeleton3d_pkg.ajax')],
        ['validation_function', quote('skeleton3d_pkg.validation')], ['item_session_state_data_type', quote('VARCHAR2:CLOB')],
        ['standard_attributes', quote('VISIBLE:FORM_ELEMENT:SESSION_STATE:READONLY:SOURCE:INIT_JAVASCRIPT_CODE')],
        ['help_text', sqlText(help(plugin))], ['version_identifier', quote(version)],
        ['files_version', String(parseInt(versionTag.split('-').at(-1), 16))]
    ]);
    for (const block of read('plugin/attribute-groups.apx').split(/(?=^attributeGroup )/m).filter(block => block.trim())) {
        const name = block.match(/^attributeGroup (\w+)/)[1];
        sql += call('create_plugin_attr_group', [
            ['id', id(ids.groups[name])], ['plugin_id', pluginId], ['title', quote(property(block, 'name'))],
            ['apexlang_name', quote(name)], ['static_id', quote(name)], ['display_sequence', property(block, 'sequence')]
        ]);
    }
    const types = { selectList: 'SELECT LIST', pageItem: 'PAGE ITEM', pageItems: 'PAGE ITEMS', checkboxes: 'CHECKBOXES', integer: 'INTEGER',
        sqlQuery: 'SQL', text: 'TEXT', textarea: 'TEXTAREA', plsqlFunctionBodyReturningBoolean: 'PLSQL FUNCTION BODY BOOLEAN',
        plsqlFunctionBodyReturningVarchar2: 'PLSQL FUNCTION BODY' };
    const attributes = read('plugin/custom-attributes.apx').split(/(?=^customAttribute )/m).filter(block => block.trim());
    const emitted = new Set();
    function emitAttribute(block) {
        const number = property(block, 'attribute');
        if (emitted.has(number)) { return; }
        const dependency = section(block, 'dependingOn');
        const parent = property(dependency, 'attribute', 8)?.match(/attribute_0*(\d+)/)?.[1];
        if (parent) {
            const source = attributes.find(source => property(source, 'attribute') === parent);
            if (!source) { throw Error('Missing attribute dependency ' + parent); }
            emitAttribute(source);
        }
        emitted.add(number);
        const type = types[property(block, 'type')];
        if (!type) { throw Error('Unsupported attribute type ' + property(block, 'type')); }
        const appearance = section(block, 'appearance'), validation = section(block, 'validation');
        const group = property(appearance, 'attributeGroup', 8)?.replace('@', '');
        const entries = [...block.matchAll(/^    entry (\w+) \(\n([\s\S]*?)^    \)/gm)];
        const parameters = [
            ['id', id(ids.attributes[number])], ['plugin_id', pluginId], ['attribute_scope', quote('COMPONENT')],
            ['attribute_sequence', number], ['display_sequence', property(appearance, 'sequence', 8)],
            ['static_id', quote('attribute_' + number.padStart(2, '0'))], ['prompt', quote(property(block, 'name'))],
            ['apexlang_name', quote(property(block, 'apexlangName'))], ['attribute_type', quote(type)],
            ['is_required', property(validation, 'required', 8) || 'false'], ['is_translatable', 'false'],
            ['attribute_group_id', id(ids.groups[group])], ['help_text', sqlText(help(block))]
        ];
        const defaultValue = property(section(block, 'default'), 'value', 8);
        if (defaultValue != null) { parameters.push(['default_value', quote(textValue(defaultValue))]); }
        if (entries.length) { parameters.push(['lov_type', quote('STATIC')]); }
        for (const [name, key] of [['minColumns', 'sql_min_column_count'], ['maxColumns', 'sql_max_column_count']]) {
            const value = property(validation, name, 8);
            if (value) { parameters.push([key, value]); }
        }
        if (parent) {
            const condition = property(dependency, 'conditionType', 8);
            if (condition !== '=') { throw Error('Unsupported dependency ' + condition); }
            parameters.push(['depending_on_attribute_id', id(ids.attributes[parent])], ['depending_on_has_to_exist', 'true'],
                ['depending_on_condition_type', quote('EQUALS')], ['depending_on_expression', quote(property(dependency, 'value', 8))]);
        }
        sql += call('create_plugin_attribute', parameters);
        for (const [, name, entry] of entries) {
            const value = property(entry, 'return', 8);
            const stableId = ids.values[ids.attributes[number] + '|' + value];
            sql += call('create_plugin_attr_value', [
                ['id', stableId ? id(stableId) : 'wwv_flow_id.next_val'], ['plugin_attribute_id', id(ids.attributes[number])],
                ['display_sequence', property(entry, 'sequence', 8)], ['display_value', quote(property(entry, 'display', 8))],
                ['return_value', quote(value)], ['apexlang_name', quote(name)]
            ]);
        }
    }
    attributes.forEach(emitAttribute);
    for (const block of read('plugin/events.apx').split(/(?=^event )/m).filter(block => block.trim())) {
        const name = block.match(/^event (\w+)/)[1];
        sql += call('create_plugin_event', [['id', id(ids.events[name])], ['plugin_id', pluginId],
            ['name', quote(name)], ['display_name', quote(property(block, 'name'))]]);
    }
    sql += 'end;\n/\n';
    for (const [file, fileId] of Object.entries(ids.files).filter(([file])=>file.includes('.min.'))) {
        const hex = readFileSync('dist/' + file.split('/').at(-1)).toString('hex');
        sql += 'begin\nwwv_flow_imp.g_varchar2_table := wwv_flow_imp.empty_varchar2_table;\n';
        for (let offset = 0; offset < hex.length; offset += 4000) {
            sql += 'wwv_flow_imp.g_varchar2_table(' + (offset / 4000 + 1) + ') := ' + quote(hex.slice(offset, offset + 4000)) + ';\n';
        }
        sql += call('create_plugin_file', [['id', id(fileId)], ['plugin_id', pluginId], ['file_name', quote(file)],
            ['mime_type', quote(file.endsWith('.js') ? 'application/javascript' : 'text/css')], ['file_charset', quote('utf-8')],
            ['file_content', 'wwv_flow_imp.varchar2_to_blob(wwv_flow_imp.g_varchar2_table)']]);
        sql += 'end;\n/\n';
    }
    sql += 'begin\nwwv_flow_imp.import_end;\ncommit;\nend;\n/\nset verify on feedback on define on\n';
    writeFileSync('dist/plugin-installer.sql', sql);
    console.log('plugin-installer.sql     Generated from APEXlang definitions');
}
