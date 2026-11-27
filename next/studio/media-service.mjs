import {createReadStream,createWriteStream,constants} from 'node:fs';
import {mkdir,stat,writeFile,copyFile,unlink,rename} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
const failure=(status,code)=>Object.assign(Error(code),{status,code});
const check=(value,status,code)=>{if(!value)throw failure(status,code);};
const abort=signal=>{if(signal?.aborted)throw failure(499,'UPLOAD_CANCELLED');};
export function createMediaQueue({concurrency=1,maxPending=24}={}){
 let running=0;const pending=[];
 function drain(){while(running<concurrency&&pending.length){const job=pending.shift();running++;Promise.resolve().then(()=>{abort(job.signal);return job.work();}).then(job.resolve,job.reject).finally(()=>{running--;drain();});}}
 return {run(work,signal,priority=0){if(pending.length>=maxPending)return Promise.reject(failure(429,'MEDIA_BUSY'));return new Promise((resolve,reject)=>{pending.push({work,signal,resolve,reject,priority});pending.sort((a,b)=>b.priority-a.priority);drain();});}};
}
export async function fileResponse(path,mime,{range,downloadName}={}){
 const info=await stat(path),size=info.size;let start=0,end=size-1,status=200;
 if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);check(size>0&&m&&(m[1]||m[2]),416,'INVALID_RANGE');
  if(!m[1]){const tail=Number(m[2]);check(Number.isSafeInteger(tail)&&tail>0,416,'INVALID_RANGE');start=Math.max(0,size-tail);}
  else{start=Number(m[1]);if(m[2]){const last=Number(m[2]);check(Number.isSafeInteger(last),416,'INVALID_RANGE');end=Math.min(last,size-1);}}
  check(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start,416,'INVALID_RANGE');status=206;
 }
 const length=size?end-start+1:0;
 return {stream:()=>createReadStream(path,size?{start,end,highWaterMark:65536}:{highWaterMark:65536}),mime,status,headers:{'content-length':String(length),'accept-ranges':'bytes',...(status===206?{'content-range':`bytes ${start}-${end}/${size}`}:{ }),...(downloadName?{'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(downloadName)}:{})}};
}
export async function createMediaService(db,privateRoot){
 const root=new URL('media/',privateRoot),originals=new URL('media-originals/',privateRoot),temporary=new URL('upload-tmp/',privateRoot),variants=new URL('media-variants/',privateRoot);
 for(const p of [root,originals,temporary,variants])await mkdir(p,{recursive:true,mode:0o700});
 await db.exec(`CREATE TABLE IF NOT EXISTS studio.media_originals(media_id uuid PRIMARY KEY REFERENCES studio.media(id),filename text NOT NULL,mime text NOT NULL,size_bytes integer NOT NULL,sha256 text NOT NULL);
 CREATE TABLE IF NOT EXISTS studio.uploads(id uuid PRIMARY KEY,owner_id uuid NOT NULL,name text NOT NULL,size_bytes integer NOT NULL,mime text NOT NULL,sha256 text NOT NULL,media_id uuid REFERENCES studio.media(id),created_at timestamptz NOT NULL DEFAULT now());`);
 const queue=createMediaQueue(),claimed=new Set(),derivations=new Map();
 async function media(id,owner){const row=(await db.query('SELECT id,width,height FROM studio.media WHERE id=$1 AND owner_id=$2',[id,owner])).rows[0];check(row,404,'MEDIA_MISSING');return {...row,url:'/api/studio/media/'+row.id};}
 async function prepare(user,body){
  check(typeof body.id==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.id),400,'INVALID_UPLOAD');
  check(typeof body.name==='string'&&body.name.length>0&&body.name.length<=200&&Number.isInteger(body.size)&&body.size>0&&body.size<=16000000,413,'IMAGE_TOO_LARGE');
  check(['image/jpeg','image/png','image/webp','application/octet-stream'].includes(body.mime)&&typeof body.sha256==='string'&&/^[a-f0-9]{64}$/.test(body.sha256),400,'INVALID_UPLOAD');
  await db.query('INSERT INTO studio.uploads(id,owner_id,name,size_bytes,mime,sha256) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',[body.id,user.id,body.name,body.size,body.mime,body.sha256]);
  const row=(await db.query('SELECT * FROM studio.uploads WHERE id=$1 AND owner_id=$2',[body.id,user.id])).rows[0];check(row,404,'NOT_FOUND');
  check(row.name===body.name&&row.size_bytes===body.size&&row.mime===body.mime&&row.sha256===body.sha256,409,'UPLOAD_ID_CONFLICT');
  return row.media_id?{id:row.id,completed:true,media:await media(row.media_id,user.id)}:{id:row.id,completed:false};
 }
 async function processImage(path,user,name,hash,size,{signal,operationId}={}){
  return queue.run(async()=>{
   abort(signal);const decoder=sharp(fileURLToPath(path),{limitInputPixels:50000000,animated:false}).timeout({seconds:30});let result,meta;
   try{meta=await decoder.metadata();check(['jpeg','png','webp'].includes(meta.format)&&!meta.pages,400,'INVALID_IMAGE');result=await decoder.rotate().resize({width:4096,height:4096,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer({resolveWithObject:true});}catch(e){if(e.status)throw e;throw failure(400,'INVALID_IMAGE');}
   abort(signal);const id=randomUUID(),display=new URL(id+'.jpg',root),original=new URL(id+'.bin',originals);let wroteDisplay=false,wroteOriginal=false;
   try{
    await writeFile(display,result.data,{mode:0o600,flag:'wx'});wroteDisplay=true;await copyFile(path,original,constants.COPYFILE_EXCL);wroteOriginal=true;abort(signal);
    await db.transaction(async tx=>{abort(signal);await tx.query('INSERT INTO studio.media(id,owner_id,filename,width,height,sha256,original_name) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,user.id,id+'.jpg',result.info.width,result.info.height,createHash('sha256').update(result.data).digest('hex'),name]);await tx.query('INSERT INTO studio.media_originals VALUES($1,$2,$3,$4,$5)',[id,id+'.bin',meta.format==='jpeg'?'image/jpeg':meta.format==='png'?'image/png':'image/webp',size,hash]);if(operationId)await tx.query('UPDATE studio.uploads SET media_id=$1 WHERE id=$2 AND owner_id=$3',[id,operationId,user.id]);abort(signal);});
   }catch(e){if(wroteDisplay)await unlink(display).catch(()=>{});if(wroteOriginal)await unlink(original).catch(()=>{});throw e;}
   return {id,width:result.info.width,height:result.info.height,url:'/api/studio/media/'+id};
  },signal,2);
 }
 async function receive(user,id,stream,headers,signal){
  id=id.toLowerCase();
  const row=(await db.query('SELECT * FROM studio.uploads WHERE id=$1 AND owner_id=$2',[id,user.id])).rows[0];check(row,404,'NOT_FOUND');
  if(headers['content-length']!==undefined)check(Number(headers['content-length'])===row.size_bytes,400,'UPLOAD_CONTENT_MISMATCH');
  if(row.media_id){stream.once?.('error',()=>{});stream.resume?.();return media(row.media_id,user.id);}
  check(!claimed.has(id),409,'UPLOAD_IN_PROGRESS');claimed.add(id);const path=new URL(randomUUID()+'.part',temporary);let size=0;const hash=createHash('sha256');
  try{
   const limiter=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>row.size_bytes||size>16000000)return callback(failure(413,'IMAGE_TOO_LARGE'));hash.update(chunk);callback(null,chunk);}});
   await pipeline(stream,limiter,createWriteStream(path,{mode:0o600,flags:'wx'}),{signal});abort(signal);const digest=hash.digest('hex');check(size===row.size_bytes&&digest===row.sha256,400,'UPLOAD_CONTENT_MISMATCH');
   return await processImage(path,user,row.name,digest,size,{signal,operationId:id});
  }finally{claimed.delete(id);await unlink(path).catch(()=>{});}
 }
 async function legacy(user,name,bytes,signal){const path=new URL(randomUUID()+'.part',temporary);try{await writeFile(path,bytes,{mode:0o600,flag:'wx'});return await processImage(path,user,name,createHash('sha256').update(bytes).digest('hex'),bytes.length,{signal});}finally{await unlink(path).catch(()=>{});}}
 async function variant(id,path,profile){
  const config={thumbnail:{width:320,height:180,fit:'cover',quality:75},preview:{width:2048,height:2048,fit:'inside',quality:82},'panorama-1024':{width:1024,height:1024,fit:'inside',quality:80},'panorama-2048':{width:2048,height:2048,fit:'inside',quality:84},'panorama-4096':{width:4096,height:4096,fit:'inside',quality:86}}[profile];
  check(config,400,'INVALID_MEDIA_PROFILE');const target=new URL(id+'-'+profile+'.jpg',variants);try{await stat(target);return target;}catch(e){if(e.code!=='ENOENT')throw e;}
  const key=id+':'+profile;if(!derivations.has(key))derivations.set(key,queue.run(async()=>{const temp=new URL(randomUUID()+'.jpg.tmp',temporary);try{await sharp(fileURLToPath(path),{limitInputPixels:50000000}).timeout({seconds:30}).resize({width:config.width,height:config.height,fit:config.fit,withoutEnlargement:profile!=='thumbnail'}).jpeg({quality:config.quality}).toFile(fileURLToPath(temp));await rename(temp,target);return target;}finally{await unlink(temp).catch(()=>{});}},undefined,profile.startsWith('panorama-')?1:0).finally(()=>derivations.delete(key)));
  return derivations.get(key);
 }
 return {prepare,receive,legacy,variant,fileResponse};
}
