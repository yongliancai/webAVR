import {createSessionTransport} from '../public/session-recovery.mjs';
const error=code=>Object.assign(Error(code),{code});
export function xhrRequest(path,init,{onProgress=()=>{},makeXHR=()=>new XMLHttpRequest(),timeout=180000}={}){
 return new Promise((resolve,reject)=>{
  if(init.signal?.aborted){reject(error('UPLOAD_CANCELLED'));return;}
  const xhr=makeXHR();let settled=false;const abort=()=>xhr.abort();
  const finish=(fn,value)=>{if(settled)return;settled=true;init.signal?.removeEventListener('abort',abort);fn(value);};
  xhr.upload.onprogress=e=>{if(!settled&&e.lengthComputable)onProgress(Math.min(100,Math.round(e.loaded/e.total*100)));};
  xhr.upload.onload=()=>{if(!settled)onProgress(100);};
  xhr.onload=()=>{try{finish(resolve,new Response(xhr.responseText,{status:xhr.status,headers:{'content-type':'application/json'}}));}catch{finish(reject,error('NETWORK'));}};
  xhr.onerror=()=>finish(reject,error('NETWORK'));xhr.ontimeout=()=>finish(reject,error('TIMEOUT'));xhr.onabort=()=>finish(reject,error('UPLOAD_CANCELLED'));
  try{
  xhr.open(init.method??'POST',path,true);xhr.withCredentials=true;xhr.timeout=timeout;
  for(const [key,value] of new Headers(init.headers))xhr.setRequestHeader(key,value);
  init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted){xhr.abort();finish(reject,error('UPLOAD_CANCELLED'));return;}
  xhr.send(init.body);
  }catch{finish(reject,error('NETWORK'));}
 });
}
export async function uploadImage({file,operationId,api,getUserId,getToken,setToken,signal,onState=()=>{},makeXHR,digest=bytes=>crypto.subtle.digest('SHA-256',bytes),fetchImpl=(...args)=>fetch(...args)}){
 const active=()=>{if(signal.aborted)throw error('UPLOAD_CANCELLED');};active();onState({phase:'preparing',percent:0});
 const hash=[...new Uint8Array(await digest(await file.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');active();
 const prepared=await api('/api/studio/uploads',{id:operationId,name:file.name,size:file.size,mime:['image/jpeg','image/png','image/webp'].includes(file.type)?file.type:'application/octet-stream',sha256:hash},{signal});active();
 if(prepared.completed)return prepared.media;
 const transport=createSessionTransport({getUserId,getToken,setToken,fetchImpl:(path,init)=>path==='/api/auth/session'?fetchImpl(path,init):xhrRequest(path,init,{makeXHR,onProgress:percent=>{if(!signal.aborted)onState({phase:percent===100?'processing':'uploading',percent});}})});
 onState({phase:'uploading',percent:0});
 const {response,data}=await transport.request('/api/studio/uploads/'+operationId+'/content',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file,signal});active();
 if(!response.ok)throw Object.assign(Error(data.error?.code??'UPLOAD_FAILED'),{code:data.error?.code??'UPLOAD_FAILED'});
 if(!data?.id||!Number.isInteger(data.width)||!Number.isInteger(data.height))throw error('UPLOAD_FAILED');
 return data;
}
