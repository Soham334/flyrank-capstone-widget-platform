import http from 'node:http';
import { readFileSync } from 'node:fs';
const files={'/':['index.html','text/html'],'/demo.js':['demo.js','text/javascript'],'/demo.css':['demo.css','text/css']};
const port=Number(process.env.DEMO_PORT||5500);
http.createServer((req,res)=>{const path=new URL(req.url,'http://local').pathname;const asset=files[path];if(!asset){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(readFileSync(new URL('../demo/'+asset[0],import.meta.url)));}).listen(port,'127.0.0.1',()=>console.log(`Customer site: http://localhost:${port} (use a widget's snippet dialog for the linked demo)`));
