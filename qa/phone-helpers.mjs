export async function openPhoneControls(page) {
 await page.waitForFunction(()=>[...document.querySelectorAll('.sk3-phone-tools')].every(node=>node.hidden===!matchMedia('(max-width:600px)').matches));
 const controls=page.locator('.sk3-phone-tools');
 if(await controls.isVisible() && !await controls.evaluate(node=>node.open))await controls.locator('summary').click();
}
