// Isolated browser fault-injection fixture. Never used by the normal server.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from '../app.mjs';
import {seed,TEST_PASSWORD} from '../fixtures.mjs';
import {createStudio} from './backend.mjs';
import sharp from 'sharp';
const folder=await mkdtemp(join(tmpdir(),'webavr-editor-browser-')),db=new PGlite();
await db.waitReady;await seed(db,new URL('../schema/',import.meta.url));
const studio=await createStudio(db,{privateRoot:pathToFileURL(folder+'/')});
let mode='normal',failList=false;const fail=()=>{throw Object.assign(Error('TEST_FAILURE'),{status:503,code:'TEST_FAILURE'});};
const wrapped={handle:async args=>{
 if(args.pathname==='/api/studio/courses'&&args.method==='GET'&&failList){failList=false;fail();}
 if(mode==='media'&&args.pathname==='/api/studio/media-status'){fail();}
 const result=await studio.handle(args);
 if(args.method==='POST'&&/^\/api\/studio\/courses\/[^/]+$/.test(args.pathname)){
  if(mode==='list'){failList=true;mode='normal';}
  if(mode==='ack'){mode='normal';fail();}
 }
 return result;
}};
const origin='http://localhost:3996',app=await createApp(db,{origin,secureCookies:false,mailer:async()=>{},studio:wrapped,webRoot:new URL('../public/',import.meta.url),authLimit:100,writeLimit:1000});
const login=await app.dispatch({method:'POST',path:'/api/auth/login',headers:{origin,'content-type':'application/json'},body:{email:'teachera@example.invalid',password:TEST_PASSWORD}}),cookie=login.headers['set-cookie'];
const session=await app.dispatch({path:'/api/auth/session',headers:{cookie:cookie.split(';')[0]}});
const headers={cookie:cookie.split(';')[0],origin,'content-type':'application/json','x-csrf-token':session.body.csrfToken};
const call=(path,body)=>app.dispatch({method:body===undefined?'GET':'POST',path,headers,body});
const image=await sharp({create:{width:1024,height:512,channels:3,background:'#648eab'}}).jpeg().toBuffer();
const upload=await call('/api/studio/media',{name:'synthetic-panorama.jpg',data:image.toString('base64')});
const created=await call('/api/studio/courses',{title:'可靠性驗證教材（假資料）'}),document=created.body.document;
document.coverAssetId=upload.body.id;document.scenes=[{id:crypto.randomUUID(),title:'測試場景',assetId:upload.body.id,projection:'equirectangular',pitch:0,yaw:0,hotspots:[{id:crypto.randomUUID(),kind:'info',title:'測試知識點',content:'原圖標操作保留',pitch:0,yaw:0},{id:crypto.randomUUID(),kind:'choice',title:'測試題目',content:'原內容保留',pitch:0,yaw:0,payload:{options:{A:'選項一',B:'選項二'}}}]}];
await call('/api/studio/courses/'+created.body.id,{revision:1,document});
const handler=app.server.listeners('request')[0];app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{
 const path=new URL(req.url,origin).pathname;
 if(path==='/test/start'){res.writeHead(303,{'set-cookie':cookie,location:'/studio'});res.end();return;}
 if(path==='/test/control'){
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<h1>隔離測試控制台</h1><p>只有假資料，與原教材資料庫無關。</p>'+['normal','list','media','ack'].map(x=>'<form method="post" action="/test/mode/'+x+'"><button>'+({normal:'恢復正常',list:'下次儲存後列表失敗',media:'素材狀態失敗',ack:'儲存成功但回應失敗'}[x])+'</button></form>').join(''));return;
 }
 if(path.startsWith('/test/mode/')&&req.method==='POST'){mode=path.split('/').at(-1);res.writeHead(303,{location:'/test/control'});res.end();return;}
 handler(req,res);
});
await new Promise(resolve=>app.server.listen(3996,'127.0.0.1',resolve));
console.log(JSON.stringify({url:origin+'/test/start',controls:origin+'/test/control',syntheticOnly:true}));
const close=()=>app.server.close(async()=>{await db.close();await rm(folder,{recursive:true,force:true});process.exit(0);});process.once('SIGINT',close);process.once('SIGTERM',close);
