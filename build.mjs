// 把 src/main.js 打包成单个内联 JS，写入 dist/index.html（可直接双击打开，无需服务器）
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function buildGame() {
  const result = await build({
    entryPoints: ['src/main.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    legalComments: 'none',
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  // 可选：assets/roadster.glb 存在时内嵌为 data URI，单文件也能带上真实车模
  // 车头朝反可在 assets/roadster.json 里写 { "yaw": 180 }
  let model = '';
  if (existsSync('assets/roadster.glb')) {
    const b64 = readFileSync('assets/roadster.glb').toString('base64');
    const meta = existsSync('assets/roadster.json') ? JSON.parse(readFileSync('assets/roadster.json', 'utf8')) : {};
    const yaw = Number(meta.yaw) || 0;
    const credit = JSON.stringify(String(meta.credit || '')).replace(/</g, '\\u003c');
    model = `<script>window.__ROADSTER_GLB__='data:model/gltf-binary;base64,${b64}';window.__ROADSTER_YAW__=${yaw};window.__ROADSTER_CREDIT__=${credit};</script>`;
  }
  const html = readFileSync('src/index.html', 'utf8').replace('<!--GAME_SCRIPT-->', () => `${model}<script>${js}</script>`);
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/index.html', html);
  return html;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const html = await buildGame();
  console.log(`dist/index.html 已生成 (${(html.length / 1024).toFixed(0)} KB)`);
}
