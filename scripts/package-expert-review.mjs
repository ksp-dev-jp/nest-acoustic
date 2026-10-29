// One self-contained HTML file for reviewers. No server or installation required.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
const out = path.resolve(process.argv[2] ?? 'outputs/experiments-20261029');
if (!out.startsWith(path.join(process.cwd(), 'outputs') + path.sep)) throw new Error('Use outputs/');
const kit = path.join(out, '専門家確認キット');
fs.mkdirSync(kit, { recursive: true });
const result = await build({ configFile: false, root: path.resolve('pages'), base: './', publicDir: false, plugins: [react()],
  build: { write: false, rollupOptions: { input: path.resolve('pages/audit.html'), output: { inlineDynamicImports: true } } } });
const output = result.output;
const js = output.filter(item => item.type === 'chunk').map(item => item.code).join('\n').replace(/<\/script/gi, '<\\/script');
const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n');
const initial = JSON.stringify(JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'))).replaceAll('<', '\\u003c');
fs.writeFileSync(path.join(kit, '原音確認.html'), `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NEST ACOUSTIC | 専門家確認</title><style>${css}</style></head><body><div id="root"></div><script id="initial-experiment" type="application/json">${initial}</script><script type="module">${js}</script></body></html>`);
for (const name of ['results.json', 'diagnosis.csv', 'audit-plan.csv', '専門家への依頼と操作手順.md', '改善実験レポート_20261029.md']) fs.copyFileSync(path.join(out, name), path.join(kit, name));
console.log(`Expert review kit: ${kit}`);
