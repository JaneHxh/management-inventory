import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), 'dist');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.zip':'application/zip','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.csv':'text/csv; charset=utf-8'};
http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep) || !(['index.html','src/app.js','src/model.js','src/style.css'].includes(file.slice(root.length + 1))||(file.slice(root.length+1).startsWith('templates/')&&['.xlsx','.csv','.zip'].includes(extname(file))))) {
      res.writeHead(404); return res.end('Not found');
    }
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type': types[extname(file)], 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff'});
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Inventory app listening on port ' + (process.env.PORT || 3000)));
