'use strict';
import {createSessionTransport} from './session-recovery.mjs';
import {clearRecoveryForUser} from './draft-recovery.mjs';
const root=document.querySelector('#root');
const state={user:null,csrf:'',audit:'',view:'home',classId:'',archiveMode:'self'};
let version=0,authEpoch=0,noticeTimer;
const messages={MAIL_UNAVAILABLE:'新版寄信尚未開放，請使用 Google 登入或進入舊版。',NETWORK:'連線未完成，請檢查網路後重試。',SESSION_CHANGED:'另一個分頁已切換帳號，請在新分頁登入原帳號後重試；本頁輸入仍保留。',SESSION_SYNC_FAILED:'暫時無法同步登入資訊，請稍後重試。',INVALID_EMAIL:'請填寫完整且有效的帳號信箱。',INVALID_LOGIN:'帳號或密碼不正確，或帳號尚未啟用。',UNAUTHENTICATED:'登入已失效，請重新登入。',FORBIDDEN:'你目前沒有執行這項操作的權限。',NOT_FOUND:'找不到此資料，或你沒有讀取權限。',RATE_LIMITED:'操作次數較多，請稍後再試。',BUSY:'系統正在處理其他請求，請稍後重試。',CSRF_DENIED:'登入連線再次更新，請稍後再試；本頁輸入仍保留。',INVALID_PASSWORD:'密碼需為 15–128 個字元，且不超過 512 bytes。',INVALID_TOKEN:'連結已使用、過期或失效，請重新申請。',IDENTITY_REVIEW_REQUIRED:'此帳號仍需核實身分，暫時無法啟用。',MEMBERSHIP_EXISTS:'這位成員已在班級內。',INVALID_FIELDS:'請確認輸入欄位後重試。',INVALID_TIME:'請填寫有效且明確的發生時間。',UNVERIFIED_CLASS_CONTEXT:'此時間的學生班級或課程關係無法核實，請重新確認。',CHAT_SCOPE_LOCKED:'私人對話不能改為班級學習紀錄。',ARCHIVE_TYPE_REQUIRES_SPECIAL_REVIEW:'此類來源需要另外處理，不能直接開放給學生。',REQUEST_ID_CONFLICT:'這項操作的內容已變更，請重新送出。'};
const label={student:'學生',teacher:'老師',admin:'管理員',active:'使用中',pending_activation:'待啟用',needs_review:'待核實',disabled:'已停用',archived:'已封存',private:'私人',course_support:'課程助理',legacy:'歷史',learning:'班級學習',verified:'已核准',withheld:'暫不開放'};
const categories={legacy_message:'舊對話',account_chatLog:'舊對話副本',modern_message:'對話紀錄',legacy_siraya_message:'文化學習對話',position_event:'觀看紀錄',account_userPositionLog:'觀看紀錄副本',legacy_click:'點擊紀錄',account_userClickHotSpot:'熱點探索',account_userClickButton:'操作紀錄',account_mutiAnswerLog:'作答紀錄',account_exploreLog:'探索紀錄',question_definition:'教材與題目來源'};
const chatKinds=new Set(['legacy_message','account_chatLog','modern_message','legacy_siraya_message']);
const learningKinds=new Set(['position_event','account_userPositionLog','legacy_click','account_userClickHotSpot','account_userClickButton','account_mutiAnswerLog','account_exploreLog']);
const isAdmin=()=>state.user?.roles.includes('admin');
const isTeacher=()=>state.user?.roles.includes('teacher');
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const append=(parent,...children)=>{parent.append(...children.filter(Boolean));return parent;};
const btn=(text,action,cls='button')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',action);return b;};
const tag=(text,variant='')=>el('span','tag '+variant,text);
const p=(text,cls='muted')=>el('p',cls,text);
const fmt=x=>x?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(x)):'尚未核實時間';
function toast(text){const n=document.querySelector('#notice');n.textContent=text;n.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{n.hidden=true;},4500);}
function brand(){const b=el('div','brand');append(b,el('span','brand-mark','WA'),append(el('div'),el('span','','webAVR'),el('small','','LEARNING STUDIO')));return b;}
function field(title,{type='text',required=true,placeholder='',options=null,value='',hint='',minLength=null,maxLength=null,autocomplete=null}={}){
 const wrapper=el('label','field');wrapper.append(el('span','',title));const input=el(options?'select':type==='textarea'?'textarea':'input');
 if(options){for(const [v,t] of options){const o=el('option','',t);o.value=v;input.append(o);}}else if(type!=='textarea')input.type=type;
 input.required=required;input.placeholder=placeholder;input.value=value;if(minLength!==null)input.minLength=minLength;if(maxLength!==null)input.maxLength=maxLength;if(autocomplete)input.autocomplete=autocomplete;
 wrapper.append(input);if(hint)wrapper.append(el('small','',hint));return {wrapper,input};
}
function formError(form,text){let n=form.querySelector('[data-form-error]');if(!n){n=el('div','error');n.dataset.formError='true';n.setAttribute('role','alert');form.prepend(n);}n.textContent=text;}
function onSubmit(form,action){form.addEventListener('submit',async event=>{
 event.preventDefault();if(form.dataset.busy)return;form.dataset.busy='true';const epoch=authEpoch;const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);form.querySelector('[data-form-error]')?.remove();
 try{await action();}catch(e){if(form.isConnected&&epoch===authEpoch)formError(form,messages[e.code]??'目前無法完成，請稍後重試。');}finally{delete form.dataset.busy;buttons.forEach(b=>b.disabled=false);}
});}
function submit(text){const b=el('button','button',text);b.type='submit';return b;}
const transport=createSessionTransport({getUserId:()=>state.user?.id,getToken:()=>state.csrf,setToken:value=>{state.csrf=value;},getContextVersion:()=>authEpoch});
async function api(path,{method='GET',body,headers={}}={}){
 const epoch=authEpoch;const all={...headers};if(state.audit&&isAdmin())all['X-Audit-Reason']='utf8:'+encodeURIComponent(state.audit);
 if(body!==undefined)all['Content-Type']='application/json';
 let result;try{result=await transport.request(path,{method,headers:all,body:body===undefined?undefined:JSON.stringify(body)});}catch(e){throw Object.assign(Error(e.code??'NETWORK'),{code:e.code??'NETWORK',status:e.status});}
 const {response,data}=result;if(!response.ok){const code=data.error?.code??'UNKNOWN';if(response.status===401&&state.user&&epoch===authEpoch){clearAuth();toast(messages.UNAUTHENTICATED);}throw Object.assign(Error(code),{code,status:response.status});}return data;
}
function clearAuth(){authEpoch++;version++;state.user=null;state.csrf='';state.audit='';state.classId='';state.archiveMode='self';history.replaceState(null,'','/');renderAuth();}
function empty(title,text){return append(el('div','empty'),el('div','empty-icon','◇'),el('strong','',title),p(text));}
function heading(target,title,description,action){const h=el('div','view-header');append(h,append(el('div'),el('h1','',title),p(description)),action);target.append(h);}
function panel(title){const box=el('section','panel');if(title)box.append(append(el('div','panel-title'),el('h2','',title)));return box;}
function more(target,cursor,action){if(cursor)target.append(append(el('div','more'),btn('載入更多',action,'button secondary')));}
function payloadText(item){const v=item.payload?.source_fragment??item.payload??{};if(typeof v==='string')return v;return v.note??v.message??v.content??v.questionName??(v.synthetic?'這是一筆用於驗證權限的測試紀錄。':'已保留紀錄內容，等待進一步整理。');}

