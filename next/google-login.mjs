import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
const random=()=>randomBytes(32).toString('base64url');
const digest=x=>createHash('sha256').update(x).digest('hex');
const sha256=x=>createHash('sha256').update(x).digest('base64url');
const reject=code=>{throw Object.assign(Error(code),{code});};

export async function createGoogleLogin(db,config,{origin,secureCookies,clientFactory}={}){
 if(!config)return null;
 if(!config.clientId||!config.clientSecret||config.redirectUri!==origin+'/api/auth/google/callback')throw Error('INVALID_GOOGLE_CONFIG');
 const client=clientFactory?clientFactory():new OAuth2Client(config.clientId,config.clientSecret,config.redirectUri);
 const name=secureCookies?'__Host-webavr_google':'webavr_google_trial';
 const cookie=(v,age)=>`${name}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secureCookies?'; Secure':''}`;
 await db.exec(`CREATE TABLE IF NOT EXISTS auth_private.google_states(
 state_hash text PRIMARY KEY,browser_hash text NOT NULL,nonce text NOT NULL,verifier text NOT NULL,expires_at timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS auth_private.google_bindings(
 subject text PRIMARY KEY,user_id uuid NOT NULL UNIQUE REFERENCES webavr.users(id),evidence_ref text NOT NULL,linked_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS auth_private.google_requests(
 subject text PRIMARY KEY,email text NOT NULL,display_name text NOT NULL,seen_at timestamptz NOT NULL DEFAULT now());`);
 async function start(){
  const state=random(),browser=random(),nonce=random(),verifier=random();
  await db.query('DELETE FROM auth_private.google_states WHERE expires_at<now()');
  await db.query("INSERT INTO auth_private.google_states VALUES($1,$2,$3,$4,now()+interval '10 minutes')",[digest(state),digest(browser),nonce,verifier]);
  const location=client.generateAuthUrl({scope:['openid','email','profile'],state,nonce,code_challenge:sha256(verifier),code_challenge_method:'S256',access_type:'online',prompt:'select_account'});
  return {status:303,headers:{location,'set-cookie':cookie(browser,600)},body:{status:'redirect'}};
 }
 async function callback(url,headers){
  try{
   const state=url.searchParams.get('state'),code=url.searchParams.get('code');
   if(url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||!state||!code||state.length>100||code.length>1500)reject('GOOGLE_STATE_INVALID');
   const cookies=(headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));if(cookies.length!==1)reject('GOOGLE_STATE_INVALID');
   const browser=cookies[0].slice(name.length+1);if(!/^[A-Za-z0-9_-]{43}$/.test(browser))reject('GOOGLE_STATE_INVALID');
   const consumed=(await db.query('DELETE FROM auth_private.google_states WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING nonce,verifier',[digest(state),digest(browser)])).rows[0];if(!consumed)reject('GOOGLE_STATE_INVALID');
   const {tokens}=await client.getToken({code,codeVerifier:consumed.verifier});if(!tokens.id_token)reject('GOOGLE_TOKEN_INVALID');
   const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:config.clientId}),p=ticket.getPayload();
   if(!p||p.nonce!==consumed.nonce||p.email_verified!==true||typeof p.sub!=='string'||!p.sub||p.sub.length>255||typeof p.email!=='string'||p.email.length>254)reject('GOOGLE_TOKEN_INVALID');
   const raw=random();let approved=false;
   await db.transaction(async tx=>{
    const u=(await tx.query(`SELECT u.* FROM auth_private.google_bindings b JOIN webavr.users u ON u.id=b.user_id WHERE b.subject=$1 FOR UPDATE OF u`,[p.sub])).rows[0];
    // Never use a matching email to link a legacy user or grant a teaching role.
    if(!u){await tx.query('INSERT INTO auth_private.google_requests(subject,email,display_name) VALUES($1,$2,$3) ON CONFLICT(subject) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,seen_at=now()',[p.sub,p.email,(p.name||'Google 使用者').slice(0,200)]);return;}
    const unresolved=(await tx.query("SELECT 1 FROM migration_private.identity_map WHERE user_id=$1 AND confidence<>'verified' LIMIT 1",[u.id])).rows.length;
    if(u.state!=='active'||unresolved)return;
    await tx.query("INSERT INTO auth_private.sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[randomUUID(),u.id,digest(raw)]);
    await tx.query("INSERT INTO auth_private.audit_events(id,actor_id,action,target_kind,target_id,outcome,reason,request_id) VALUES($1,$2,'auth.google_login','user',$2,'allowed','Verified Google subject and approved account binding.',$3)",[randomUUID(),u.id,randomUUID()]);approved=true;
   });
   return {status:303,headers:{location:approved?'/':'/?login=google_review','set-cookie':cookie('',0)},body:{status:approved?'authenticated':'review_required'},sessionRaw:approved?raw:null};
  }catch{return {status:303,headers:{location:'/?login=google_failed','set-cookie':cookie('',0)},body:{status:'google_failed'}};}
 }
 return {start,callback};
}
