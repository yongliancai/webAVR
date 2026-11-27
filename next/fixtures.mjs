import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {hash,Algorithm} from '@node-rs/argon2';
export const TEST_PASSWORD='Synthetic-long-password-123!';
export async function seed(db,schemaDirectory){
 for(const name of ['webavr-schema-v1.sql','webavr-schema-v1.1-trial-adjustments.sql','webavr-schema-v1.2-api.sql'])await db.exec(await readFile(new URL(name,schemaDirectory),'utf8'));
 const ids={};const id=k=>ids[k]??=randomUUID();const q=(s,p=[])=>db.query(s,p);
 const passwordHash=await hash(TEST_PASSWORD,{algorithm:Algorithm.Argon2id,memoryCost:19456,timeCost:2,parallelism:1});
 const display={admin:'測試管理員',teacherA:'林老師',teacherB:'陳老師',formerTeacher:'已離任老師',studentS:'同學 S',studentT:'同學 T',outsider:'其他班同學',disabled:'停用的測試帳號',pending:'待啟用同學',unresolved:'待核實舊帳號',review:'需人工確認帳號'};
 for(const [name,role] of [['admin','admin'],['teacherA','teacher'],['teacherB','teacher'],['formerTeacher','teacher'],['studentS','student'],['studentT','student'],['outsider','student'],['disabled','student'],['pending',null],['unresolved',null],['review',null]]){
  const state=name==='disabled'?'disabled':name==='review'?'needs_review':role?'active':'pending_activation';
  await q('INSERT INTO webavr.users(id,display_name,email,state,email_verified_at) VALUES($1,$2,$3,$4,$5)',[id(name),display[name],name==='review'?null:name.toLowerCase()+'@example.invalid',state,role?'2025-01-01Z':null]);
  if(role){await q('INSERT INTO webavr.user_roles(user_id,role) VALUES($1,$2)',[id(name),role]);await q('INSERT INTO auth_private.credentials(user_id,password_hash) VALUES($1,$2)',[id(name),passwordHash]);}
 }
 for(const s of ['A','B']){
  await q('INSERT INTO webavr.classes(id,name,created_by) VALUES($1,$2,$3)',[id('class'+s),'文化探索 '+s+' 班',id('teacher'+s)]);
  await q('INSERT INTO webavr.courses(id,owner_id,title,state) VALUES($1,$2,$3,\'published\')',[id('course'+s),id('teacher'+s),'走讀文化・'+s+' 課程']);
  await q('INSERT INTO webavr.course_classes(id,course_id,class_id,linked_at) VALUES($1,$2,$3,\'2020-01-01Z\')',[id('cc'+s),id('course'+s),id('class'+s)]);
  for(const [name,role] of [['teacher'+s,'teacher'],['studentS','student'],...(s==='A'?[['studentT','student']]:[])]){
   await q('INSERT INTO webavr.class_memberships(id,class_id,user_id,member_role,joined_at) VALUES($1,$2,$3,$4,\'2020-01-01Z\')',[id('member'+name+s),id('class'+s),id(name),role]);
  }
  await q('INSERT INTO webavr.learning_sessions(id,course_id,class_id,created_by,started_at) VALUES($1,$2,$3,$4,\'2025-01-15Z\')',[id('session'+s),id('course'+s),id('class'+s),id('teacher'+s)]);
  for(const name of ['studentS',...(s==='A'?['studentT','outsider']:[])]){
   await q('INSERT INTO webavr.session_members(session_id,user_id,joined_at) VALUES($1,$2,\'2025-01-15Z\')',[id('session'+s),id(name)]);
   await q('INSERT INTO webavr.learning_events(id,session_id,user_id,event_type,occurred_at,request_id,payload) VALUES($1,$2,$3,\'view\',\'2025-01-15Z\',$4,$5)',[id('event'+name+s),id('session'+s),id(name),randomUUID(),{synthetic:true,activityLabel:s==='A'?'廟埕場景探索':'聚落街景觀察',note:'完成場景觀看，留下這次探索的足跡。'}]);
  }
 }
 await q("INSERT INTO webavr.class_memberships(id,class_id,user_id,member_role,joined_at,left_at) VALUES($1,$2,$3,'teacher','2020-01-01Z','2021-01-01Z')",[id('formerMembership'),id('classA'),id('formerTeacher')]);
 for(const name of ['private','supportA','supportB']){
  const s=name.at(-1);await q('INSERT INTO webavr.conversations(id,owner_id,course_id,class_id,scope,created_at) VALUES($1,$2,$3,$4,$5,\'2025-01-15Z\')',[id(name),id('studentS'),name==='private'?null:id('course'+s),name==='private'?null:id('class'+s),name==='private'?'private':'course_support']);
  await q("INSERT INTO webavr.messages(id,conversation_id,actor_id,role,content,request_id) VALUES($1,$2,$3,'user',$4,$5)",[id('message'+name),id(name),id('studentS'),name==='private'?'這是我的私人學習筆記，只有本人與明確成員可讀。':'我想了解這個場景的文化背景，可以從哪裡開始觀察？',randomUUID()]);
 }
 await q("INSERT INTO migration_private.runs(id,source_sha256,transformer_version,state) VALUES($1,$2,'synthetic-test','validated')",[id('run'),'a'.repeat(64)]);
 for(const [name,kind,disposition] of [['oldPrivate','legacy_message','archived'],['oldA','position_event','archived'],['oldB','position_event','archived'],['oldUnknown','position_event','archived'],['oldDuplicate','position_event','deduplicated'],['oldQuestion','question_definition','archived']]){
  await q("INSERT INTO migration_private.source_records(id,run_id,source_path,content_sha256,disposition,target_kind,target_id,reason) VALUES($1,$2,$3,$4,$5,'migration_private.archives',$6,'Synthetic source')",[id('source'+name),id('run'),'/synthetic/'+name,'b'.repeat(64),disposition,id(name==='oldDuplicate'?'oldA':name)]);
  await q("INSERT INTO migration_private.archives(id,source_record_id,subject_user_id,category,time_quality,legacy_time_text,redacted_payload,summary,attribution) VALUES($1,$2,$3,$4,'unknown','2025-01-15 08:00:00',$5,'Synthetic archive','unresolved')",[id(name),id('source'+name),id('studentS'),kind,{source_kind:kind,source_fragment:{synthetic:true,note:kind==='legacy_message'?'這是一筆尚未確認歸屬的私人對話。':kind==='question_definition'?'這是題目定義來源，僅限管理端查核。':'這是一筆舊觀看紀錄，時間尚未確認時區。'}},]);
 }
 await q("INSERT INTO migration_private.identity_map(id,source_record_id,legacy_subject,user_id,confidence) VALUES($1,$2,'synthetic-unresolved',$3,'unresolved')",[id('unresolvedMap'),id('sourceoldUnknown'),id('unresolved')]);
 return {ids,id,passwordHash};
}
