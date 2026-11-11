import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test('a pin added to the drawing appears in the exported working copy', async ({ page }) => {
  const description = 'E2E inspection: repair the door hinge';
  await page.goto('/');
  await page.locator('header input[type=file]').setInputFiles('public/sample-drawing-set.pdf');
  await page.getByRole('radio', { name: 'Pin', exact: true }).click();
  await page.locator('.sheet-frame svg[viewBox]').first().click({ position: { x: 100, y: 100 } });
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByRole('button', { name: 'Add pin', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add pin', exact: true })).toBeHidden();

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Working copy' }).click();
  const file = await downloaded;
  const pdf = await PDFDocument.load(await readFile(await file.path()));
  const annotations = pdf.getPages()[0].node.Annots()?.asArray() ?? [];
  const pins = annotations.map(ref => pdf.context.lookup(ref)).filter(annotation =>
    annotation.get(PDFName.of('Subtype'))?.toString() === '/Stamp'
    && annotation.lookup(PDFName.of('Contents'))?.decodeText().includes(description)
  );
  expect(pins).toHaveLength(1);
});
