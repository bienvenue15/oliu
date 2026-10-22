/**
 * Turns every slice note docs/slices/*.md into a PDF next to it, using the Edge/Chrome on this machine.
 * Markdown is the source (readable on GitHub), the PDF is the copy to open offline. No HTML is kept.
 *   node docs/build-pdf.mjs            all notes
 *   node docs/build-pdf.mjs 01         one note by its number prefix
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, basename, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { marked } from 'marked';

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const slicesDir = resolve(here, 'slices');
const outDir = slicesDir;
const browser = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!browser) throw new Error('No Edge or Chrome found to print the PDF');
if (!existsSync(outDir)) mkdirSync(outDir);

const css = `
@page { size: A4; margin: 16mm 14mm; }
body { font: 11.5pt/1.5 "Segoe UI", Arial, sans-serif; color: #1c2733; max-width: 100%; }
h1 { font-size: 22pt; color: #16283c; margin: 0 0 4px; }
h2 { font-size: 15pt; color: #16283c; margin: 22px 0 6px; border-bottom: 1px solid #dfe5eb; padding-bottom: 3px; page-break-after: avoid; }
h3 { font-size: 12pt; color: #b4682a; margin: 14px 0 4px; }
p, li { margin: 4px 0; }
code { font-family: Consolas, Menlo, monospace; font-size: 10pt; background: #f4f6f8; padding: 1px 4px; border-radius: 3px; }
pre { background: #f4f6f8; border: 1px solid #dfe5eb; border-radius: 6px; padding: 8px 10px; font-size: 9.5pt; white-space: pre-wrap; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; font-size: 10pt; margin: 6px 0; page-break-inside: avoid; }
th { background: #f6f8fa; text-align: left; padding: 5px 7px; border-bottom: 1px solid #dfe5eb; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; color: #7a8794; }
td { padding: 5px 7px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
img { max-width: 100%; border: 1px solid #dfe5eb; border-radius: 6px; }
table img { max-width: 100%; }
hr { border: none; border-top: 1px solid #dfe5eb; margin: 14px 0; }
blockquote { border-left: 3px solid #b4682a; margin: 8px 0; padding: 2px 10px; color: #45525f; }
`;

const only = process.argv[2];
const notes = readdirSync(slicesDir).filter((f) => f.endsWith('.md') && (!only || f.startsWith(only)));
for (const f of notes) {
  const md = readFileSync(resolve(slicesDir, f), 'utf8');
  const imgBase = `file:///${slicesDir.split('\\').join('/')}/`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${basename(f, '.md')}</title><base href="${imgBase}"><style>${css}</style></head><body>${marked.parse(md)}</body></html>`;
  const tmp = resolve(tmpdir(), `oliu-${basename(f, '.md')}.html`);
  writeFileSync(tmp, html);
  const pdf = resolve(outDir, `${basename(f, '.md')}.pdf`);
  const r = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, `file:///${tmp.replace(/\\/g, '/')}`], { stdio: 'ignore' });
  rmSync(tmp, { force: true });
  if (r.status !== 0) throw new Error(`printing ${f} failed`);
  console.log(`${f} → slices/${basename(pdf)}`);
}
