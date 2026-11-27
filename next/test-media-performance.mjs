import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readdir,readFile,mkdir,writeFile,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';
import http from 'node:http';
import sharp from 'sharp';
import {PGlite} from '@electric-sql/pglite';
import {createStudio} from './studio/backend.mjs';
import {createApp} from './app.mjs';
import {seed,TEST_PASSWORD} from './fixtures.mjs';
import {createMediaQueue} from './studio/media-service.mjs';
import {choosePanoramaWidth,panoramaWidth} from './studio/panorama-profile.mjs';
import {uploadImage,xhrRequest} from './studio/upload-client.mjs';
let count=0;const ok=(value,label)=>{assert.ok(value,label);count++;console.log('PASS '+label);};
const hash=b=>createHash('sha256').update(b).digest('hex');
ok(choosePanoramaWidth({coarse:true})===2048,'tablet automatically uses a smaller panorama');
ok(choosePanoramaWidth({width:1280,memory:8})===4096,'desktop gets a bounded higher-detail panorama');
ok(choosePanoramaWidth({memory:4})===2048,'low-memory devices use the smaller panorama');
ok(choosePanoramaWidth({maxTexture:1024})===1024,'low texture limits are respected');
ok(panoramaWidth('4096',{maxTexture:2048})===2048,'manual quality cannot exceed the detected texture budget');
const queue=createMediaQueue({concurrency:1,maxPending:1});let release;const blocked=queue.run(()=>new Promise(r=>{release=r}));await new Promise(r=>setTimeout(r,0));const queued=queue.run(()=>2);await assert.rejects(queue.run(()=>3),e=>e.code==='MEDIA_BUSY');release(1);ok((await blocked)===1&&(await queued)===2,'bounded image work queue limits concurrency and rejects overflow');
const signal=new AbortController();signal.abort();await assert.rejects(queue.run(()=>assert.fail(),signal.signal),e=>e.code==='UPLOAD_CANCELLED');ok(true,'cancelled queued work cannot run');
const events=[],file=new File([new Uint8Array(100)],'test.jpg',{type:'image/jpeg'}),fakeId=crypto.randomUUID();let sent,requests=0;
function makeXHR(){return {upload:{},open(){},setRequestHeader(){},send(body){sent=body;requests++;queueMicrotask(()=>{this.upload.onprogress({lengthComputable:true,loaded:25,total:100});this.upload.onload();this.status=200;this.responseText=JSON.stringify({id:fakeId,width:1024,height:512});this.onload();});},abort(){this.onabort();}};}
const uploaded=await uploadImage({file,operationId:crypto.randomUUID(),api:async()=>({completed:false}),getUserId:()=> 'teacher',getToken:()=> 'token',setToken:()=>{},signal:new AbortController().signal,onState:e=>events.push(e),makeXHR});
ok(sent===file&&uploaded.id===fakeId,'browser sends the original File bytes instead of Base64');
ok(events.some(e=>e.percent===25)&&events.some(e=>e.phase==='processing'&&e.percent===100),'progress separates bytes sent from server processing');
const cancelled=new AbortController();let xhr;const pending=xhrRequest('/upload',{method:'POST',body:file,signal:cancelled.signal},{makeXHR:()=>{xhr={upload:{},open(){},setRequestHeader(){},send(){},abort(){this.onabort();}};return xhr;}});cancelled.abort();await assert.rejects(pending,e=>e.code==='UPLOAD_CANCELLED');ok(true,'browser cancel aborts the upload request');
const before=requests;await uploadImage({file,operationId:crypto.randomUUID(),api:async()=>({completed:true,media:{id:fakeId}}),getUserId:()=> 'teacher',getToken:()=>'',setToken:()=>{},signal:new AbortController().signal,makeXHR});ok(requests===before,'retry reuses an acknowledged image without uploading again');
const folder=await mkdtemp(join(tmpdir(),'webavr-media-test-')),root=pathToFileURL(folder+'/'),db=new PGlite();let app;
try{
 await db.waitReady;await seed(db,new URL('./schema/',import.meta.url));const studio=await createStudio(db,{privateRoot:root});app=await createApp(db,{origin:'http://127.0.0.1:3992',secureCookies:false,mailer:async()=>{},studio,authLimit:100,writeLimit:1000});
 const origin='http://127.0.0.1:3992';async function login(name){const r=await app.dispatch({method:'POST',path:'/api/auth/login',headers:{origin,'content-type':'application/json'},body:{email:name+'@example.invalid',password:TEST_PASSWORD}});const cookie=r.headers['set-cookie'].split(';')[0],s=await app.dispatch({path:'/api/auth/session',headers:{cookie}});return {cookie,origin,'x-csrf-token':s.body.csrfToken,'content-type':'application/json'};}
 const teacher=await login('teachera'),other=await login('teacherb'),admin=await login('admin');
 const call=(headers,path,body,extra={})=>app.dispatch({method:body===undefined?'GET':'POST',headers,path,body,...extra});
 const image=await sharp({create:{width:6000,height:3000,channels:3,background:'#668999'}}).jpeg().toBuffer(),id=crypto.randomUUID(),meta={id,name:'原圖.jpg',size:image.length,mime:'image/jpeg',sha256:hash(image)};
 const prepare=await call(teacher,'/api/studio/uploads',meta);ok(prepare.status===200&&!prepare.body.completed,'upload operation prepared with exact size and checksum');
 ok((await call(other,'/api/studio/uploads',meta)).status===404,'another account cannot reuse the upload operation');
 const rawHeaders={...teacher,'content-type':'application/octet-stream','content-length':String(image.length)};
 const deniedStream=Readable.from([image]);const anonymous=await call({origin,'content-type':'application/octet-stream'},'/api/studio/uploads/'+id+'/content',{}, {uploadStream:deniedStream});ok(anonymous.status===401&&deniedStream.readableFlowing===null,'anonymous binary uploads rejected before reading bytes');
 const csrfStream=Readable.from([image]);const csrfDenied=await call({...rawHeaders,'x-csrf-token':'wrong'},'/api/studio/uploads/'+id+'/content',{}, {uploadStream:csrfStream});ok(csrfDenied.status===403&&csrfDenied.body.error.code==='CSRF_DENIED'&&csrfStream.readableFlowing===null,'binary upload CSRF checked before consuming the file');
 const originDenied=await call({...rawHeaders,origin:'http://untrusted.invalid'},'/api/studio/uploads/'+id+'/content',{}, {uploadStream:Readable.from([image])});ok(originDenied.status===403,'foreign origin cannot upload bytes');

 const result=await call(rawHeaders,'/api/studio/uploads/'+id+'/content',{}, {uploadStream:Readable.from([image])});ok(result.status===200&&result.body.width===4096&&result.body.height===2048,'binary upload validates and makes a bounded display image');const mediaId=result.body.id;
 const original=await call(teacher,'/api/studio/media/'+mediaId+'/original');const chunks=[];for await(const c of original.stream())chunks.push(c);ok(hash(Buffer.concat(chunks))===hash(image),'original uploaded image retained byte-for-byte');
 ok((await call(other,'/api/studio/media/'+mediaId+'/original')).status===404,'original download requires the owning account');
 const repeat=await call(teacher,'/api/studio/uploads',meta);ok(repeat.body.completed&&repeat.body.media.id===mediaId,'retry after lost acknowledgment finds the existing image');
 ok((await db.query('SELECT count(*)::int AS n FROM studio.media')).rows[0].n===1,'idempotent retry does not create duplicate media');
 ok((await call(teacher,'/api/studio/uploads',{...meta,sha256:'a'.repeat(64)})).status===409,'an operation cannot be reused for different content');
 for(const width of [1024,2048,4096]){const response=await call(teacher,'/api/studio/media/'+mediaId+'/panorama-'+width);ok(typeof response.stream==='function'&&!response.binary,'panorama '+width+' uses streaming output');const bytes=[];for await(const chunk of response.stream())bytes.push(chunk);const m=await sharp(Buffer.concat(bytes)).metadata();ok(m.width===width&&m.height===width/2,'panorama '+width+' preserves the 2:1 aspect ratio');}
 const thumb=await call(teacher,'/api/studio/media/'+mediaId+'/thumbnail');const t=[];for await(const c of thumb.stream())t.push(c);const tm=await sharp(Buffer.concat(t)).metadata();ok(tm.width===320&&tm.height===180,'existing scene thumbnail dimensions preserved');
 ok((await call(other,'/api/studio/media/'+mediaId+'/panorama-2048')).status===404,'cached variants do not bypass media authorization');
 const badId=crypto.randomUUID();await call(teacher,'/api/studio/uploads',{...meta,id:badId});const bad=await call(rawHeaders,'/api/studio/uploads/'+badId+'/content',{}, {uploadStream:Readable.from([Buffer.alloc(image.length)])});ok(bad.status===400&&(await db.query('SELECT media_id FROM studio.uploads WHERE id=$1',[badId])).rows[0].media_id===null,'checksum failure cannot commit an image');
 ok((await readdir(new URL('upload-tmp/',root))).length===0,'failed upload leaves no temporary file');
 const controller=new AbortController(),cancelId=crypto.randomUUID();await call(teacher,'/api/studio/uploads',{...meta,id:cancelId});async function* interrupted(){yield image.subarray(0,100);controller.abort();yield image.subarray(100);}
 await call(rawHeaders,'/api/studio/uploads/'+cancelId+'/content',{}, {uploadStream:Readable.from(interrupted()),signal:controller.signal});ok((await db.query('SELECT media_id FROM studio.uploads WHERE id=$1',[cancelId])).rows[0].media_id===null&&(await readdir(new URL('upload-tmp/',root))).length===0,'cancel during receive commits nothing and cleans temporary bytes');
 const resumed=await call(rawHeaders,'/api/studio/uploads/'+cancelId+'/content',{}, {uploadStream:Readable.from([image])});ok(resumed.status===200,'cancelled upload can be explicitly retried');
 const streamId=crypto.randomUUID();await mkdir(new URL('source-media/originals/',root),{recursive:true});const fp=new URL('source-media/originals/'+streamId+'.bin',root),fd=await open(fp,'w');await fd.truncate(64*1024*1024);await fd.write(Buffer.from('TAIL'),0,4,64*1024*1024-4);await fd.close();await db.query('INSERT INTO studio.course_files VALUES($1,$2,$3,$4,$5,$6,$7)',[streamId,streamId+'.bin','audio/mpeg','audio',64*1024*1024,'a'.repeat(64),'test-audio.mp3']);
 const full=await call(admin,'/api/studio/files/'+streamId);ok(typeof full.stream==='function'&&!full.binary&&full.stream().readableHighWaterMark===65536,'64 MB media response uses a bounded 64 KB file stream');
 const range=await call({...admin,range:'bytes=-4'},'/api/studio/files/'+streamId);const tail=[];for await(const c of range.stream())tail.push(c);ok(range.status===206&&Buffer.concat(tail).toString()==='TAIL','audio/video suffix seeking preserves exact bytes');
 ok((await call({...admin,range:'bytes=0-2,5-6'},'/api/studio/files/'+streamId)).status===416,'invalid multiple media ranges rejected');
 ok((await call(other,'/api/studio/files/'+streamId)).status===403,'streaming does not widen legacy media access');
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
 const httpRange=await fetch(base+'/api/studio/files/'+streamId,{headers:{cookie:admin.cookie,range:'bytes=-4'}});ok(httpRange.status===206&&(await httpRange.text())==='TAIL','real HTTP pipeline supports media seeking');
 const httpId=crypto.randomUUID();await call(teacher,'/api/studio/uploads',{...meta,id:httpId});const viaHTTP=await fetch(base+'/api/studio/uploads/'+httpId+'/content',{method:'POST',headers:rawHeaders,body:image});ok(viaHTTP.status===200&&(await viaHTTP.json()).width===4096,'real HTTP accepts an authenticated binary upload');
 const abortId=crypto.randomUUID();await call(teacher,'/api/studio/uploads',{...meta,id:abortId});await new Promise(resolve=>{const request=http.request(base+'/api/studio/uploads/'+abortId+'/content',{method:'POST',headers:rawHeaders});request.on('error',()=>resolve());request.write(image.subarray(0,100));setTimeout(()=>request.destroy(),20);});await new Promise(r=>setTimeout(r,30));ok((await readdir(new URL('upload-tmp/',root))).length===0,'aborted HTTP connection cleans temporary upload files');
 ok((await fetch(base+'/api/health')).status===200,'service remains healthy after cancelling a real connection');
 const holds=[];try{for(let i=0;i<3;i++){const op=crypto.randomUUID();await call(teacher,'/api/studio/uploads',{...meta,id:op});const request=http.request(base+'/api/studio/uploads/'+op+'/content',{method:'POST',headers:rawHeaders});request.on('error',()=>{});request.write(image.subarray(0,100));holds.push(request);}await new Promise(r=>setTimeout(r,60));const extraId=crypto.randomUUID();await call(teacher,'/api/studio/uploads',{...meta,id:extraId});const overloaded=await fetch(base+'/api/studio/uploads/'+extraId+'/content',{method:'POST',headers:rawHeaders,body:image});ok(overloaded.status===429&&(await overloaded.json()).error.code==='MEDIA_BUSY','simultaneous uploads have a bounded admission limit');}finally{for(const request of holds)request.destroy();await new Promise(r=>setTimeout(r,30));}

 console.log(JSON.stringify({passed:count,originalWidth:6000,desktopWidth:4096,tabletWidth:2048,syntheticOnly:true}));
}finally{if(app)await new Promise(resolve=>app.server.close(resolve));await db.close();await rm(folder,{recursive:true,force:true});}
