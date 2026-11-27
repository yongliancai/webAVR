// Synthetic browser checks only; never starts with the real teaching database.
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import sharp from 'sharp';
import {createApp} from '../app.mjs';
import {createStudio} from './backend.mjs';
import {seed,TEST_PASSWORD} from '../fixtures.mjs';
const folder=await mkdtemp(join(tmpdir(),'webavr-editor-layout-')),root=pathToFileURL(folder+'/'),db=new PGlite();await db.waitReady;await seed(db,new URL('../schema/',import.meta.url));const studio=await createStudio(db,{privateRoot:root});
let mode='normal';const wrapped={handle:async args=>{const content=/^\/api\/studio\/uploads\/[^/]+\/content$/.test(args.pathname);if(content&&mode==='slow')await new Promise(resolve=>setTimeout(resolve,6000));if(content&&mode==='fail'){mode='normal';throw Object.assign(Error('TEST_FAILURE'),{status:503,code:'TEST_FAILURE'});}const result=await studio.handle(args);if(content&&mode==='ack'){mode='normal';throw Object.assign(Error('TEST_ACK_FAILURE'),{status:503,code:'TEST_ACK_FAILURE'});}return result;}};
const origin='http://localhost:3991',app=await createApp(db,{origin,secureCookies:false,mailer:async()=>{},studio:wrapped,webRoot:new URL('../public/',import.meta.url),authLimit:100,writeLimit:1000});
const login=await app.dispatch({method:'POST',path:'/api/auth/login',headers:{origin,'content-type':'application/json'},body:{email:'admin@example.invalid',password:TEST_PASSWORD}}),cookie=login.headers['set-cookie'],session=(await app.dispatch({path:'/api/auth/session',headers:{cookie:cookie.split(';')[0]}})).body,headers={cookie:cookie.split(';')[0],origin,'x-csrf-token':session.csrfToken,'content-type':'application/json'};
const image=await sharp({create:{width:6000,height:3000,channels:3,background:'#6d96a9'}}).jpeg().toBuffer();const media=(await app.dispatch({method:'POST',path:'/api/studio/media',headers,body:{name:'synthetic.jpg',data:image.toString('base64')}})).body;
const soundId=crypto.randomUUID(),badSoundId=crypto.randomUUID();await mkdir(new URL('source-media/originals/',root),{recursive:true});
const wav=Buffer.alloc(44+16000);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
for(const [id,bytes,label] of [[soundId,wav,'測試音訊'],[badSoundId,Buffer.from('not audio'),'損壞音訊']]){await writeFile(new URL('source-media/originals/'+id+'.bin',root),bytes);await db.query('INSERT INTO studio.course_files VALUES($1,$2,$3,$4,$5,$6,$7)',[id,id+'.bin','audio/wav','audio',bytes.length,'a'.repeat(64),label]);}
const course=(await app.dispatch({method:'POST',path:'/api/studio/courses',headers,body:{title:'教材編輯版面驗證（假資料）'}})).body;course.document.coverAssetId=media.id;course.document.scenes=[{id:crypto.randomUUID(),title:'測試全景',assetId:media.id,projection:'equirectangular',hotspots:[{id:crypto.randomUUID(),kind:'info',title:'原知識點',content:'圖標操作保留',pitch:0,yaw:0},{id:crypto.randomUUID(),kind:'choice',title:'原題目',content:'選項保留',pitch:0,yaw:0,payload:{options:{A:'甲',B:'乙'}}},{id:crypto.randomUUID(),kind:'audio',title:'測試音訊',content:'只有假資料',pitch:0,yaw:0,assetIds:[soundId,badSoundId]}]}];await app.dispatch({method:'POST',path:'/api/studio/courses/'+course.id,headers,body:{revision:1,document:course.document}});
course.document.maps=[{id:crypto.randomUUID(),title:'測試橫式地圖',assetId:media.id,markers:[{id:crypto.randomUUID(),title:'原地圖標記',x:0.5,y:0.5,targetSceneId:course.document.scenes[0].id}]}];await app.dispatch({method:'POST',path:'/api/studio/courses/'+course.id,headers,body:{revision:2,document:course.document}});
const uploadFile=join(folder,'upload-check.jpg');await writeFile(uploadFile,await sharp(randomBytes(3600*1800*3),{raw:{width:3600,height:1800,channels:3}}).jpeg({quality:90}).toBuffer());
const handler=app.server.listeners('request')[0];app.server.removeAllListeners('request');app.server.on('request',(req,res)=>{
 const path=new URL(req.url,origin).pathname;
 if(path==='/test/start'){res.writeHead(303,{'set-cookie':cookie,location:'/studio'});res.end();return;}
 if(path==='/test/control'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<h1>假資料上傳驗證</h1>'+['normal','slow','fail','ack'].map(x=>'<form method="post" action="/test/mode/'+x+'"><button>'+({normal:'正常上傳',slow:'延遲接收供取消測試',fail:'下一次上傳失敗',ack:'完成但回應失敗'}[x])+'</button></form>').join(''));return;}
 if(path.startsWith('/test/mode/')&&req.method==='POST'){mode=path.split('/').at(-1);res.writeHead(303,{location:'/test/control'});res.end();return;}
 handler(req,res);
});
await new Promise(resolve=>app.server.listen(3991,'127.0.0.1',resolve));console.log(JSON.stringify({start:origin+'/test/start',control:origin+'/test/control',uploadFile,syntheticOnly:true}));
const close=()=>app.server.close(async()=>{await db.close();await rm(folder,{recursive:true,force:true});process.exit(0);});process.once('SIGINT',close);process.once('SIGTERM',close);
