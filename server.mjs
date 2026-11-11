// Optional local preview; monitoring and email use the deployed DayFlow-backed endpoint.
import http from 'node:http';
import fs from 'node:fs';
const files={'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/vendor/supabase.js':['vendor/supabase.js','text/javascript']};
http.createServer((req,res)=>{const file=files[req.url?.split('?')[0]];if(req.method!=='GET'||!file){res.writeHead(404);res.end('Not found');return}res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(new URL(file[0],import.meta.url)));}).listen(8787,'127.0.0.1',()=>console.log('Monitor02 preview: http://127.0.0.1:8787'));
