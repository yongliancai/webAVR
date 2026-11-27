import {randomUUID} from 'node:crypto';
import {assertCourse,courseId} from '../public/course-schema.mjs';
const need=(ok,code)=>{if(!ok)throw Error(code);};
const optionsKey=o=>JSON.stringify(Object.entries(o??{}).sort(([a],[b])=>a.localeCompare(b)));
// Maintenance only. No public endpoint and no publishing or historical regrading.
export async function applyReviewedAnswers(db,{userId,evidenceRef,questions},{dryRun=true}={}){
 need(courseId(userId)&&typeof evidenceRef==='string'&&evidenceRef.trim().length>=3&&evidenceRef.length<=300,'INVALID_APPROVAL');
 need(Array.isArray(questions)&&questions.length>0&&questions.length<=100,'INVALID_QUESTIONS');
 const seen=new Set();for(const q of questions){need(courseId(q.draftId)&&courseId(q.activityId)&&Number.isInteger(q.expectedRevision)&&q.expectedRevision>0&&typeof q.title==='string'&&q.options&&typeof q.options==='object'&&!Array.isArray(q.options)&&typeof q.answerKey==='string'&&Object.hasOwn(q.options,q.answerKey),'INVALID_QUESTION');const key=q.draftId+':'+q.activityId;need(!seen.has(key),'DUPLICATE_QUESTION');seen.add(key);}
 return db.transaction(async tx=>{
  need((await tx.query("SELECT 1 FROM webavr.users u JOIN webavr.user_roles r ON r.user_id=u.id WHERE u.id=$1 AND u.state='active' AND r.role='teacher' AND r.revoked_at IS NULL",[userId])).rows.length,'TEACHER_REQUIRED');
  const groups=new Map();for(const q of questions){if(!groups.has(q.draftId))groups.set(q.draftId,[]);groups.get(q.draftId).push(q);}
  const result=[];
  for(const [id,items] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
   const row=(await tx.query('SELECT * FROM studio.drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,userId])).rows[0];need(row,'DRAFT_NOT_OWNED');
   const doc=typeof row.document==='string'?JSON.parse(row.document):structuredClone(row.document);assertCourse(doc);
   need((await tx.query('SELECT 1 FROM studio.source_grants WHERE user_id=$1 AND course_id=$2 AND revoked_at IS NULL',[userId,doc.sourceId])).rows.length,'SOURCE_NOT_APPROVED');
   let changed=0;
   for(const q of items){
    const matches=doc.scenes.flatMap(s=>s.hotspots).filter(h=>h.id===q.activityId);need(matches.length===1,'QUESTION_NOT_UNIQUE');const h=matches[0];
    need(h.kind==='choice'&&h.title===q.title&&optionsKey(h.payload?.options)===optionsKey(q.options),'QUESTION_CHANGED');
    const staged=(await tx.query('SELECT answer_payload FROM auth_private.question_keys WHERE activity_id=$1 ORDER BY version DESC LIMIT 1',[q.activityId])).rows[0];need(staged?.answer_payload?.correctAnswer===q.answerKey,'STAGED_KEY_MISMATCH');
    if(h.payload.grading!=null){need(h.payload.grading.mode==='single'&&h.payload.grading.answerKey===q.answerKey,'EXISTING_GRADING_CONFLICT');continue;}
    need(row.revision===q.expectedRevision,'REVISION_CONFLICT');h.payload.grading={mode:'single',answerKey:q.answerKey};changed++;
   }
   assertCourse(doc);
   if(changed&&!dryRun){
    const saved=await tx.query('UPDATE studio.drafts SET document=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND owner_id=$3 AND revision=$4 RETURNING revision',[doc,id,userId,row.revision]);need(saved.rows.length===1,'REVISION_CONFLICT');
    await tx.query('INSERT INTO studio.revisions(draft_id,revision,document) VALUES($1,$2,$3)',[id,saved.rows[0].revision,doc]);
    await tx.query("INSERT INTO auth_private.audit_events(id,actor_id,action,target_kind,target_id,outcome,reason,request_id) VALUES($1,$2,'studio.reviewed_answers','draft',$3,'allowed',$4,$5)",[randomUUID(),userId,id,'Explicit answer approval: '+evidenceRef,randomUUID()]);
   }
   result.push({id,fromRevision:row.revision,toRevision:row.revision+(changed?1:0),questionsChanged:changed});
  }
  return {dryRun,drafts:result,questionsChanged:result.reduce((n,r)=>n+r.questionsChanged,0),published:false,historicalRegrading:false};
 });
}
