import React,{useEffect,useRef,useState} from 'react';
export function InspectorPanel({open,title,onClose,blocked=false,contextKey,hint,children}){
 const node=useRef(null),[overlay,setOverlay]=useState(()=>matchMedia('(max-width:1100px)').matches);
 useEffect(()=>{const query=matchMedia('(max-width:1100px)'),change=()=>setOverlay(query.matches);query.addEventListener('change',change);return()=>query.removeEventListener('change',change);},[]);
 useEffect(()=>{
  if(!open)return;const element=node.current,previous=document.activeElement;
  if(overlay)element.showModal();else element.focus({preventScroll:true});
  return()=>{if(overlay)try{element.close();}catch{}if(previous?.isConnected&&previous.getClientRects().length)previous.focus({preventScroll:true});else document.querySelector('[data-inspector-trigger]')?.focus({preventScroll:true});};
 },[open,overlay]);
 useEffect(()=>{if(open)node.current?.querySelector('.inspector-body')?.scrollTo(0,0);},[open,contextKey]);
 if(!open)return null;const Tag=overlay?'dialog':'aside';
 return <Tag ref={node} className={'inspector-panel '+(overlay?'inspector-overlay':'inspector-inline')} aria-label={title} tabIndex={-1} onKeyDown={e=>{if(!overlay&&e.key==='Escape'&&!blocked){e.preventDefault();onClose();}}} onCancel={e=>{e.preventDefault();if(!blocked)onClose();}} onClick={e=>{if(overlay&&e.target===node.current&&!blocked){const r=node.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
  <header className="inspector-header"><h2>{title}</h2><button type="button" aria-label="關閉設定面板" disabled={blocked} onClick={onClose}>✕</button></header>
  <div className="inspector-body">{children}</div>
  <footer className="inspector-footer"><small>{blocked?'圖片仍在上傳，請先完成或取消。':(hint||'修改會保留，請記得儲存草稿。')}</small><button type="button" disabled={blocked} onClick={onClose}>收起面板，返回畫布</button></footer>
 </Tag>;
}
