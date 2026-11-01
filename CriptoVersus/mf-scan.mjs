import { chromium } from 'playwright';
import { readdirSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

const files = readdirSync('.').filter(f => /^bag-.*\.png$/.test(f) || /^goldbag-.*\.png$/.test(f) || /^mf-arena-.*\.png$/.test(f));
console.log('Scanning', files.length, 'screenshots');

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();

for (const f of files) {
  const url = pathToFileURL(resolve(f)).href;
  const r = await page.evaluate(async (u) => {
    const img = new Image();
    img.src = u;
    await img.decode();
    const off = document.createElement('canvas');
    off.width = img.width; off.height = img.height;
    const g = off.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, off.width, off.height).data;
    let gold = 0, green = 0, red = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i+1], b = d[i+2];
      if (r > 150 && gg > 110 && gg < 215 && b < 130 && r > b + 45 && gg > b + 25) gold++;
      if (r > 230 && gg > 205 && b > 135 && b < 215) gold++;
      if (gg > 195 && r > 125 && r < 215 && b < 145) green++;
      if (r > 215 && gg < 155 && b < 155 && gg > 55) red++;
    }
    return { w: off.width, h: off.height, gold, green, red };
  }, url);
  console.log(f, JSON.stringify(r));
}
await browser.close();
