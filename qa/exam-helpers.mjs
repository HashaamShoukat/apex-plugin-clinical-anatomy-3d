export async function openExam(page) {
    if (!await page.locator('.sk3-exam-dialog').isVisible()) { await page.locator('.sk3-topbar [data-clinic="show-exam"]').click(); }
}
export async function fillRequiredExam(page, itemId = 'P1_BODY') {
    await openExam(page);
    const fields = await page.evaluate(id => skeleton3d.get(id).widget.clinic.definition.fields.filter(f => f.required), itemId);
    for (const field of fields) {
        const value = field.type === 'assessment' ? 'NORMAL' : field.type === 'select' ? field.options[0].value : 'Recorded';
        const control = page.locator('[data-exam-value="' + field.id + '"]');
        if (await control.first().getAttribute('type') === 'radio') { await page.locator('[data-exam-value="' + field.id + '"][value="' + value + '"]').check(); }
        else if (field.type === 'select') { await control.selectOption(value); }
        else { await control.fill(value); }
        if (field.noteRequiredFor?.includes(value)) { await page.locator('[data-exam-note="' + field.id + '"]').fill('Finding and action documented'); }
    }
}
