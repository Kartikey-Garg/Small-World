// Tiny static server: node serve.js [port]
const http = require('http'), fs = require('fs'), path = require('path');
const port = +process.argv[2] || 8765;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  const f = path.join(__dirname, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(__dirname) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'text/plain' });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('Small World running at http://localhost:' + port));
