// Browser-only synthetic verification. Not included in the product bundle.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SafetyBoundary,downloadTeachingJSON} from './safety-boundary.jsx';
let saved={title:'尚未儲存的假教材內容'};
function Fragile({failed}){if(failed)throw Error('Synthetic view failure');return <p>全景測試區塊正常</p>;}
function Workspace(){
 const [title,setTitle]=useState(saved.title),[failed,setFailed]=useState(false),[fatal,setFatal]=useState(false),[key,setKey]=useState(0);
 if(fatal)throw Error('Synthetic workspace failure');
 return <><label>測試草稿名稱<input aria-label="測試草稿名稱" value={title} onChange={e=>{setTitle(e.target.value);saved={title:e.target.value};}}/></label><p>縮圖列表與其他設定仍可操作</p><button onClick={()=>setFailed(true)}>模擬全景元件例外</button><button onClick={()=>{setFailed(false);setKey(v=>v+1);}}>切換正常場景</button><button onClick={()=>setFatal(true)}>模擬工作區例外</button><SafetyBoundary scope="全景播放器" resetKey={key} onDownload={()=>downloadTeachingJSON(saved,'synthetic-draft.json')} onBack={()=>{setFailed(false);setKey(v=>v+1);}}><Fragile failed={failed}/></SafetyBoundary></>;
}
createRoot(document.getElementById('root')).render(<main className="content"><h1>錯誤隔離驗證（只有假資料）</h1><SafetyBoundary scope="教材工作區" workspace onDownload={()=>downloadTeachingJSON(saved,'synthetic-retained-draft.json')}><Workspace/></SafetyBoundary></main>);
