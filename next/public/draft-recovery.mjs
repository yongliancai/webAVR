import {inspectCourse} from './course-schema.mjs';
// Teaching drafts only. No credentials, student records, or media bytes.
const PREFIX='webavr:teaching-recovery:v1:';
const TTL=7*24*60*60*1000;
const storage=()=>globalThis.localStorage;
export function createDraftRecovery({getStorage=storage,now=()=>Date.now(),tabId=globalThis.crypto.randomUUID()}={}){
 const key=(userId,courseId)=>PREFIX+userId+':'+courseId+':'+tabId;
 function entries(){const s=getStorage();return Array.from({length:s.length},(_,i)=>s.key(i)).filter(k=>k?.startsWith(PREFIX)&&!k.startsWith(PREFIX+'logout:'));}
 function valid(v){return v?.version===1&&typeof v.userId==='string'&&typeof v.courseId==='string'&&Number.isInteger(v.baseRevision)&&v.baseRevision>0&&Number.isFinite(v.updatedAt)&&v.updatedAt<=now()+60000&&now()-v.updatedAt<TTL&&v.document?.id===v.courseId&&typeof v.document==='object';}
 function prune(){const s=getStorage();for(const k of entries()){try{if(!valid(JSON.parse(s.getItem(k))))s.removeItem(k);}catch{s.removeItem(k);}}}
 function put(userId,document,baseRevision){const s=getStorage(),k=key(userId,document.id);prune();const value=JSON.stringify({version:1,userId,courseId:document.id,baseRevision,updatedAt:now(),document});s.setItem(k,value);return {key:k,value};}
 function find(userId,courseId){prune();const s=getStorage();return entries().map(k=>{const raw=s.getItem(k);return {key:k,value:raw,...JSON.parse(raw),validation:inspectCourse(JSON.parse(raw).document,{editing:true})};}).filter(v=>v.userId===userId&&v.courseId===courseId).sort((a,b)=>b.updatedAt-a.updatedAt);}
 function removeExact(entry){if(entry&&getStorage().getItem(entry.key)===entry.value)getStorage().removeItem(entry.key);}
 function removeOwn(userId,courseId){getStorage().removeItem(key(userId,courseId));}
 return {put,find,removeExact,removeOwn};
}
export function clearRecoveryForUser(userId,getStorage=storage){
 if(!userId)return;const s=getStorage(),prefix=PREFIX+userId+':';
 for(const k of Array.from({length:s.length},(_,i)=>s.key(i)))if(k?.startsWith(prefix))s.removeItem(k);
 // Other open editors stop repopulating copies after an explicit logout.
 s.setItem(PREFIX+'logout:'+userId,JSON.stringify({at:Date.now(),nonce:globalThis.crypto.randomUUID()}));
}
export const isRecoveryLogout=(key,userId)=>key===PREFIX+'logout:'+userId;
