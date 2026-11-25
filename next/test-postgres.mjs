import {readFile,mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {pathToFileURL} from 'node:url';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
import {openPostgres} from './database.mjs';import {seed} from './fixtures.mjs';
import {createApp} from './app.mjs';import {createStudio} from './studio/backend.mjs';import {createMailDelivery} from './mail-delivery.mjs';
const config=JSON.parse(await readFile(process.env.WEBAVR_TEST_DATABASE_CONFIG,'utf8'));assert(/^webavr_test_[a-z0-9_]+_trial$/.test(config.database),'SYNTHETIC_DATABASE_REQUIRED');
const db=await openPostgres(config),folder=await mkdtemp(join(tmpdir(),'wa-native-auth-'));let delivery;
try{
 assert.equal((await db.query("SELECT 1 FROM pg_namespace WHERE nspname='webavr'")).rows.length,0,'NEW_DATABASE_REQUIRED');
 const {ids}=await seed(db,new URL('./schema/',import.meta.url));
 try{await db.transaction(async tx=>{await tx.query("UPDATE webavr.users SET display_name='rollback' WHERE id=$1",[ids.pending]);throw Error('probe');});}catch(e){assert.equal(e.message,'probe');}
 assert.notEqual((await db.query('SELECT display_name FROM webavr.users WHERE id=$1',[ids.pending])).rows[0].display_name,'rollback');
 await db.query("INSERT INTO auth_private.activation_approvals(id,user_id,approved_by,evidence_ref,reason) VALUES($1,$2,$3,'synthetic-evidence','synthetic acceptance only')",[randomUUID(),ids.pending,ids.admin]);
 delivery=await createMailDelivery(db,{mode:'private-test',mailboxDirectory:folder+'/mail'});
 const studio=await createStudio(db,{privateRoot:pathToFileURL(folder+'/'),tutorProvider:{configured:false},imageProvider:{configured:false}});
 const origin='http://localhost:4401',app=await createApp(db,{origin,secureCookies:false,mailer:delivery.enqueue,studio,authLimit:100,requestLimit:100});
 const post=(path,body,headers={})=>app.dispatch({method:'POST',path,body,headers:{origin,'content-type':'application/json',...headers}});
 await post('/api/auth/activation-request',{email:'pending@example.invalid'});
 assert.equal((await readdir(folder+'/mail')).length,0); // Enqueued, not synchronous SMTP.
 // Recreate adapter to verify jobs survive a worker restart.
 delivery.close();delivery=await createMailDelivery(db,{mode:'private-test',mailboxDirectory:folder+'/mail'});await delivery.tick();
 const mails=await readdir(folder+'/mail');assert.equal(mails.length,1);const mail=JSON.parse(await readFile(join(folder,'mail',mails[0]),'utf8'));
 const token=new URLSearchParams(new URL(mail.url).hash.slice(1)).get('token'),password='Only-synthetic-native-acceptance-123!';
 assert.equal((await post('/api/auth/activation-confirm',{token,password})).status,200);
 assert.equal((await post('/api/auth/activation-confirm',{token,password})).status,400);
 const login=await post('/api/auth/login',{email:'pending@example.invalid',password});assert.equal(login.status,200);
 const cookie=login.headers['set-cookie'].split(';')[0];assert(!cookie.includes(password));
 await post('/api/auth/password-reset-request',{email:'pending@example.invalid'});await delivery.tick();
 const files=await readdir(folder+'/mail'),reset=JSON.parse(await readFile(join(folder,'mail',files.find(f=>f!==mails[0])),'utf8'));
 const rt=new URLSearchParams(new URL(reset.url).hash.slice(1)).get('token');assert.equal((await post('/api/auth/password-reset-confirm',{token:rt,password:password+'2'})).status,200);
 assert.equal((await app.dispatch({path:'/api/auth/session',headers:{cookie}})).status,401);
 assert.equal((await post('/api/auth/login',{email:'pending@example.invalid',password})).status,401);
 assert.equal((await post('/api/auth/login',{email:'pending@example.invalid',password:password+'2'})).status,200);
 await post('/api/auth/activation-request',{email:'unresolved@example.invalid'});assert.equal(Number((await db.query("SELECT count(*) AS n FROM auth_private.tokens WHERE user_id=$1",[ids.unresolved])).rows[0].n),0);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM webavr.class_memberships WHERE user_id=$1 AND left_at IS NULL',[ids.studentS])).rows[0].n,2);
 console.log(JSON.stringify({passed:true,engine:'native-postgresql',transactionRollback:true,activation:true,oneUseToken:true,durableMailJob:true,passwordReset:true,oldSessionRevoked:true,unresolvedBlocked:true,multiClassPreserved:true}));
}finally{delivery?.close();await db.close();await rm(folder,{recursive:true,force:true});}
