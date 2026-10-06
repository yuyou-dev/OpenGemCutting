import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Chrome's CLI can finish printing but never exit on macOS. Its debugging pipe
// gives an explicit print result, waits for fonts/images and needs no browser package.
export async function printManualPdf(browserPath, htmlPath, outputPath) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'facet96-manual-print-'));
  const browser = spawn(browserPath, ['--headless=new', '--remote-debugging-pipe',
    `--user-data-dir=${profile}`, '--allow-file-access-from-files', '--no-first-run', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => browser.once('close', resolve));
  let sequence = 0, buffer = '', loaded;
  const pending = new Map();
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  browser.stdio[4].on('data', chunk => {
    buffer += chunk.toString();
    for (let end; (end = buffer.indexOf('\0')) >= 0;) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (message.method === 'Page.loadEventFired') loaded?.();
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  let timer;
  const failed = new Promise((_, reject) => {
    browser.once('error', reject);
    browser.once('exit', code => reject(new Error(`Chrome exited before PDF completion (${code}).`)));
    timer = setTimeout(() => reject(new Error('Chrome PDF generation timed out.')), 60000);
  });
  try {
    await Promise.race([failed, (async () => {
      const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
      await call('Page.enable', {}, sessionId);
      const ready = new Promise(resolve => { loaded = resolve; });
      await call('Page.navigate', { url: pathToFileURL(htmlPath).href }, sessionId);
      await ready;
      await call('Emulation.setEmulatedMedia', { media: 'print' }, sessionId);
      const layout = await call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(image => image.decode()));
        return [...document.querySelectorAll('.page')].flatMap((page, index) => {
          const body = page.querySelector('.body').getBoundingClientRect();
          const footer = page.querySelector('.foot').getBoundingClientRect();
          return body.bottom > footer.top - 4 ? [{ page: index + 1, overlap: body.bottom - footer.top }] : [];
        });
      })()` }, sessionId);
      if (layout.exceptionDetails) throw new Error(layout.exceptionDetails.text);
      if (layout.result.value.length) throw new Error(`Manual content reaches the footer: ${JSON.stringify(layout.result.value)}`);
      const pdf = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false }, sessionId);
      await writeFile(outputPath, Buffer.from(pdf.data, 'base64'));
    })()]);
  } finally {
    clearTimeout(timer);
    if (browser.exitCode === null) browser.kill();
    await exited;
    await rm(profile, { recursive: true, force: true });
  }
}
