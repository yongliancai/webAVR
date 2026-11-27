import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';import {applyReviewedAnswers} from './deploy/apply-reviewed-answers.mjs';
const db=new PGlite();await db.waitReady;let passed=0;const ok=(v,n)=>{assert.ok(v,n);passed++;console.log('PASS '+n);};
try{
 await db.exec(`CREATE SCHEMA webavr;CREATE SCHEMA studio;CREATE SCHEMA auth_private;
 CREATE TABLE webavr.users(id uuid PRIMARY KEY,state text);CREATE TABLE webavr.user_roles(user_id uuid,role text,revoked_at timestamptz);
 CREATE TABLE studio.source_grants(user_id uuid,course_id uuid,revoked_at timestamptz);
 CREATE TABLE studio.drafts(id uuid PRIMARY KEY,owner_id uuid,revision int,document jsonb,updated_at timestamptz DEFAULT now());CREATE TABLE studio.revisions(draft_id uuid,revision int,document jsonb,PRIMARY KEY(draft_id,revision));
 CREATE TABLE auth_private.question_keys(activity_id uuid,version int,answer_payload jsonb);
 CREATE TABLE auth_private.audit_events(id uuid,actor_id uuid,action text,target_kind text,target_id uuid,outcome text,reason text,request_id uuid);
 CREATE TABLE studio.lesson_versions(lesson_id uuid,revision int,document jsonb);CREATE TABLE studio.learning_events(id uuid,correct boolean,document jsonb);`);
 const owner=randomUUID(),other=randomUUID(),source=randomUUID(),scene=randomUUID(),q1=randomUUID(),q2=randomUUID(),d1=randomUUID(),d2=randomUUID();
 await db.query("INSERT INTO webavr.users VALUES($1,'active'),($2,'active')",[owner,other]);await db.query("INSERT INTO webavr.user_roles VALUES($1,'teacher',NULL),($2,'teacher',NULL)",[owner,other]);await db.query('INSERT INTO studio.source_grants VALUES($1,$2,NULL)',[owner,source]);
 const doc=id=>({id,title:'Synthetic course',description:'Original content',sourceId:source,coverAssetId:null,maps:[],tours:[],scenes:[{id:scene,title:'Original scene',assetId:null,projection:'equirectangular',hotspots:[{id:id===d1?q1:q2,kind:'choice',title:'Original question',content:'Original hint',pitch:0,yaw:0,payload:{options:{A:'one',B:'two'}}}]}]});
 for(const id of [d1,d2]){await db.query('INSERT INTO studio.drafts(id,owner_id,revision,document) VALUES($1,$2,1,$3)',[id,owner,doc(id)]);await db.query('INSERT INTO studio.revisions VALUES($1,1,$2)',[id,doc(id)]);}
 await db.query('INSERT INTO auth_private.question_keys VALUES($1,1,$3),($2,1,$3)',[q1,q2,{correctAnswer:'B'}]);await db.query('INSERT INTO studio.lesson_versions VALUES($1,1,$2)',[randomUUID(),doc(d1)]);await db.query('INSERT INTO studio.learning_events VALUES($1,NULL,$2)',[randomUUID(),{answer:'B',revision:1}]);
 const get=async()=> (await db.query('SELECT document,revision FROM studio.drafts WHERE id=$1',[d1])).rows[0];
 const historical=JSON.stringify((await db.query('SELECT * FROM studio.lesson_versions')).rows)+JSON.stringify((await db.query('SELECT * FROM studio.learning_events')).rows);
 const question=(draftId,activityId)=>({draftId,activityId,expectedRevision:1,title:'Original question',options:{A:'one',B:'two'},answerKey:'B'}),approval={userId:owner,evidenceRef:'synthetic explicit approval',questions:[question(d1,q1),question(d2,q2)]};
 ok((await applyReviewedAnswers(db,approval)).questionsChanged===2&&(await get()).revision===1,'dry run validates without changing drafts');
 await assert.rejects(applyReviewedAnswers(db,{...approval,userId:other},{dryRun:false}),/DRAFT_NOT_OWNED/);ok((await get()).revision===1,'another teacher cannot approve owned drafts');
 await assert.rejects(applyReviewedAnswers(db,{...approval,questions:[approval.questions[0],{...approval.questions[1],expectedRevision:9}]},{dryRun:false}),/REVISION_CONFLICT/);ok((await get()).revision===1&&(await db.query('SELECT * FROM auth_private.audit_events')).rows.length===0,'later conflict rolls back earlier revision and audit');
 await assert.rejects(applyReviewedAnswers(db,{...approval,questions:[{...approval.questions[0],answerKey:'A'}]},{dryRun:false}),/STAGED_KEY_MISMATCH/);passed++;
 await assert.rejects(applyReviewedAnswers(db,{...approval,questions:[{...approval.questions[0],options:{A:'changed',B:'two'}}]},{dryRun:false}),/QUESTION_CHANGED/);passed++;
 await assert.rejects(applyReviewedAnswers(db,{...approval,questions:[approval.questions[0],approval.questions[0]]},{dryRun:false}),/DUPLICATE_QUESTION/);passed++;
 const applied=await applyReviewedAnswers(db,approval,{dryRun:false});ok(applied.questionsChanged===2&&(await get()).revision===2,'approved keys create new draft revisions');
 const now=(await get()).document;const expected=doc(d1);expected.scenes[0].hotspots[0].payload.grading={mode:'single',answerKey:'B'};assert.deepEqual(now,expected);passed++;
 ok((await db.query('SELECT document FROM studio.revisions WHERE draft_id=$1 AND revision=1',[d1])).rows[0].document.scenes[0].hotspots[0].payload.grading===undefined,'original draft snapshot remains unchanged');
 const retry=await applyReviewedAnswers(db,approval,{dryRun:false});ok(retry.questionsChanged===0&&(await get()).revision===2,'retry does not create duplicate revisions');
 ok(historical===JSON.stringify((await db.query('SELECT * FROM studio.lesson_versions')).rows)+JSON.stringify((await db.query('SELECT * FROM studio.learning_events')).rows),'published snapshots and submitted answers are untouched');
 await db.query('UPDATE studio.source_grants SET revoked_at=now()');await assert.rejects(applyReviewedAnswers(db,approval,{dryRun:false}),/SOURCE_NOT_APPROVED/);passed++;
 console.log(JSON.stringify({passed}));
}finally{await db.close()}
