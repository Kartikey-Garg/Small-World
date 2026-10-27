// node addmod.js <name>  -- registers mods/<name>.js in mods/load.js and index.html (idempotent)
const fs = require('fs');
const n = process.argv[2];
if (!n || !fs.existsSync(`mods/${n}.js`)) { console.error('missing mods/' + n + '.js'); process.exit(1); }
let l = fs.readFileSync('mods/load.js', 'utf8');
if (!l.includes(`'${n}'`)) { l = l.replace(/\n\]\.forEach/, `\n  '${n}',\n].forEach`); fs.writeFileSync('mods/load.js', l.replace(/\s+$/, '\n')); }
let h = fs.readFileSync('index.html', 'utf8');
const tag = `<script src="mods/${n}.js"></script>`;
if (!h.includes(tag)) { h = h.replace('<script src="ui.js">', tag + '\n<script src="ui.js">'); fs.writeFileSync('index.html', h); }
console.log('registered', n);
