import { test, expect } from '@playwright/test';

// SCRUM-84: Backspace or Delete pressed in a drop-down — the sheet picker, the
// selected item's status — must not delete the markup selected on the sheet.
test('Backspace and Delete in a drop-down leave the selected markup alone', async ({ page }) => {
  const description = 'E2E: still here after keys in a drop-down';
  await page.goto('/');
  await page.locator('header input[type=file]').setInputFiles('public/sample-drawing-set.pdf');
  await page.getByRole('radio', { name: 'Pin', exact: true }).click();
  await page.locator('.sheet-frame svg[viewBox]').first().click({ position: { x: 100, y: 100 } });
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByRole('button', { name: 'Add pin', exact: true }).click();

  // The new pin is selected, with its details open in the side panel.
  const details = page.getByRole('complementary').getByRole('textbox', { name: 'Description', exact: true });
  await expect(details).toHaveValue(description);

  for (const dropDown of [page.getByRole('combobox', { name: 'Sheet', exact: true }), page.getByRole('combobox', { name: 'Status', exact: true })]) {
    await dropDown.focus();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await expect(details).toHaveValue(description);
  }

  // Off the drop-downs, Delete still removes the selected markup.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Delete');
  await expect(page.getByRole('button', { name: 'Undo: Delete pin' })).toBeVisible();
});
