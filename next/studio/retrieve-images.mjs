// Explicitly approved scope: Firebase course cover, map, and scene images only.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const folder=new URL('../private-studio/source-media/',import.meta.url);
const inventory=JSON.parse(await readFile(new URL('inventory.json',folder),'utf8'));
await mkdir(new URL('originals/',folder),{recursive:true,mode:0o700});
await mkdir(new URL('ready/',folder),{recursive:true,mode:0o700});
let next=0,bytes=0,finished=0;const results=[];const originalLinks=new Map();const retryLarge=process.argv.includes('--retry-large');let previous=null;if(retryLarge){previous=JSON.parse(await readFile(new URL('retrieval-results.json',folder),'utf8'));bytes=previous.downloadedBytes;}
if(process.argv[2]){
 const original=await readFile(process.argv[2]);const catalog=JSON.parse(await readFile(new URL('../source-catalog.json',folder),'utf8'));
 if(createHash('sha256').update(original).digest('hex')!==catalog.snapshotSha256)throw Error('SOURCE_SNAPSHOT_MISMATCH');
 const approved=new Map(inventory.assets.map(a=>[a.bucket+'/'+a.object_path,a.id]));const stack=[JSON.parse(original)];
 while(stack.length){const v=stack.pop();if(Array.isArray(v))stack.push(...v);else if(v&&typeof v==='object'){for(const item of Object.values(v))stack.push(item);}else if(typeof v==='string'&&v.startsWith('https://firebasestorage.googleapis.com/')){try{const u=new URL(v),m=u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);if(!m||u.hostname!=='firebasestorage.googleapis.com'||u.port||u.username||u.password)continue;const aid=approved.get(decodeURIComponent(m[1])+'/'+decodeURIComponent(m[2]));const token=u.searchParams.get('token');if(aid&&token)originalLinks.set(aid,token);}catch{}}}
}

const digest=b=>createHash('sha256').update(b).digest('hex');
async function one(a){
 if(retryLarge){const old=previous.results.find(x=>x.id===a.id);if(old&&old.state!=='image_too_large')return old;}
 if(a.bucket!=='webavr-b9273.appspot.com')return {id:a.id,state:'unapproved_bucket'};
 if(bytes>=1536*1024*1024)return {id:a.id,state:'download_budget_reached'};
 const url='https://firebasestorage.googleapis.com/v0/b/'+encodeURIComponent(a.bucket)+'/o/'+encodeURIComponent(a.object_path)+'?alt=media'+(originalLinks.has(a.id)?'&token='+encodeURIComponent(originalLinks.get(a.id)):'');
 try{
  const res=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(!res.ok){let reason;const raw=await res.text();try{const j=JSON.parse(raw);const msg=j.error?.message;if(typeof msg==='string')reason=msg.replace(/https?:\/\/\S+/g,'[URL]').slice(0,220);}catch{}return {id:a.id,state:'unavailable',httpStatus:res.status,...(reason?{reason}:{})};}
  const len=Number(res.headers.get('content-length'));if(len>128000000){await res.body.cancel();return {id:a.id,state:'image_too_large'};}
  const parts=[];let size=0;for await(const part of res.body){size+=part.length;if(size>128000000){await res.body.cancel().catch(()=>{});throw Error('IMAGE_TOO_LARGE');}parts.push(part);}const binary=Buffer.concat(parts);bytes+=binary.length;
  const original=new URL('originals/'+a.id+'.bin',folder);await writeFile(original,binary,{mode:0o600});
  try{const image=sharp(binary,{limitInputPixels:50000000,animated:false});const meta=await image.metadata();if(!['png','jpeg','webp'].includes(meta.format)||meta.pages)throw Error('UNSUPPORTED_IMAGE');const decoded=await image.rotate().jpeg({quality:92}).toBuffer({resolveWithObject:true});await writeFile(new URL('ready/'+a.id+'.jpg',folder),decoded.data,{mode:0o600});return {id:a.id,state:'ready',width:decoded.info.width,height:decoded.info.height,originalBytes:size,originalSha256:digest(binary),derivativeSha256:digest(decoded.data)};}catch{return {id:a.id,state:'downloaded_needs_image_review',originalBytes:size,originalSha256:digest(binary)};}
 }catch(e){return {id:a.id,state:'request_failed',error:e.name==='TimeoutError'?'TIMEOUT':e.code??e.name};}
}
async function save(){const report={scope:inventory.scope,authentication:originalLinks.size?'original-per-object-download-links':'none',startedAt,completed:finished,total:inventory.assets.length,downloadedBytes:bytes,results};const tmp=new URL('retrieval-results.tmp',folder);await writeFile(tmp,JSON.stringify(report,null,2),{mode:0o600});await rename(tmp,new URL('retrieval-results.json',folder));}
const startedAt=new Date().toISOString();
await Promise.all(Array.from({length:4},async()=>{while(next<inventory.assets.length){const a=inventory.assets[next++];results.push(await one(a));finished++;if(finished%40===0)console.log(JSON.stringify({checked:finished,total:inventory.assets.length,ready:results.filter(r=>r.state==='ready').length}));}}));
await save();const statuses={};for(const r of results){const key=r.httpStatus?String(r.httpStatus):r.state;statuses[key]=(statuses[key]??0)+1;}
console.log(JSON.stringify({checked:finished,downloadedBytes:bytes,statuses,firstProviderReason:results.find(r=>r.reason)?.reason??null}));
