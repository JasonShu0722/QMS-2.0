import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.resolve(webRoot, '../../dist/share');
const outputPath = path.join(outputDirectory, 'QMS-UI-Preview.html');
const result = await build({
  configFile: false,
  root: webRoot,
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    write: false,
    sourcemap: false,
    cssCodeSplit: false,
    minify: 'esbuild',
    lib: {
      entry: path.join(webRoot, 'src/prototypes/ui-direction/main.tsx'),
      name: 'QmsUiPreview',
      formats: ['iife'],
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

const outputs = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
const scripts = outputs.filter(output => output.type === 'chunk');
const styles = outputs.filter(output => output.type === 'asset' && output.fileName.endsWith('.css'));
if (scripts.length !== 1 || styles.length !== 1 || outputs.length !== 2) {
  throw new Error('Expected exactly one JavaScript bundle and one stylesheet');
}
if (scripts[0].imports.length || scripts[0].dynamicImports.length) {
  throw new Error('Offline bundle must not contain external JavaScript imports');
}
const css = String(styles[0].source);
if (/@import\b|url\(\s*['"]?(?!data:|#)/i.test(css)) {
  throw new Error('Offline stylesheet must not reference external assets');
}
const script = scripts[0].code.replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#277cc4">
<meta name="description" content="QMS 2.0 设计方向样板：综合工作台、质量分析中心与 8D 处理空间。全部为演示数据，可离线浏览。">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'">
<title>QMS 2.0 · 离线设计样板 V2</title>
<style>${css.replace(/<\/style/gi, '<\\/style')}</style>
</head>
<body>
<noscript>请在浏览器中启用 JavaScript，以浏览三个交互式演示页面。</noscript>
<div id="root"></div>
<script>${script}</script>
</body>
</html>
`;
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, html, 'utf8');
console.log(`Offline HTML: ${outputPath}`);
console.log(`Size: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB`);
