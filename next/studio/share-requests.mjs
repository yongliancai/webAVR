// Reconcile uncertain publication without blindly repeating the write.
const invalid=()=>Object.assign(Error('Invalid class publication response'),{code:'INVALID_SHARE_RESPONSE'});
export async function readCourseShares(api,courseId){const result=await api('/api/studio/courses/'+courseId+'/class-lessons');if(!Array.isArray(result?.items))throw invalid();return result.items;}
export function matchingShare(items,{classId,revision,active}){const row=items.find(s=>s.class_id===classId);return active?(row?.active===true&&row.revision===revision?row:null):(!row?.active?{id:row?.id??null,active:false}:null);}
export async function provideCourse({api,courseId,classId,revision,active}){
 let acknowledged=false,acknowledgedId=null,writeError;
 try{const result=await api('/api/studio/courses/'+courseId+'/class-lessons',{classId,revision,active});if(active){if(result?.status!=='shared'||result.revision!==revision||typeof result.id!=='string')throw invalid();acknowledgedId=result.id;}else if(result?.status!=='withdrawn')throw invalid();acknowledged=true;}catch(e){if(!['NETWORK','TIMEOUT','INVALID_SHARE_RESPONSE','INVALID_RESPONSE'].includes(e.code)&&!(e.status>=500))throw e;writeError=e;}
 let shares;try{shares=await readCourseShares(api,courseId);}catch{shares=null;}
 const match=shares?matchingShare(shares,{classId,revision,active}):null;
 return {confirmed:acknowledged||!!match,recovered:!acknowledged&&!!match,acknowledged,lessonId:match?.id??acknowledgedId,shares,uncertain:!acknowledged&&!match,errorCode:writeError?.code??null};
}
