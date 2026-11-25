// Recover only teaching assets referenced by course/map/scene/activity graphs.
// Original per-object Firebase download tokens remain in memory, never in reports.
import {readFile,writeFile,mkdir,rename,stat,unlink} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
const root=new URL('../private-studio/',import.meta.url),folder=new URL('source-media/',root);
const cat=JSON.parse(await readFile(new URL('source-catalog.json',root),'utf8'));
const old=JSON.parse(await readFile(new URL('retrieval-results.json',folder),'utf8'));
const inv=JSON.parse(await readFile(new URL('inventory.json',folder),'utf8'));
const scope=new Set(inv.assets.map(x=>x.id)),uses=new Map(inv.assets.map(x=>[x.id,new Set(x.uses)]));
for(const course of [...cat.courses,...cat.unlinked.tours])for(const scene of course.scenes)for(const h of scene.hotspots)for(const aid of h.assetIds||[]){scope.add(aid);if(!uses.has(aid))uses.set(aid,new Set());uses.get(aid).add(h.kind);}
const approved=new Map([...scope].filter(id=>cat.assets[id]).map(id=>[cat.assets[id].bucket+'/'+cat.assets[id].object_path,id]));
const raw=await readFile(process.argv[2]);if(createHash('sha256').update(raw).digest('hex')!==cat.snapshotSha256)throw Error('SOURCE_SNAPSHOT_MISMATCH');
const links=new Map(),stack=[JSON.parse(raw)];
while(stack.length){const v=stack.pop();if(Array.isArray(v))for(const x of v)stack.push(x);else if(v&&typeof v==='object')for(const x of Object.values(v))stack.push(x);else if(typeof v==='string'&&v.startsWith('https://firebasestorage.googleapis.com/')){try{const u=new URL(v),m=u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);if(!m||u.hostname!=='firebasestorage.googleapis.com'||u.port||u.username||u.password)continue;const id=approved.get(decodeURIComponent(m[1])+'/'+decodeURIComponent(m[2]));if(id){if(!links.has(id))links.set(id,new Set());links.get(id).add(u.searchParams.get('token')||'');}}catch{}}}
for(const name of ['originals/','ready/','thumbnails/'])await mkdir(new URL(name,folder),{recursive:true,mode:0o700});
const oldBy=new Map(old.results.map(r=>[r.id,r]));let usedBytes=0,completed=0;const results=[];
async function hashFile(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
async function processFile(id,metadata){const path=new URL('originals/'+id+'.bin',folder);const mime=execFileSync('file',['--brief','--mime-type',path.pathname],{encoding:'utf8'}).trim();const base={id,...metadata,mime,uses:[...(uses.get(id)||[])]};
 if(mime.startsWith('image/')){try{const input=sharp(path.pathname,{limitInputPixels:150000000,animated:false});const m=await input.metadata();if(!['jpeg','png','webp','gif','tiff'].includes(m.format))throw Error('UNSUPPORTED_IMAGE');const image=await input.rotate().flatten({background:'#fff'}).resize({width:8192,height:8192,fit:'inside',withoutEnlargement:true}).jpeg({quality:92}).toBuffer({resolveWithObject:true});await writeFile(new URL('ready/'+id+'.jpg',folder),image.data,{mode:0o600});const thumb=await sharp(image.data).resize({width:320,height:180,fit:'cover'}).jpeg({quality:75}).toBuffer();await writeFile(new URL('thumbnails/'+id+'.jpg',folder),thumb,{mode:0o600});return {...base,state:'ready',kind:'image',width:image.info.width,height:image.info.height,derivativeSha256:createHash('sha256').update(image.data).digest('hex'),thumbnailSha256:createHash('sha256').update(thumb).digest('hex')};}catch{return {...base,state:'downloaded_needs_review',reason:'IMAGE_FORMAT_REVIEW'};}}
 if(mime.startsWith('audio/')||mime.startsWith('video/'))return {...base,state:'media_ready',kind:mime.startsWith('audio/')?'audio':'video'};
 return {...base,state:'attachment_ready',kind:mime==='application/pdf'?'pdf':mime.includes('zip')?'archive':'attachment'};
}
async function retrieve(id){const cached=oldBy.get(id),file=new URL('originals/'+id+'.bin',folder);
 if(cached?.originalSha256){try{if(await hashFile(file)!==cached.originalSha256)throw Error('CACHE_HASH_MISMATCH');return await processFile(id,{originalBytes:(await stat(file)).size,originalSha256:cached.originalSha256,fromCache:true});}catch(e){if(e.message==='CACHE_HASH_MISMATCH')return {id,state:'cache_integrity_failure'};}}
 const a=cat.assets[id];if(!a||a.bucket!=='webavr-b9273.appspot.com')return {id,state:'unapproved_source'};const candidates=[...(links.get(id)||[])];if(!candidates.length)candidates.push('');let attempts=0,lastStatus=null;
 for(const token of candidates){attempts++;if(usedBytes>3*1024**3)return {id,state:'download_budget_reached'};const url='https://firebasestorage.googleapis.com/v0/b/'+encodeURIComponent(a.bucket)+'/o/'+encodeURIComponent(a.object_path)+'?alt=media'+(token?'&token='+encodeURIComponent(token):'');let temp=new URL('originals/'+id+'.part',folder);
  try{const res=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(90000)});lastStatus=res.status;if(!res.ok){await res.body?.cancel();continue;}const claimed=Number(res.headers.get('content-length'));if(claimed>512*1024**2){await res.body.cancel();return {id,state:'size_limit',bytesExpected:claimed};}
   const stream=createWriteStream(temp,{mode:0o600}),h=createHash('sha256');let size=0;try{for await(const chunk of res.body){size+=chunk.length;if(size>512*1024**2)throw Error('SIZE_LIMIT');h.update(chunk);if(!stream.write(chunk))await once(stream,'drain');}stream.end();await once(stream,'finish');}catch(e){stream.destroy();await unlink(temp).catch(()=>{});throw e;}await rename(temp,file);usedBytes+=size;return await processFile(id,{originalBytes:size,originalSha256:h.digest('hex'),downloadAttempts:attempts,usedAlternativeLink:attempts>1});
  }catch(e){await unlink(temp).catch(()=>{});if(attempts===candidates.length)return {id,state:'request_failed',error:e.name,attempts,httpStatus:lastStatus};}
 }
 return {id,state:'unavailable',httpStatus:lastStatus,attempts,uses:[...(uses.get(id)||[])]};
}
let cursor=0;const ids=[...scope].filter(id=>cat.assets[id]);
await Promise.all(Array.from({length:3},async()=>{while(cursor<ids.length){const id=ids[cursor++];results.push(await retrieve(id));completed++;if(completed%40===0)console.log(JSON.stringify({completed,total:ids.length,recovered:results.filter(r=>['ready','media_ready','attachment_ready'].includes(r.state)).length}));}}));
const report={scope:'teaching course covers/maps/scenes and attached activity assets only; no chats or learner attachments',total:ids.length,newDownloadedBytes:usedBytes,results};await writeFile(new URL('course-assets-results.json',folder),JSON.stringify(report,null,2),{mode:0o600});const counts={};for(const r of results)counts[r.state]=(counts[r.state]||0)+1;console.log(JSON.stringify({total:ids.length,counts,newDownloadedBytes:usedBytes,withAlternativeLinks:results.filter(r=>r.usedAlternativeLink).length}));
