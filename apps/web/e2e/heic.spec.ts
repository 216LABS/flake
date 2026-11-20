import { expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { login, startStorm, sql } from './helpers';

/** A HEIC file's header: the server sniffs ftyp + brand, and can't decode the rest (sharp has no HEVC). */
const heic = () => {
  const buffer = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), randomBytes(4000)]);
  return { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer };
};

test('an iPhone HEIC visit photo keeps its original bytes and the office sees a JPEG copy', async ({ page }) => {
  // Every iPhone browser decodes HEIC. Chromium here doesn't, so stand in for that: decode "HEIC" to a small picture.
  await page.addInitScript(() => {
    const real = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((src: ImageBitmapSource, ...rest: never[]) => {
      if (src instanceof Blob && /heic/i.test(src.type)) {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 240;
        const g = c.getContext('2d')!;
        g.fillStyle = '#88aacc';
        g.fillRect(0, 0, 320, 240);
        return real(c);
      }
      return real(src, ...rest);
    }) as typeof window.createImageBitmap;
  });
  await login(page);
  const { id: stormId, runs } = await startStorm(page.request, `HEIC ${Date.now()}`, ['Rocky River']);
  await page.goto(runs[0]!.link);
  await page.getByTestId('arrive').click();
  await expect(page.getByTestId('onsite')).toBeVisible();
  const file = heic();
  const views: number[] = [];
  page.on('response', (r) => { if (new URL(r.url()).pathname.endsWith('/photos/view')) views.push(r.status()); });
  await page.getByTestId('before-photo').setInputFiles(file);
  await expect(page.getByText('✓ Before photo')).toBeVisible();

  // The original is stored untouched: same hash as the phone's file.
  const want = createHash('sha256').update(file.buffer).digest('hex');
  await expect.poll(async () => (await sql`select p.sha256 from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${stormId}`)[0]?.sha256, { timeout: 30000 }).toBe(want);
  await expect.poll(() => views, { timeout: 30000 }).toContain(200);

  // The office's photo links, thumbnail and full size, both open the JPEG copy rather than the HEIC.
  const [p] = await sql`select p.id from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${stormId}`;
  for (const q of ['?thumb', '']) {
    const res = await page.request.get(`/api/photos/${p!.id}${q}`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toContain('.thumb.jpg');
    const img = await page.request.get(res.headers().location!);
    expect(img.ok()).toBe(true);
    expect([...(await img.body()).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  }
});

test('a HEIC photo the phone could not convert shows "no preview" in the office, not a broken image', async ({ page }) => {
  await login(page);
  const { id: stormId, runs } = await startStorm(page.request, `HEIC raw ${Date.now()}`, ['Rocky River']);
  await page.goto(runs[0]!.link);
  const label = (await page.getByTestId('stop-label').textContent())!.trim();
  await page.getByTestId('arrive').click();
  await page.getByTestId('before-photo').setInputFiles(heic());
  await expect.poll(async () => (await sql`select count(*)::int as n from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${stormId}`)[0]?.n, { timeout: 30000 }).toBe(1);
  // Pin photos go through the server, which says what to change on the phone.
  const [pin] = await sql`select sp.id from site_pin sp join site s on s.id = sp.site_id join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' limit 1`;
  if (pin) {
    const res = await page.request.post(`/api/pins/${pin.id}/photo`, { multipart: { file: heic() } });
    expect(res.status()).toBe(422);
    expect(((await res.json()) as { error: string }).error).toContain('High efficiency');
  }
  await page.goto(`/storms/${stormId}`);
  await page.getByTestId('stop-open').filter({ hasText: label }).first().click();
  await expect(page.getByTestId('photo-no-preview').first()).toBeVisible();
});
