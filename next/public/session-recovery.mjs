// Recover a rejected request once, only while it still belongs to the same user.
export function createSessionTransport({getUserId,getToken,setToken,getContextVersion=()=>0,fetchImpl=(...args)=>fetch(...args),refreshTimeoutMs=20000}){
 let refreshInFlight=null;
 const error=(code,status)=>Object.assign(new Error(code),{code,status});
 async function refresh(){
  if(!refreshInFlight){
   refreshInFlight=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),refreshTimeoutMs);
    try{
    const response=await fetchImpl('/api/auth/session',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
    const data=await response.json();
    if(!response.ok)throw error(data.error?.code??'SESSION_SYNC_FAILED',response.status);
    if(!data.user?.id||typeof data.csrfToken!=='string'||!data.csrfToken)throw error('SESSION_SYNC_FAILED',response.status);
    return data;
    }finally{clearTimeout(timer);}
   })().finally(()=>{refreshInFlight=null;});
  }
  return refreshInFlight;
 }
 async function request(path,init={}){
  const expectedUser=getUserId(),context=getContextVersion(),method=(init.method??'GET').toUpperCase();
  async function send(){
   const headers=new Headers(init.headers);
   if(method==='POST'&&getToken())headers.set('X-CSRF-Token',getToken());
   const response=await fetchImpl(path,{...init,method,headers,credentials:'same-origin'});
   return {response,data:await response.json()};
  }
  let result=await send();
  // The server checks CSRF before executing protected actions. Other failures
  // and successful requests must never be replayed automatically.
  if(method==='POST'&&expectedUser&&result.response.status===403&&result.data.error?.code==='CSRF_DENIED'){
   const session=await refresh();
   if(getUserId()!==expectedUser||getContextVersion()!==context||session.user.id!==expectedUser)throw error('SESSION_CHANGED',409);
   setToken(session.csrfToken);
   result=await send();
  }
  return result;
 }
 return {request};
}
