import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import nodemailer from 'nodemailer';

// Pending jobs survive application restarts. Test delivery never accepts real addresses.
export async function createMailDelivery(db,{mode,smtp,from,mailboxDirectory,allowedRecipients,label='webAVR'}, {createTransport=options=>nodemailer.createTransport(options)}={}){
 if(!['smtp','private-test'].includes(mode))throw Error('MAIL_CONFIGURATION_REQUIRED');
 if(mode==='smtp'&&(!smtp?.host||!from||(smtp.secure!==true&&smtp.requireTLS!==true)))throw Error('SECURE_SMTP_REQUIRED');
 if(mode==='smtp'&&(smtp.ignoreTLS||smtp.opportunisticTLS||smtp.tls?.rejectUnauthorized===false))throw Error('SECURE_SMTP_REQUIRED');
 if(typeof label!=='string'||!label.trim()||label.length>80||/[\r\n]/.test(label))throw Error('INVALID_MAIL_LABEL');
 if(allowedRecipients!==undefined&&(!Array.isArray(allowedRecipients)||!allowedRecipients.length||!allowedRecipients.every(x=>typeof x==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))))throw Error('INVALID_MAIL_RECIPIENT_LIMIT');
 const recipients=allowedRecipients?new Set(allowedRecipients.map(x=>x.trim().toLowerCase())):null;
 const permitted=to=>typeof to==='string'&&(!recipients||recipients.has(to.trim().toLowerCase()))&&(mode!=='private-test'||to.endsWith('@example.invalid'));
 if(mode==='private-test'){if(!mailboxDirectory)throw Error('PRIVATE_MAILBOX_REQUIRED');await mkdir(mailboxDirectory,{recursive:true,mode:0o700});}
 const transport=mode==='smtp'?createTransport({...smtp,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true}):null;
 await db.exec(`CREATE TABLE IF NOT EXISTS auth_private.mail_jobs(
 id uuid PRIMARY KEY,token_hash text NOT NULL,recipient text NOT NULL,payload jsonb NOT NULL,
 attempts int NOT NULL DEFAULT 0,state text NOT NULL DEFAULT 'pending',next_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now());`);
 const digest=x=>createHash('sha256').update(x).digest('hex');
 async function enqueue(mail){
  if(!permitted(mail.to))throw Error('TEST_MAIL_RECIPIENT_RESTRICTED');
  const token=new URLSearchParams(new URL(mail.url).hash.slice(1)).get('token');if(!token)throw Error('MAIL_TOKEN_REQUIRED');
  await db.query('INSERT INTO auth_private.mail_jobs(id,token_hash,recipient,payload) VALUES($1,$2,$3,$4)',[randomUUID(),digest(token),mail.to,mail]);
 }
 let working=false;
 async function tick(){if(working)return;working=true;
  try{await db.transaction(async tx=>{
   const job=(await tx.query("SELECT * FROM auth_private.mail_jobs WHERE state='pending' AND next_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!job)return;
   // Recheck after restart: an older queued job must obey the current recipient policy.
   if(!permitted(job.recipient)){
    await tx.query('UPDATE auth_private.tokens SET revoked_at=now() WHERE token_hash=$1 AND consumed_at IS NULL',[job.token_hash]);
    await tx.query("UPDATE auth_private.mail_jobs SET state='failed',payload='{}',recipient='' WHERE id=$1",[job.id]);return;
   }
   const valid=(await tx.query('SELECT 1 FROM auth_private.tokens WHERE token_hash=$1 AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at>now()',[job.token_hash])).rows.length;
   if(!valid){await tx.query("UPDATE auth_private.mail_jobs SET state='obsolete',payload='{}',recipient='' WHERE id=$1",[job.id]);return;}
   try{
    if(transport)await transport.sendMail({from,to:job.recipient,subject:label+'｜'+(job.payload.purpose==='activate'?'啟用帳號':'設定或重設密碼'),text:label+'\n\n請於30分鐘內使用以下連結設定密碼；連結只能使用一次。\n設定後，請重新登入；這個環境原有的登入狀態會失效。\n若非本人申請，請忽略此信，不必採取任何動作。\n\n'+job.payload.url});
    else await writeFile(new URL(job.id+'.json',new URL('file://'+mailboxDirectory.replace(/\/$/,'')+'/')),JSON.stringify(job.payload),{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    await tx.query("UPDATE auth_private.mail_jobs SET state='sent',attempts=attempts+1,payload='{}',recipient='' WHERE id=$1",[job.id]);
   }catch{
    const final=job.attempts>=4;
    await tx.query("UPDATE auth_private.mail_jobs SET attempts=attempts+1,state=$2,next_at=now()+interval '1 minute' WHERE id=$1",[job.id,final?'failed':'pending']);
    if(final){await tx.query('UPDATE auth_private.tokens SET revoked_at=now() WHERE token_hash=$1 AND consumed_at IS NULL',[job.token_hash]);await tx.query("UPDATE auth_private.mail_jobs SET payload='{}',recipient='' WHERE id=$1",[job.id]);}
   }
  });}finally{working=false;}
 }
 return {enqueue,tick,async verify(){if(!transport)return {mode,ready:false};try{await transport.verify();return {mode,ready:true};}catch(e){const code=['EAUTH','EOAUTH2','ETLS','EDNS','ECONNECTION','ETIMEDOUT'].includes(e.code)?e.code:'SMTP_VERIFY_FAILED';throw Object.assign(Error(code),{code});}},close:()=>transport?.close()};
}
