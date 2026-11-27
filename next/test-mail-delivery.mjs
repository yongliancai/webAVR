import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';import {seed,TEST_PASSWORD} from './fixtures.mjs';
import {createMailDelivery} from './mail-delivery.mjs';import {createApp} from './app.mjs';
const db=new PGlite();await db.waitReady;let delivery;
try{
 const {ids}=await seed(db,new URL('./schema/',import.meta.url));
 const smtp={host:'smtp.example.invalid',secure:true,port:465,auth:{user:'synthetic',pass:'synthetic-secret'}},options={mode:'smtp',smtp,from:'webAVR <sender@example.invalid>',label:'webAVR 驗收',allowedRecipients:['students@example.invalid']};
 for(const overrides of [{smtp:{...smtp,tls:{rejectUnauthorized:false}}},{smtp:{...smtp,ignoreTLS:true}},{smtp:{...smtp,opportunisticTLS:true}},{allowedRecipients:[]},{label:'bad\r\nheader'}])await assert.rejects(createMailDelivery(db,{...options,...overrides}));
 let sent=[],failSend=false,failVerify=false,transportOptions;
 const createTransport=o=>{transportOptions=o;return {verify:async()=>{if(failVerify)throw Object.assign(Error('SYNTHETIC_SECRET'),{code:'EAUTH'});},sendMail:async m=>{if(failSend)throw Error('SYNTHETIC_SECRET');sent.push(m);},close(){}};};
 delivery=await createMailDelivery(db,options,{createTransport});assert.equal((await delivery.verify()).ready,true);assert.equal(transportOptions.debug,false);assert.equal(transportOptions.disableFileAccess,true);failVerify=true;await assert.rejects(delivery.verify(),e=>e.code==='EAUTH'&&!e.message.includes('SYNTHETIC_SECRET'));failVerify=false;
 const origin='http://localhost:4499',app=await createApp(db,{origin,secureCookies:false,mailer:delivery.enqueue,authLimit:100,requestLimit:100});
 const post=(path,body)=>app.dispatch({method:'POST',path,body,headers:{origin,'content-type':'application/json'}});
 const login=await post('/api/auth/login',{email:'students@example.invalid',password:TEST_PASSWORD});assert.equal(login.status,200);const cookie=login.headers['set-cookie'].split(';')[0];
 const request=()=>post('/api/auth/password-reset-request',{email:'students@example.invalid'}),token=m=>new URLSearchParams(new URL(m.text.split('\n').at(-1)).hash.slice(1)).get('token');
 assert.equal((await request()).status,202);assert.equal(sent.length,0);await delivery.tick();assert.equal(sent.length,1);assert(sent[0].subject.includes('webAVR 驗收'));assert(sent[0].subject.includes('重設密碼'));assert(sent[0].text.includes('30分鐘'));const first=token(sent[0]);
 const password='Synthetic-new-email-password-123!';assert.equal((await post('/api/auth/password-reset-confirm',{token:first,password})).status,200);assert.equal((await app.dispatch({path:'/api/auth/session',headers:{cookie}})).status,401);assert.equal((await post('/api/auth/password-reset-confirm',{token:first,password})).status,400);assert.equal((await post('/api/auth/login',{email:'students@example.invalid',password:TEST_PASSWORD})).status,401);assert.equal((await post('/api/auth/login',{email:'students@example.invalid',password})).status,200);
 failSend=true;await request();await delivery.tick();const pending=(await db.query("SELECT * FROM auth_private.mail_jobs WHERE state='pending'")).rows;assert.equal(pending.length,1);assert.equal(pending[0].attempts,1);assert(!JSON.stringify(pending).includes('SYNTHETIC_SECRET'));await db.query("UPDATE auth_private.mail_jobs SET next_at=now() WHERE state='pending'");delivery.close();delivery=await createMailDelivery(db,options,{createTransport});failSend=false;await delivery.tick();assert.equal(sent.length,2);
 failSend=true;await request();await db.query("UPDATE auth_private.mail_jobs SET attempts=4 WHERE state='pending'");await delivery.tick();const failed=(await db.query("SELECT * FROM auth_private.mail_jobs WHERE state='failed'")).rows[0];assert.equal(failed.attempts,5);assert.deepEqual(failed.payload,{});assert.equal(failed.recipient,'');assert((await db.query('SELECT revoked_at FROM auth_private.tokens WHERE token_hash=$1',[failed.token_hash])).rows[0].revoked_at);
 const mailCount=(await db.query('SELECT count(*)::int n FROM auth_private.mail_jobs')).rows[0].n;
 assert.equal((await post('/api/auth/password-reset-request',{email:'studentt@example.invalid'})).status,202);assert.equal((await db.query('SELECT count(*)::int n FROM auth_private.mail_jobs')).rows[0].n,mailCount);
 await assert.rejects(db.query("INSERT INTO webavr.users(id,display_name,email,state) VALUES($1,'Duplicate synthetic identity','students@example.invalid','pending_activation')",[randomUUID()]),e=>e.code==='23505');
 await request();const restrictedJob=(await db.query("SELECT id,token_hash FROM auth_private.mail_jobs WHERE state='pending'")).rows[0];const sentBefore=sent.length;delivery.close();
 delivery=await createMailDelivery(db,{...options,allowedRecipients:['other@example.invalid']},{createTransport});failSend=false;await delivery.tick();assert.equal(sent.length,sentBefore);
 const restricted=(await db.query('SELECT state,payload,recipient FROM auth_private.mail_jobs WHERE id=$1',[restrictedJob.id])).rows[0];assert.equal(restricted.state,'failed');assert.deepEqual(restricted.payload,{});assert.equal(restricted.recipient,'');assert((await db.query('SELECT revoked_at FROM auth_private.tokens WHERE token_hash=$1',[restrictedJob.token_hash])).rows[0].revoked_at);

 console.log('Mail checks passed: secure transport, verification redaction, recipient restriction, queued delivery/retry, terminal failure cleanup, one-use password reset, revoked sessions, re-login and database email uniqueness.');
}finally{delivery?.close();await db.close();}
