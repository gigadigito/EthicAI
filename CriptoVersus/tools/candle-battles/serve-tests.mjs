import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../wwwroot/',import.meta.url));
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.wav':'audio/wav','.css':'text/css'};
const server=http.createServer(async(req,res)=>{
 try{
 const p=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!p.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403).end();return;}
 const data=await readFile(p);res.writeHead(200,{'Content-Type':mime[extname(p)]??'application/octet-stream','Cache-Control':'no-store'}).end(data);
 }catch{res.writeHead(404).end();}
});
const port=Number(process.env.CANDLE_BATTLE_TEST_PORT ?? 4287);
server.listen(port,'127.0.0.1');
