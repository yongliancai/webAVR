import React from 'react';
export function downloadTeachingJSON(value,name='webavr-teaching-backup.json'){
 const data=JSON.stringify(value,null,2),url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export class SafetyBoundary extends React.Component{
 state={failed:false,attempt:0};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(){console.warn('[webAVR] isolated view failure');}
 componentDidUpdate(previous){if(previous.resetKey!==this.props.resetKey&&this.state.failed)this.reset();}
 reset=()=>this.setState(s=>({failed:false,attempt:s.attempt+1}));
 render(){
  if(!this.state.failed)return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  return <section className="card view-fallback" role="alert" aria-label={this.props.scope+'錯誤隔離'}><h2>{this.props.scope}暫時無法顯示</h2><p>這個區塊發生問題，沒有因此刪除教材或覆寫已儲存內容。可先下載草稿備份，再重試或返回。</p><div className="actions"><button onClick={this.reset}>重試此區塊</button>{this.props.onBack&&<button onClick={this.props.onBack}>{this.props.backLabel||'返回教材設定'}</button>}{this.props.onDownload&&(!this.props.canDownload||this.props.canDownload())&&<button onClick={this.props.onDownload}>下載保留的草稿</button>}{this.props.workspace&&<button onClick={this.reset}>回到教材列表</button>}</div></section>;
 }
}
