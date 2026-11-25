import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import nodemailer from 'nodemailer';

// Pending jobs survive application restarts. Test delivery never accepts real addresses.
export async function createMailDelivery(db,{mode,smtp,from,mailboxDirectory}){
 if(!['smtp','private-test'].includes(mode))throw Error('MAIL_CONFIGURATION_REQUIRED');
 if(mode==='smtp'&&(!smtp?.host||!from||(!smtp.secure&&!smtp.requireTLS)))throw Error('SECURE_SMTP_REQUIRED');
 if(mode==='private-test'){if(!mailboxDirectory)throw Error('PRIVATE_MAILBOX_REQUIRED');await mkdir(mailboxDirectory,{recursive:true,mode:0o700});}
 const transport=mode==='smtp'?nodemailer.createTransport({...smtp,connectionTimeout:10000,socketTimeout:15000}):null;
 await db.exec(`CREATE TABLE IF NOT EXISTS auth_private.mail_jobs(
 id uuid PRIMARY KEY,token_hash text NOT NULL,recipient text NOT NULL,payload jsonb NOT NULL,
 attempts int NOT NULL DEFAULT 0,state text NOT NULL DEFAULT 'pending',next_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now());`);
 const digest=x=>createHash('sha256').update(x).digest('hex');
 async function enqueue(mail){
  if(mode==='private-test'&&!mail.to.endsWith('@example.invalid'))throw Error('TEST_MAIL_RECIPIENT_RESTRICTED');
  const token=new URLSearchParams(new URL(mail.url).hash.slice(1)).get('token');if(!token)throw Error('MAIL_TOKEN_REQUIRED');
  await db.query('INSERT INTO auth_private.mail_jobs(id,token_hash,recipient,payload) VALUES($1,$2,$3,$4)',[randomUUID(),digest(token),mail.to,mail]);
 }
 let working=false;
 async function tick(){if(working)return;working=true;
  try{await db.transaction(async tx=>{
   const job=(await tx.query("SELECT * FROM auth_private.mail_jobs WHERE state='pending' AND next_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!job)return;
   const valid=(await tx.query('SELECT 1 FROM auth_private.tokens WHERE token_hash=$1 AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at>now()',[job.token_hash])).rows.length;
   if(!valid){await tx.query("UPDATE auth_private.mail_jobs SET state='obsolete',payload='{}',recipient='' WHERE id=$1",[job.id]);return;}
   try{
    if(transport)await transport.sendMail({from,to:job.recipient,subject:'webAVR 帳號設定',text:'請於30分鐘內使用以下連結設定密碼。若非本人申請，請忽略。\n'+job.payload.url});
    else await writeFile(new URL(job.id+'.json',new URL('file://'+mailboxDirectory.replace(/\/$/,'')+'/')),JSON.stringify(job.payload),{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    await tx.query("UPDATE auth_private.mail_jobs SET state='sent',attempts=attempts+1,payload='{}',recipient='' WHERE id=$1",[job.id]);
   }catch{
    const final=job.attempts>=4;
    await tx.query("UPDATE auth_private.mail_jobs SET attempts=attempts+1,state=$2,next_at=now()+interval '1 minute' WHERE id=$1",[job.id,final?'failed':'pending']);
    if(final){await tx.query('UPDATE auth_private.tokens SET revoked_at=now() WHERE token_hash=$1 AND consumed_at IS NULL',[job.token_hash]);await tx.query("UPDATE auth_private.mail_jobs SET payload='{}',recipient='' WHERE id=$1",[job.id]);}
   }
  });}finally{working=false;}
 }
 return {enqueue,tick,close:()=>transport?.close()};
}
