// 开发服务器：每次请求首页时重新打包，改完代码刷新即可
import { createServer } from 'node:http';
import { buildGame } from './build.mjs';

const port = Number(process.env.PORT) || 5173;
createServer(async (req, res) => {
  try {
    const html = await buildGame();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(e));
  }
}).listen(port, () => console.log(`Tesla Run  http://localhost:${port}`));
