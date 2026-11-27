import {useState,useEffect,useMemo} from 'react';
import {createLearningQueue} from './learning-queue.mjs';
export function useLearning({userId,lessonId,data,api}){
 const [progress,setProgress]=useState(data.progress),[sync,setSync]=useState({pending:0,error:'',durable:true,running:false});
 const queue=useMemo(()=>data.tracking?createLearningQueue({userId,lessonId,revision:data.revision,send:event=>api('/api/learn/courses/'+lessonId+'/events',event),onAck:result=>{if(result.revision===data.revision)setProgress(result.progress);}}):null,[userId,lessonId,data.revision,data.tracking]);
 useEffect(()=>{if(!queue)return;const off=queue.subscribe(setSync),online=()=>queue.flush(),before=e=>{if(queue.snapshot().pending){e.preventDefault();e.returnValue='';}};window.addEventListener('online',online);window.addEventListener('beforeunload',before);void queue.flush();return()=>{off();queue.dispose();window.removeEventListener('online',online);window.removeEventListener('beforeunload',before);};},[queue]);
 return {progress,sync,record:event=>queue?.enqueue(event),retry:()=>queue?.flush()};
}
