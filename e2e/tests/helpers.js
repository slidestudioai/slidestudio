// Umumiy yordamchilar. E2E_LIBS=<papka> berilsa CDN kutubxonalari shu papkadan olinadi (internetsiz muhit uchun).
const path = require('path');
const LIBS = process.env.E2E_LIBS;
const MAP = {
  'fabric.min.js': 'fabric/dist/fabric.min.js',
  'sweetalert2@11': 'sweetalert2/dist/sweetalert2.all.min.js',
  'jszip.min.js': 'jszip/dist/jszip.min.js',
};

async function openEditor(page, url = '/') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (LIBS) {
    await page.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|telegram\.org|fonts\.)/, (r) => {
      const u = r.request().url();
      for (const k of Object.keys(MAP)) if (u.includes(k)) return r.fulfill({ path: path.join(LIBS, MAP[k]) });
      return r.fulfill({ status: 200, body: '', contentType: u.includes('css') ? 'text/css' : 'application/javascript' });
    });
  }
  await page.goto(url);
  await page.waitForFunction(() => typeof canvas !== 'undefined' && canvas && Array.isArray(slides) && slides.length > 0, null, { timeout: 30_000 });
  // ilova to'liq ishga tushishini kutamiz (thumbnail, sidebar, shriftlar)
  await page.waitForFunction(() => document.querySelector('#sidebar .slide-thumb, #sidebar img, #sidebar canvas'), null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return errors;
}

// Ekrandagi (asosiy) kanvasning (x, y) nuqtasidagi rang, "r,g,b"
function pixel(page, x = 20, y = 20) {
  return page.evaluate(([x, y]) => {
    const d = canvas.lowerCanvasEl.getContext('2d').getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]].join(',');
  }, [x, y]);
}

module.exports = { openEditor, pixel };