function renderAuth(mode='login',recovery=null){
 version++;root.replaceChildren();const shell=el('div','auth');const story=el('section','auth-story');
 append(story,brand(),append(el('div'),el('h1','','把每一次探索，留成學習的軌跡。'),p('走進教材、連結課堂，讓老師與學生在同一個地方看見學習的發生。')),
  append(el('div','scene-art'),el('div','orbit'),el('div','orbit second'),append(el('div','art-window'),el('span','art-dot'))),el('div','story-foot','探索學習　／　班級連結　／　歷程保存'));
 const main=el('section','auth-main');append(shell,story,main);root.append(shell);main.append(el('div','eyebrow','A SPACE FOR LEARNING'));
 if(recovery){
  const activating=recovery.mode==='activate';main.append(el('h2','',activating?'設定你的新密碼':'重新設定密碼'));main.append(p('完成後請重新登入；原有的登入狀態將失效。','sub'));
  if(!recovery.token){main.append(empty('請從信件開啟連結','此頁沒有有效的設定連結，請回登入頁重新申請。'));main.append(btn('回登入頁',()=>{history.replaceState(null,'','/');renderAuth();},'button secondary full'));return;}
  const form=el('form');const pass=field('新密碼',{type:'password',autocomplete:'new-password',minLength:15,maxLength:128,hint:'請使用 15–128 個字元，建議採用容易記住的長句。'});const confirm=field('再次輸入新密碼',{type:'password',autocomplete:'new-password',minLength:15,maxLength:128});
  append(form,pass.wrapper,confirm.wrapper,submit('設定密碼'));
  onSubmit(form,async()=>{if(pass.input.value!==confirm.input.value){formError(form,'兩次輸入的密碼不相同。');return;}await api('/api/auth/'+(activating?'activation-confirm':'password-reset-confirm'),{method:'POST',body:{token:recovery.token,password:pass.input.value}});recovery.token='';form.reset();main.replaceChildren(el('h2','','密碼已更新'),p('請使用剛設定的密碼重新登入。','sub'),btn('前往登入',()=>{history.replaceState(null,'','/');renderAuth();},'button full'));});main.append(form);return;
 }
 const login=mode==='login';main.append(el('h2','',login?'歡迎回來':mode==='activate'?'啟用你的帳號':'設定或重設密碼'));
 main.append(p(login?'登入後，繼續你的學習與教學旅程。':mode==='activate'?'帳號經身分核准後，才能收到設定密碼的連結。':'輸入已核准帳號的信箱。Google 帳號也可在這裡設定 email 備用登入密碼。','sub'));
 const form=el('form');const address=field('帳號信箱',{type:'email',autocomplete:'username',placeholder:'name@example.com'});form.append(address.wrapper);
 let pass;if(login){pass=field('密碼',{type:'password',autocomplete:'current-password'});form.append(pass.wrapper);}
 const action=submit(login?'登入工作室':'申請設定連結');action.classList.add('full');form.append(action);main.append(form);
 onSubmit(form,async()=>{
  if(login){await api('/api/auth/login',{method:'POST',body:{email:address.input.value,password:pass.input.value}});pass.input.value='';const session=await api('/api/auth/session');state.user=session.user;state.csrf=session.csrfToken;authEpoch++;if(state.user.roles.includes('student')&&!isTeacher()&&!isAdmin()){location.assign('/learn');return;}navigate(isAdmin()?'users':'home');}
  else{await api('/api/auth/'+(mode==='activate'?'activation-request':'password-reset-request'),{method:'POST',body:{email:address.input.value}});form.replaceChildren(append(el('div','success'),el('strong','','已收到申請'),p('若帳號符合條件，會收到30分鐘內有效的設定連結，請同時檢查垃圾郵件。若未收到，請稍後再試或聯絡管理員確認身分。')));}
 });
 const links=el('div','links');if(login)append(links,btn('首次使用？啟用帳號',()=>renderAuth('activate'),'button ghost'),btn('忘記密碼',()=>renderAuth('reset'),'button ghost'));else links.append(btn('← 回到登入',()=>renderAuth(),'button ghost'));main.append(links);
 if(login){const authVersion=version,notice=new URLSearchParams(location.search).get('login');
  if(notice==='google_review')main.prepend(p('Google 身分驗證已完成；此帳號仍需核准連結，尚未開放教材與歷史資料。','sub'));
  if(notice==='google_failed')main.prepend(p('Google 登入未完成，請重新點選登入；也可使用 email 登入。','sub'));
  const help=el('details','demo-help');append(help,el('summary','','使用測試帳號體驗'),p('這些帳號只存在於此本機體驗版，不代表真實學生或老師。'));
  const switches=el('div','switches');for(const [name,title] of [['students','學生'],['teachera','老師'],['admin','管理員']])switches.append(btn(title,()=>{address.input.value=name+'@example.invalid';pass.input.value='Synthetic-long-password-123!';address.input.focus();},'button secondary small'));
  append(help,switches,p('選擇身分後按「登入工作室」。管理員敏感查詢須填寫用途。'));
  api('/api/auth/options').then(options=>{if(version!==authVersion||!main.isConnected)return;
   if(options.google){const link=el('a','button primary full','使用 Google 帳號登入');link.href='/api/auth/google/start';main.insertBefore(link,form);main.insertBefore(p('或使用 email 與密碼','sub'),form);}
   if(options.google&&options.emailRecovery!==false)links.prepend(btn('Google 帳號設定 email 備用密碼',()=>renderAuth('reset'),'button ghost'));
   if(options.emailRecovery===false){links.replaceChildren(p('新版 email 密碼設定尚未開放，請使用已核准的 Google 帳號。','sub'));}
   if(options.legacyUrl){const legacy=el('a','button secondary full','使用原有帳號與教材 → 舊版');legacy.href=options.legacyUrl;main.append(legacy);}
   if(options.demoAccounts===true)main.append(help);
  }).catch(()=>{});}
}

