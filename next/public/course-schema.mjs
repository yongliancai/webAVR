// Shared, non-mutating teaching-document contract. Optional legacy data is kept.
export const courseId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
export function inspectCourse(document,{editing=false}={}){
 const issues=[];const add=(path,message)=>{if(issues.length<30)issues.push({path,message});};
 let nodes=0;const ancestors=new Set();
 function json(value,path,depth=0){
  if(++nodes>200000){add(path,'教材內容過多，請分成較小的課程。');return false;}
  if(depth>32){add(path,'教材資料層級過深。');return false;}
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number'){if(Number.isFinite(value))return true;add(path,'數字必須是有限值。');return false;}
  if(typeof value!=='object'||(!Array.isArray(value)&&!record(value))){add(path,'內容必須使用可保存的資料格式。');return false;}
  if(ancestors.has(value)){add(path,'教材不能含有循環引用。');return false;}
  ancestors.add(value);let valid=true;
  for(const key of Object.keys(value)){
   if(['__proto__','prototype','constructor'].includes(key)){add(path,'教材含有不支援的欄位名稱。');valid=false;break;}
   if(!json(value[key],path,depth+1)){valid=false;break;}
  }
  ancestors.delete(value);return valid;
 }
 if(!json(document,'document'))return {valid:false,issues};
 const bytes=new TextEncoder().encode(JSON.stringify(document)).length;
 if(bytes>1500000){add('document','教材內容超過可儲存上限。');return {valid:false,issues,tooLarge:true};}
 const obj=(v,path,label)=>{if(!record(v)){add(path,label+'必須是資料物件。');return false;}return true;};
 const text=(v,path,label,max=300,optional=false)=>{if(optional&&(v===undefined||v===null))return;if(typeof v!=='string'||v.length>max)add(path,label+'必須是文字，且不超過 '+max+' 字。');};
 const id=(v,path,label,optional=false)=>{if(optional&&(v===null||v===undefined))return;if(!courseId(v))add(path,label+'的識別碼格式不正確。');};
 const list=(v,path,label,max,optional=false)=>{if(optional&&v===undefined)return [];if(!Array.isArray(v)||v.length>max){add(path,label+'必須是清單，且不超過 '+max+' 項。');return [];}return v;};
 const coord=(v,path,label,min,max,optional=false)=>{if(v===null||optional&&v===undefined)return;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)add(path,label+'必須介於 '+min+' 與 '+max+'，或留空。');};
 const source=(v,path,label)=>{if(v===undefined||v===null)return;if(obj(v,path,label))text(v.sourcePath,path+'.sourcePath',label+'路徑',4000,true);};
 const assets=(v,path,label)=>{for(const k of ['assetId','packageAssetId'])id(v[k],path+'.'+k,label+'素材',true);};
 const seen=new Set();const unique=(v,path,label)=>{id(v,path,label);if(courseId(v)){if(seen.has(v))add(path,label+'的識別碼重複。');seen.add(v);}};
 if(!obj(document,'document','教材'))return {valid:false,issues};
 const d=document;
 id(d.id,'id','教材');text(d.title,'title','課程名稱');if(!editing&&typeof d.title==='string'&&!d.title.trim())add('title','請填寫課程名稱。');
 for(const k of ['description','goals'])text(d[k],k,k==='goals'?'教學目標':'課程說明',8000,true);
 for(const k of ['category','grade'])text(d[k],k,k==='grade'?'適用年級':'分類',300,true);
 for(const k of ['coverAssetId','coverPackageAssetId','sourceId'])id(d[k],k,'課程素材或來源',true);
 text(d.sourceOwnerId,'sourceOwnerId','來源作者',300,true);text(d.state,'state','課程狀態',100,true);source(d.source,'source','課程來源');
 if(d.assistant!=null&&obj(d.assistant,'assistant','課程助教')){const a=d.assistant;if(typeof a.enabled!=='boolean')add('assistant.enabled','請設定是否啟用課程助教。');text(a.name,'assistant.name','助教名稱',80,true);text(a.rules,'assistant.rules','教學規則',4000,true);if(a.answerStyle!==undefined&&!['guide','explain'].includes(a.answerStyle))add('assistant.answerStyle','請選擇提示引導或教材說明。');}
 if(d.legacySettings!==undefined&&d.legacySettings!==null)obj(d.legacySettings,'legacySettings','舊設定');
 const maps=list(d.maps,'maps','地圖',100),scenes=list(d.scenes,'scenes','場景',500),tours=list(d.tours,'tours','導覽',500,true);
 const sceneIds=new Set(scenes.filter(record).map(s=>s.id)),tourIds=new Set(tours.filter(record).map(t=>t.id));
 tours.forEach((t,i)=>{const p='tours.'+i,l='導覽 '+(i+1);if(!obj(t,p,l))return;unique(t.id,p+'.id',l);text(t.title,p+'.title',l+'名稱');});
 maps.forEach((m,i)=>{const p='maps.'+i,l='地圖 '+(i+1);if(!obj(m,p,l))return;unique(m.id,p+'.id',l);text(m.title,p+'.title',l+'名稱');assets(m,p,l);source(m.source,p+'.source',l+'來源');
  list(m.markers,p+'.markers',l+'標記',1000).forEach((a,j)=>{const q=p+'.markers.'+j,n=l+' 的標記 '+(j+1);if(!obj(a,q,n))return;unique(a.id,q+'.id',n);text(a.title,q+'.title',n+'標題');coord(a.x,q+'.x',n+'水平座標',0,1);coord(a.y,q+'.y',n+'垂直座標',0,1);id(a.targetSceneId,q+'.targetSceneId',n+'目標場景',true);if(!editing&&a.targetSceneId!=null&&!sceneIds.has(a.targetSceneId))add(q+'.targetSceneId',n+'指向不存在的場景。');
   for(const k of ['legacyX','legacyY'])coord(a[k],q+'.'+k,n+'舊座標',-1e9,1e9,true);
   if(a.tourIds!==undefined)list(a.tourIds,q+'.tourIds',n+'原導覽',500).forEach((v,k)=>id(v,q+'.tourIds.'+k,n+'原導覽'));
  });
 });
 scenes.forEach((s,i)=>{const p='scenes.'+i,l='場景 '+(i+1);if(!obj(s,p,l))return;unique(s.id,p+'.id',l);text(s.title,p+'.title',l+'名稱');assets(s,p,l);source(s.source,p+'.source',l+'來源');id(s.tourId,p+'.tourId',l+'導覽',true);if(!editing&&s.tourId!=null&&!tourIds.has(s.tourId))add(p+'.tourId',l+'指向不存在的導覽。');
  if(!['unknown','equirectangular'].includes(s.projection))add(p+'.projection',l+'的圖片投影格式不支援。');coord(s.pitch,p+'.pitch',l+'起始上下角度',-90,90,true);coord(s.yaw,p+'.yaw',l+'起始左右角度',-180,180,true);
  list(s.hotspots,p+'.hotspots',l+'活動',1000).forEach((h,j)=>{const q=p+'.hotspots.'+j,n=l+' 的活動 '+(j+1);if(!obj(h,q,n))return;unique(h.id,q+'.id',n);if(!['info','link','choice','explore','location','audio','video'].includes(h.kind))add(q+'.kind',n+'的功能類型不支援。');text(h.title,q+'.title',n+'標題');text(h.content,q+'.content',n+'內容',8000,true);coord(h.pitch,q+'.pitch',n+'上下角度',-90,90);coord(h.yaw,q+'.yaw',n+'左右角度',-180,180);source(h.source,q+'.source',n+'來源');
   if(h.assetIds!==undefined)list(h.assetIds,q+'.assetIds',n+'素材引用',1000).forEach((v,k)=>id(v,q+'.assetIds.'+k,n+'素材'));
   if(h.enabled!==undefined&&typeof h.enabled!=='boolean')add(q+'.enabled',n+'的啟用設定必須為是或否。');id(h.targetSceneId,q+'.targetSceneId',n+'目標場景',true);
   if(!editing&&h.kind==='link'&&h.enabled&&!sceneIds.has(h.targetSceneId))add(q+'.targetSceneId',n+'的傳送目標不存在。');
   if(h.payload!=null&&obj(h.payload,q+'.payload',n+'功能內容')){
    for(const k of ['cardName','hotspotToExplore'])text(h.payload[k],q+'.payload.'+k,n+'探索內容',8000,true);
    if(h.payload.grading!=null&&obj(h.payload.grading,q+'.payload.grading',n+'判分設定')){const g=h.payload.grading;if(h.kind!=='choice'||g.mode!=='single'||typeof g.answerKey!=='string'||!Object.hasOwn(h.payload.options??{},g.answerKey))add(q+'.payload.grading',n+'的參考答案必須是現有選項。');}
    if(h.payload.options!=null&&obj(h.payload.options,q+'.payload.options',n+'選項')){
     const options=Object.entries(h.payload.options);if(options.length>100)add(q+'.payload.options',n+'的選項超過 100 項。');
     for(const [key,v] of options.slice(0,100)){if(key.length>100)add(q+'.payload.options',n+'的選項名稱過長。');text(v,q+'.payload.options',n+'選項內容',8000);}
    }
   }
   if(h.legacy!=null&&obj(h.legacy,q+'.legacy',n+'舊資料')){
    text(h.legacy.locationName,q+'.legacy.locationName',n+'地標名稱',8000,true);text(h.legacy.externalVideo,q+'.legacy.externalVideo',n+'影片連結',4000,true);
    if(typeof h.legacy.externalVideo==='string')try{const u=new URL(h.legacy.externalVideo);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error();}catch{add(q+'.legacy.externalVideo',n+'的影片連結格式不安全或無效。');}
   }
  });
 });
 return {valid:issues.length===0,issues};
}
export function assertCourse(document){const result=inspectCourse(document);if(!result.valid)throw Object.assign(Error('INVALID_STUDIO_DATA'),{code:result.tooLarge?'DOCUMENT_TOO_LARGE':'INVALID_STUDIO_DATA',status:result.tooLarge?413:400,issues:result.issues});return document;}
export function courseSummary(document,fallbackId){
 const d=record(document)?document:{},maps=Array.isArray(d.maps)?d.maps.filter(record):[],scenes=Array.isArray(d.scenes)?d.scenes.filter(record):[];
 const string=(v,max=8000)=>typeof v==='string'?v.slice(0,max):'';
 return {id:fallbackId??d.id,title:string(d.title,300)||'格式待檢查的教材',category:string(d.category,300),description:string(d.description),coverAssetId:courseId(d.coverAssetId)?d.coverAssetId:null,sourceId:courseId(d.sourceId)?d.sourceId:null,maps:maps.length,scenes:scenes.length,hotspots:scenes.reduce((n,s)=>n+(Array.isArray(s.hotspots)?s.hotspots.length:0),0),missingImages:maps.filter(m=>!m.assetId).length+scenes.filter(s=>!s.assetId).length,invalid:!inspectCourse(document).valid||!!fallbackId&&d.id!==fallbackId};
}
