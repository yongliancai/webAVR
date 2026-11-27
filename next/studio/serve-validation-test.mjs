// Synthetic, temporary browser checks. No original documents or live database.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import sharp from 'sharp';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from '../app.mjs';
import {seed,TEST_PASSWORD} from '../fixtures.mjs';
import {createStudio} from './backend.mjs';
const folder=await mkdtemp(join(tmpdir(),'webavr-browser-validation-')),root=pathToFileURL(folder+'/'),db=new PGlite();await db.waitReady;await seed(db,new URL('../schema/',import.meta.url));
const studio=await createStudio(db,{privateRoot:root}),origin='http://localhost:3994';
const app=await createApp(db,{origin,secureCookies:false,mailer:async()=>{},studio,webRoot:new URL('../public/',import.meta.url),authLimit:100,writeLimit:1000});
const login=await app.dispatch({method:'POST',path:'/api/auth/login',headers:{origin,'content-type':'application/json'},body:{email:'teachera@example.invalid',password:TEST_PASSWORD}}),cookie=login.headers['set-cookie'];
const session=(await app.dispatch({path:'/api/auth/session',headers:{cookie:cookie.split(';')[0]}})).body,headers={cookie:cookie.split(';')[0],origin,'x-csrf-token':session.csrfToken,'content-type':'application/json'};
const call=(path,body)=>app.dispatch({method:body===undefined?'GET':'POST',path,body,headers});
const image=await sharp({create:{width:1024,height:512,channels:3,background:'#769aaf'}}).jpeg().toBuffer();
const media=(await call('/api/studio/media',{name:'synthetic.jpg',data:image.toString('base64')})).body;
const broken=(await call('/api/studio/media',{name:'broken-synthetic.jpg',data:image.toString('base64')})).body;await writeFile(new URL('media/'+broken.id+'.jpg',root),'not-an-image');
const good=(await call('/api/studio/courses',{title:'正常教材（隔離測試）'})).body;
good.document.coverAssetId=media.id;good.document.scenes=[{id:crypto.randomUUID(),title:'正常場景',assetId:media.id,projection:'equirectangular',hotspots:[{id:crypto.randomUUID(),kind:'info',title:'原知識點',content:'圖標內容保留',pitch:0,yaw:0},{id:crypto.randomUUID(),kind:'choice',title:'原選擇題',content:'原選項保留',pitch:0,yaw:0,payload:{options:{A:'選項一',B:'選項二'}}}]},{id:crypto.randomUUID(),title:'圖片損壞場景',assetId:broken.id,projection:'equirectangular',hotspots:[]}];
await call('/api/studio/courses/'+good.id,{revision:1,document:good.document});
const bad={...structuredClone(good.document),id:crypto.randomUUID(),title:'格式損壞教材（隔離測試）'};bad.scenes[0].hotspots[0].assetIds='broken-array';
await db.query('INSERT INTO studio.drafts(id,owner_id,document) VALUES($1,$2,$3)',[bad.id,session.user.id,bad]);
const bundle=await build({entryPoints:[new URL('./boundary-fixture.jsx',import.meta.url).pathname],write:false,bundle:true,minify:true,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},target:['es2022']});
const request=app.server.listeners('request')[0];app.server.removeAllListeners('request');app.server.on('request',(req,res)=>{
 const path=new URL(req.url,origin).pathname;
 if(path==='/test/start'){res.writeHead(303,{'set-cookie':cookie,location:'/studio'});res.end();return;}
 if(path==='/test/boundaries'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>錯誤隔離驗證</title><link rel="stylesheet" href="/studio.css"><div id="root"></div><script src="/test/boundaries.js" defer></script></html>');return;}
 if(path==='/test/boundaries.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(bundle.outputFiles[0].contents);return;}
 request(req,res);
});
await new Promise(resolve=>app.server.listen(3994,'127.0.0.1',resolve));console.log(JSON.stringify({start:origin+'/test/start',boundaryFixture:origin+'/test/boundaries',syntheticOnly:true}));
const close=()=>app.server.close(async()=>{await db.close();await rm(folder,{recursive:true,force:true});process.exit(0);});process.once('SIGINT',close);process.once('SIGTERM',close);
