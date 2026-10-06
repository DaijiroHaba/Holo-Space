import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.HOLO_PORT||8796);
const top=new Set(['index.html','style.css','app.mjs','model.mjs','gestures.mjs','spatial-controller.mjs','depth-controller.mjs','manipulation.mjs','interaction-flow.mjs','ATTRIBUTION.md']);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.glb':'model/gltf-binary','.task':'application/octet-stream','.md':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(self), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"};
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,headers);res.end();return;}
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403,headers);res.end();return;}
  try{
    const url=new URL(req.url,'http://localhost');const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';
    if(relative.includes('..')||relative.includes('\\')||(!top.has(relative)&&!/^vendor\/[a-zA-Z0-9_./-]+$/.test(relative)&&!/^models\/anatomy\/[a-zA-Z0-9_.-]+$/.test(relative)&&relative!=='models/hand_landmarker.task')){res.writeHead(404,headers);res.end();return;}
    const target=path.resolve(root,relative);if(!target.startsWith(root+path.sep)){res.writeHead(404,headers);res.end();return;}
    const info=await stat(target);if(!info.isFile())throw new Error('not file');
    res.writeHead(200,{...headers,'Content-Type':mime[path.extname(target)]||'text/plain','Content-Length':info.size});res.end(req.method==='HEAD'?undefined:await readFile(target));
  }catch{res.writeHead(404,headers);res.end();}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port 8796 is already in use. Close the other server or set HOLO_PORT.':e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`HOLO_BODY_READY http://127.0.0.1:${port}`));


