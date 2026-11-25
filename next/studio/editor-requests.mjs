// Read requests may supersede one another; writes must never replay blindly.
export function createReadGate(){
 let generation=0;
 return {begin(){const id=++generation;return ()=>id===generation;},invalidate(){generation++;}};
}
export function sameCourseContent(left,right){
 const normalize=(value,top=false)=>{
  if(Array.isArray(value))return value.map(v=>normalize(v));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>!top||!['source','sourceOwnerId'].includes(k)).map(k=>[k,normalize(value[k])]));
  return value;
 };
 return JSON.stringify(normalize(left,true))===JSON.stringify(normalize(right,true));
}
export async function saveThenRefresh({persist,onSaved,refresh,onRefreshError}){
 const result=await persist();
 onSaved(result);
 try{await refresh();}catch(error){onRefreshError(error);}
 return result;
}