function navigate(view){state.view=view;version++;history.replaceState(null,'','/#'+view);renderShell();}
function renderShell(){
 const current=++version;root.replaceChildren();const shell=el('div','shell'),sidebar=el('aside','sidebar'),nav=el('nav','nav');nav.setAttribute('aria-label','主要導覽');
 sidebar.append(brand());const routes=[['home','⌂','工作室總覽'],['classes','▦','我的班級'],['history','◷','學習紀錄'],['archives','◇','歷史封存'],['conversations','☷','對話紀錄']];
 if(isAdmin())routes.push(['users','◉','帳號核准'],['review','▤','來源審核']);
 for(const [id,symbol,title] of routes){const b=btn('',()=>navigate(id),'');append(b,el('span','nav-symbol',symbol),el('span','',title));if(state.view===id){b.classList.add('active');b.setAttribute('aria-current','page');}nav.append(b);}
 {const learn=el('a','button secondary','360 探索教室 →');learn.href='/learn';nav.prepend(learn);}
 if(isTeacher()||isAdmin()){const overview=el('a','button secondary','班級學習概況 →');overview.href='/class-learning';nav.prepend(overview);const link=el('a','button secondary','教材編輯工作區 →');link.href='/studio';nav.prepend(link);}
 append(sidebar,nav,append(el('div','sidebar-note'),p('每個班級各自獨立。'),p('私人對話與尚未核實的舊紀錄，不會自動分享給授課老師。')));
 const workspace=el('div','workspace');const top=el('header','topbar');const role=state.user.roles.map(x=>label[x]??x).join('・')||'使用者';
 const account=el('div','account');append(account,el('span','avatar',state.user.name.slice(0,1)),append(el('div','account-info'),el('span','',state.user.name),el('small','',role)),btn('登出',async()=>{try{await api('/api/auth/logout',{method:'POST',body:{}});try{clearRecoveryForUser(state.user.id);}catch{}clearAuth();toast('已安全登出。');}catch(e){if(state.user)toast(messages[e.code]??'目前無法登出，請重試。');}},'button ghost'));
 append(top,el('span','breadcrumb','學習工作室 / '+(routes.find(x=>x[0]===state.view)?.[2]??'總覽')),account);workspace.append(top);const content=el('section');content.id='workspace-content';workspace.append(content);append(shell,sidebar,workspace);root.append(shell);
 if(isAdmin()&&!state.audit){heading(content,'先說明這次查詢的用途','管理員查閱帳號或來源時，系統會留下用途與稽核紀錄。');const box=panel('查詢用途');const f=el('form'),reason=field('用途說明',{type:'textarea',minLength:3,maxLength:500,placeholder:'例如：核對本機測試帳號與歷史資料歸屬'});append(f,reason.wrapper,submit('確認並進入管理畫面'));onSubmit(f,async()=>{state.audit=reason.input.value.trim();renderShell();});box.append(f);content.append(box);return;}
 if(isAdmin())content.append(append(el('div','audit-note'),el('span','','本次查詢用途：'+state.audit+'　'),btn('變更',()=>{state.audit='';renderShell();},'button ghost small')));
 const target=el('div');content.append(target);target.append(el('div','loading','正在讀取你的資料…'));
 const renderers={home:renderHome,classes:renderClasses,history:renderHistory,archives:renderArchives,conversations:renderConversations,users:renderUsers,review:renderReview};
 Promise.resolve((renderers[state.view]??renderHome)(target,current)).catch(e=>{if(current===version&&target.isConnected)target.replaceChildren(empty('暫時無法讀取',messages[e.code]??'連線發生問題，請稍後重新嘗試。'),btn('重新讀取',()=>renderShell(),'button secondary'));});
}
const alive=(target,current)=>current===version&&target.isConnected;
function eventRow(item){return append(el('article','record'),append(el('div','record-head'),el('h3','',item.payload?.activityLabel??'探索場景'),tag('學習紀錄')),p(item.payload?.note??'已記錄本次教材觀看與探索。'),el('div','record-meta',[item.learnerName,item.className,item.courseTitle,fmt(item.occurredAt)].filter(Boolean).join(' · ')));}
function archiveRow(item){return append(el('article','record'),append(el('div','record-head'),el('h3','',categories[item.category]??'歷史來源'),tag(item.review?.decision==='withheld'?'暫不開放':item.scope==='learning'?'班級學習':item.scope==='private'?'私人':'待核實',item.review?.decision==='withheld'||!item.scope?'amber':'')),p(payloadText(item)),el('div','record-meta',item.verifiedOccurredAt?'核實發生時間：'+fmt(item.verifiedOccurredAt):'舊時間：'+(item.legacyTimeText??'未提供')+'（未標示時區）'));}
async function renderHome(target,current){
 const [classes,historyData,archives]=await Promise.all([api('/api/me/classes'),api('/api/me/history?limit=50'),api('/api/me/archives?limit=50')]);if(!alive(target,current))return;target.replaceChildren();
 heading(target,'你好，'+state.user.name,'讓每次探索，都成為看得見的學習歷程。',tag('一起向前探索'));
 if(state.user.roles.includes('student')&&!isTeacher()&&!isAdmin()){const start=el('a','button','開始 360 探索 →');start.href='/learn';target.append(append(el('section','panel'),el('h2','','選一門課，走進場景'),p('用滑動縮圖選課，再點辨識點尋找線索。'),start));}
 const stats=el('div','stats');for(const [title,n,caption] of [['參與班級',classes.items.length,'目前有效的班級關係'],['學習紀錄',historyData.items.length,'這次載入的個人紀錄'],['已核實封存',archives.items.length,'本人可讀的歷史資料']])stats.append(append(el('div','stat'),el('div','stat-title',title),el('div','stat-value',n),el('div','stat-caption',caption)));target.append(stats);
 const columns=el('div','split'),recent=panel('最近載入的學習紀錄');if(historyData.items.length)historyData.items.slice(0,3).forEach(x=>recent.append(eventRow(x)));else recent.append(empty('每段旅程，從探索開始','目前沒有個人學習紀錄。老師可前往班級查看已授課的學生紀錄。'));recent.append(btn('查看學習紀錄 →',()=>navigate('history'),'button ghost'));
 const welcome=panel();welcome.classList.add('welcome-note');append(welcome,el('div','eyebrow','CONNECTED CLASSROOMS'),el('h2','','在自己的節奏裡探索，\n在共同的課堂裡相遇。'),p('你的班級、對話與歷史紀錄各有自己的存取範圍。你可以安心回顧，不會混入其他班級的私人內容。'),btn('查看我的班級',()=>navigate('classes'),'button secondary'));
 append(columns,recent,welcome);target.append(columns);
}
async function renderClasses(target,current){
 const data=await api(isAdmin()?'/api/admin/classes?limit=100':'/api/me/classes');if(!alive(target,current))return;target.replaceChildren();heading(target,isAdmin()?'班級管理':'我的班級','同一位學生可以參與多個班級，每個班級的權限分開處理。');
 if(isTeacher()||isAdmin()){
  const box=panel('建立班級'),f=el('form','inline-form'),name=field('班級名稱',{maxLength:200,placeholder:'例如：文化探索 A 班'});append(f,name.wrapper,submit('建立班級'));onSubmit(f,async()=>{await api('/api/classes',{method:'POST',body:{name:name.input.value}});toast('班級已建立。');renderShell();});box.append(f);target.append(box);
 }
 if(!data.items.length)target.append(empty('目前沒有班級','班級加入後會顯示在這裡；尚未核實的舊師生關係不會直接當成新班級。'));
 const grid=el('div','class-grid');for(const item of data.items){const box=el('article','class-card');append(box,el('div','class-symbol','▦'),el('h2','',item.name),p(isAdmin()?'管理員檢視':label[item.member_role]+'身分參與'));const foot=el('div','card-foot');foot.append(tag(item.state==='archived'?'已封存':'有效班級',item.state==='archived'?'gray':''));
  if(isTeacher()||isAdmin())foot.append(btn('查看班級',()=>showRoster(target,item),'button secondary small'));else foot.append(el('span','muted','紀錄會保留在個人歷程中'));box.append(foot);grid.append(box);}target.append(grid);
 if(data.nextCursor)target.append(p('此處先顯示 100 個班級，完整班級目錄的分頁將另行提供。'));
}
async function showRoster(target,item){
 const current=++version;target.replaceChildren(el('div','loading','正在讀取班級成員…'));
 try{const data=await api('/api/classes/'+item.id+'/members?limit=50');if(!alive(target,current))return;target.replaceChildren();heading(target,item.name,'僅限目前有效授課老師與管理員查閱。',btn('← 回班級列表',()=>navigate('classes'),'button secondary'));
  const box=panel('班級成員');const list=el('div');const memberRow=member=>append(el('article','record'),append(el('div','record-head'),el('h3','',member.name),tag(label[member.member_role])),el('div','record-meta',label[member.state]??member.state));for(const member of data.items)list.append(memberRow(member));if(!data.items.length)list.append(empty('尚未加入成員','可使用學生帳號信箱加入已啟用的學生。'));box.append(list);target.append(box);
  attachMore(box,list,data,'/api/classes/'+item.id+'/members',memberRow,current);
  if(item.state==='archived'){target.append(el('div','notice-bar','此班級已封存，不能再加入學生。'));return;}
  const add=panel('加入學生'),f=el('form','inline-form'),address=field('學生帳號信箱',{type:'email',placeholder:'學生已啟用的帳號信箱',hint:'只會加入已有學生資格的有效帳號，不建立新帳號。'});append(f,address.wrapper,submit('加入班級'));onSubmit(f,async()=>{await api('/api/classes/'+item.id+'/members',{method:'POST',body:{studentEmail:address.input.value,role:'student'}});toast('學生已加入此班級。');showRoster(target,item);});add.append(f);target.append(add);
 }catch(e){if(alive(target,current))target.replaceChildren(empty('無法讀取班級',messages[e.code]??'請重新嘗試。'),btn('回班級列表',()=>navigate('classes'),'button secondary'));}
}
async function classPicker(target,current,onSelect){
 const data=await api(isAdmin()?'/api/admin/classes?limit=100':'/api/me/classes');if(!alive(target,current))return null;
 const classes=data.items.filter(x=>isAdmin()||x.member_role==='teacher');if(!classes.length){target.append(empty('目前沒有可查閱的授課班級','老師只能查閱目前仍有效授課的班級。'));return null;}
 if(!classes.some(x=>x.id===state.classId))state.classId=classes[0].id;
 const choice=field('授課班級',{options:classes.map(x=>[x.id,x.name]),value:state.classId});choice.input.addEventListener('change',()=>{state.classId=choice.input.value;onSelect();});target.append(append(el('div','toolbar'),choice.wrapper));return state.classId;
}
async function renderHistory(target,current){
 target.replaceChildren();heading(target,'學習紀錄','依紀錄當時的班級與課程關係核對；時間以台灣時間顯示。');let path='/api/me/history';const recent=el('a','button secondary',isTeacher()||isAdmin()?'查看新 360 班級學習概況 →':'查看我的 360 探索進度與作答 →');recent.href=isTeacher()||isAdmin()?'/class-learning':'/learn';target.append(recent);
 if(isTeacher()||isAdmin()){const classId=await classPicker(target,current,()=>renderShell());if(!classId)return;path='/api/classes/'+classId+'/history';}
 const data=await api(path+'?limit=50');if(!alive(target,current))return;const box=panel('已授權的學習紀錄'),list=el('div');if(!data.items.length)list.append(empty('目前沒有可讀的學習紀錄','沒有紀錄不代表資料被刪除；未核實的舊資料仍保留在受限制的封存中。'));data.items.forEach(x=>list.append(eventRow(x)));box.append(list);target.append(box);attachMore(box,list,data,path,eventRow,current);
}
function attachMore(box,list,data,path,row,current){
 if(!data.nextCursor)return;const holder=el('div','more');const b=btn('載入更多',async()=>{b.disabled=true;try{const next=await api(path+(path.includes('?')?'&':'?')+'limit=50&after='+data.nextCursor);if(!alive(box,current))return;next.items.forEach(x=>list===box?list.insertBefore(row(x),holder):list.append(row(x)));data.nextCursor=next.nextCursor;if(!data.nextCursor)holder.remove();}catch(e){toast(messages[e.code]??'無法讀取下一頁。');}finally{b.disabled=false;}},'button secondary');holder.append(b);box.append(holder);
}
async function renderArchives(target,current){
 target.replaceChildren();heading(target,'歷史封存','只顯示已核實歸屬的歷史；未確認的資料保留，不自動公開。');let path='/api/me/archives';
 if(isTeacher()||isAdmin()){
  const tabs=el('div','switches');for(const [id,title] of [['self','個人封存'],['class','授課班級封存']])tabs.append(btn(title,()=>{state.archiveMode=id;renderShell();},state.archiveMode===id?'button small':'button secondary small'));target.append(tabs);
  if(state.archiveMode==='class'){const classId=await classPicker(target,current,()=>renderShell());if(!classId)return;path='/api/classes/'+classId+'/archives';}
 }
 const data=await api(path+'?limit=50');if(!alive(target,current))return;const box=panel('核實後的歷史'),list=el('div');if(!data.items.length)list.append(empty('目前沒有已核實的封存','原始資料仍保留；管理員確認身分與紀錄歸屬後，才會在這裡顯示。'));data.items.forEach(x=>list.append(archiveRow(x)));box.append(list);target.append(box);attachMore(box,list,data,path,archiveRow,current);
}
async function renderConversations(target,current){
 const data=await api('/api/conversations?limit=50');if(!alive(target,current))return;target.replaceChildren();heading(target,'對話紀錄','私人對話只供本人與有效成員查看；課程助理對話另依授課範圍授權。');const box=panel('可讀的對話'),list=el('div');
 const conversation=x=>{const r=el('article','record');append(r,append(el('div','record-head'),el('h3','',x.course_title??'個人對話'),tag(label[x.scope]??'歷史')),p([x.owner_name,x.class_name,fmt(x.created_at)].filter(Boolean).join(' · ')),btn('開啟對話',()=>openConversation(target,x),'button secondary small'));return r;};
 if(!data.items.length)list.append(empty('目前沒有可讀的對話','其他學生或班級的私人對話不會顯示在此。'));data.items.forEach(x=>list.append(conversation(x)));box.append(list);target.append(box);attachMore(box,list,data,'/api/conversations',conversation,current);
}
async function openConversation(target,item){
 const current=++version;target.replaceChildren(el('div','loading','正在讀取對話…'));
 try{const data=await api('/api/conversations/'+item.id+'/messages?limit=50');if(!alive(target,current))return;target.replaceChildren();heading(target,item.course_title??'個人對話',item.scope==='course_support'?'此課程助理對話可由符合授課範圍的老師查閱。':'此對話不會因老師資格而自動分享。',btn('← 返回列表',()=>navigate('conversations'),'button secondary'));
  const box=panel(),list=el('div');const message=x=>append(el('article','dialogue'),el('strong','',x.role==='user'?'學習者':x.role==='assistant'?'學習助理':'系統'),p(x.content),el('span','record-meta',fmt(x.created_at)));
  data.items.forEach(x=>list.append(message(x)));if(!data.items.length)list.append(empty('尚無訊息','此對話目前沒有已保存的訊息。'));box.append(list);target.append(box);attachMore(box,list,data,'/api/conversations/'+item.id+'/messages',message,current);
 }catch(e){if(alive(target,current))target.replaceChildren(empty('無法讀取對話',messages[e.code]??'請回列表重新選擇。'),btn('回到列表',()=>navigate('conversations'),'button secondary'));}
}
async function renderUsers(target,current){
 if(!isAdmin())throw {code:'FORBIDDEN'};target.replaceChildren();heading(target,'帳號核准','啟用核准與老師資格分開；有舊身分衝突的帳號不會直接啟用。');const search=field('搜尋帳號',{required:false,placeholder:'姓名或信箱'});const f=el('form','inline-form');append(f,search.wrapper,submit('搜尋'));target.append(f);const list=panel();target.append(list);let data;
 const row=u=>{
  const box=el('article','record');append(box,append(el('div','record-head'),el('h3','',u.name),tag(label[u.state]??u.state,u.state==='active'?'':'amber')),p(u.email??'此帳號沒有可使用的登入信箱'),el('div','record-meta',u.roles.map(x=>label[x]).join('・')||'尚未授予系統角色'));
  if(u.state==='pending_activation'&&!u.needs_identity_review&&!u.activation_approved){
   const form=el('form','review-form'),evidence=field('身分核實依據',{minLength:3,maxLength:300,placeholder:'例如：核對結果或內部核准紀錄編號'}),reason=field('核准說明',{minLength:3,maxLength:500});append(form,evidence.wrapper,reason.wrapper,submit('核准後允許申請啟用'));
   onSubmit(form,async()=>{await api('/api/admin/activation-approvals',{method:'POST',body:{userId:u.id,evidenceRef:evidence.input.value,reason:reason.input.value}});toast('已記錄核准；尚未寄信或授予老師資格。');renderShell();});box.append(form);
  }else if(u.needs_identity_review||u.state==='needs_review')box.append(p('請先處理舊身分對照，不能以收信或同名直接認領帳號。'));
  else if(u.activation_approved)box.append(tag('已核准，可自行申請啟用'));
  return box;
 };
 let searchVersion=0;const load=async()=>{const request=++searchVersion;data=await api('/api/admin/users?limit=50&q='+encodeURIComponent(search.input.value));if(!alive(target,current)||request!==searchVersion)return;list.replaceChildren();if(!data.items.length)list.append(empty('沒有符合的帳號','請換個姓名或信箱關鍵字。'));data.items.forEach(u=>list.append(row(u)));attachMore(list,list,data,'/api/admin/users?q='+encodeURIComponent(search.input.value),row,current);};
 onSubmit(f,load);await load();
}
async function renderReview(target,current){
 if(!isAdmin())throw {code:'FORBIDDEN'};const [data,users,classes]=await Promise.all([api('/api/admin/archives?limit=50'),api('/api/admin/users?limit=100'),api('/api/admin/classes?limit=100')]);if(!alive(target,current))return;target.replaceChildren();heading(target,'來源審核','先核對證據，再決定紀錄歸屬；不改寫原始來源，也不把未知時間當成事實。');target.append(el('div','notice-bar','私人聊天僅能核實為私人紀錄。教材、題目與群組外殼須另外處理，不能直接開放給學生。'));
 const list=panel('待確認與已保存來源');target.append(list);const people=users.items.filter(u=>u.state==='active'&&!u.needs_identity_review&&u.roles.includes('student'));
 const reviewCard=item=>{
  const row=archiveRow(item);const details=el('details','review-details');append(details,el('summary','','檢視來源內容（限管理員）'),el('pre','',JSON.stringify(item.payload,null,2)));row.append(details);
  const isChat=chatKinds.has(item.category),isLearning=learningKinds.has(item.category);if(!isChat&&!isLearning){row.append(p('此類來源不適用一般個人歷史核准流程。'));return row;}
  const form=el('form','review-form');const learner=field('紀錄所屬學生',{options:[['','請選擇已核實的學生'],...people.map(u=>[u.id,u.name+' · '+u.email])],value:item.review?.subjectUserId??''});
  const decision=field('處理決定',{options:[['verified','核實後開放'],['withheld','已知歸屬，但暫不開放']],value:item.review?.decision??'verified'});const grid=el('div','form-grid');append(grid,learner.wrapper,decision.wrapper);append(form,grid,p('歸屬或時間未知時，請保持未核准，不要猜測填寫。'));
  let classChoice,courseChoice,time;if(isLearning){classChoice=field('歷史班級',{options:[['','請選擇班級'],...classes.items.map(c=>[c.id,c.name])]});courseChoice=field('歷史課程',{options:[['','請先選擇班級']]});time=field('核實發生時間（台灣時間）',{type:'datetime-local',hint:'請依可驗證的證據填寫，不會自動採用未標時區的舊時間。'});
   classChoice.input.addEventListener('change',()=>{const c=classes.items.find(x=>x.id===classChoice.input.value);courseChoice.input.replaceChildren();for(const [v,t] of [['','請選擇課程'],...(c?.courses??[]).map(co=>[co.id,co.title])]){const o=el('option','',t);o.value=v;courseChoice.input.append(o);}});
   append(form,append(el('div','form-grid'),classChoice.wrapper,courseChoice.wrapper),time.wrapper);
  }
  if(isLearning&&item.review?.classId){classChoice.input.value=item.review.classId;classChoice.input.dispatchEvent(new Event('change'));courseChoice.input.value=item.review.courseId;time.input.value=new Date(Date.parse(item.review.occurredAt)+8*3600000).toISOString().slice(0,16);}
  let lastReviewBody='',requestId=crypto.randomUUID();const reason=field('核對依據與處理理由',{type:'textarea',minLength:3,maxLength:500,placeholder:'說明如何確認身分、上下文與時間，或為何暫不開放。'});append(form,reason.wrapper,submit('保存審核決定'));
  onSubmit(form,async()=>{
   let occurredAt=null;if(isLearning){const value=time.input.value;occurredAt=new Date(value+(value.length===16?':00':'')+'+08:00').toISOString();}
   const body={subjectUserId:learner.input.value,scope:isChat?'private':'learning',courseId:isLearning?courseChoice.input.value:null,classId:isLearning?classChoice.input.value:null,occurredAt,decision:decision.input.value,reason:reason.input.value};const fingerprint=JSON.stringify(body);if(lastReviewBody&&lastReviewBody!==fingerprint)requestId=crypto.randomUUID();lastReviewBody=fingerprint;
   await api('/api/admin/archives/'+item.id+'/reviews',{method:'POST',body:{...body,requestId}});
   toast('審核決定已保存；原始來源仍保留。');renderShell();
  });row.append(form);return row;
 };
 if(!data.items.length)list.append(empty('目前沒有來源','新匯入的歷史資料會出現在這裡。'));data.items.forEach(x=>list.append(reviewCard(x)));attachMore(list,list,data,'/api/admin/archives',reviewCard,current);
}

(async()=>{
 const purpose=location.pathname==='/activate'?'activate':location.pathname==='/reset'?'reset':null;
 if(purpose){const token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'',location.pathname);renderAuth('login',{mode:purpose,token});return;}
 try{const session=await api('/api/auth/session');state.user=session.user;state.csrf=session.csrfToken;authEpoch++;const view=location.hash.slice(1);navigate(['home','classes','history','archives','conversations','users','review'].includes(view)?view:'home');}catch{renderAuth();}
})();
