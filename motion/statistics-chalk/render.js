// Renders index.html frame-by-frame in headless Chromium and pipes PNGs to ffmpeg.
//   node render.js                       → statistics-major.mp4 (silent)
//   node render.js --stills 0.3,2.9 dir  → PNG stills at the given seconds
//   node render.js --events out.json     → timing data used by audio.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf' };

async function main() {
  const args = process.argv.slice(2);
  const stillsIdx = args.indexOf('--stills');

  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(0);
  const port = server.address().port;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.error('[page error]', e));
  await page.goto(`http://127.0.0.1:${port}/index.html?render`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });

  if (args[0] === '--events') {
    const ev = await page.evaluate(() => window.EVENTS);
    fs.writeFileSync(args[1] || path.join(ROOT, 'events.json'), JSON.stringify(ev));
  } else if (stillsIdx >= 0) {
    const times = args[stillsIdx + 1].split(',').map(Number);
    const dir = args[stillsIdx + 2] || 'stills';
    fs.mkdirSync(dir, { recursive: true });
    for (const t of times) {
      const b64 = await page.evaluate((f) => window.renderFrame(f), Math.round(t * 60));
      fs.writeFileSync(path.join(dir, `t${t.toFixed(2)}.png`), Buffer.from(b64, 'base64'));
    }
  } else {
    const outFile = args[0] || path.join(ROOT, 'statistics-chalk-silent.mp4');
    const frames = await page.evaluate(() => window.FRAMES);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', outFile],
      { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    for (let f = 0; f < frames; f++) {
      const b64 = await page.evaluate((i) => window.renderFrame(i), f);
      if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 60 === 0) console.log(`frame ${f}/${frames}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log('wrote', outFile);
  }
  await browser.close();
  server.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
