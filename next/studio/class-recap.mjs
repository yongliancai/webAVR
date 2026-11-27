// Deterministic recap from the same authorized, consistent report snapshot.
// No external model, private chats, or guessed reference answers.
export function buildClassRecap({className,selected,summary,learners,questions,scenes,asOf,lastRecordAt}){
 const current=learners.filter(p=>p.current),students=current.length,started=current.filter(p=>p.lastAt).length,completed=current.filter(p=>p.complete).length;
 const answered=questions.reduce((n,q)=>n+q.answered,0),correct=questions.reduce((n,q)=>n+q.correctCount,0),incorrect=questions.reduce((n,q)=>n+q.incorrectCount,0),ungraded=questions.reduce((n,q)=>n+q.ungradedCount,0),required=questions.filter(q=>q.ready),possibleAnswers=students*required.length;
 const sceneById=new Map(scenes.map(s=>[s.id,s]));
 const review=questions.filter(q=>q.incorrectCount>0).map(q=>({id:q.id,title:q.title,sceneId:q.sceneId,sceneTitle:sceneById.get(q.sceneId)?.title??'原場景',incorrect:q.incorrectCount,answered:q.answered,unanswered:Math.max(0,students-q.answered),commonChoices:Object.entries(q.distribution).filter(([key,n])=>key!==q.answerKey&&n>0).map(([key,n])=>({key,text:q.options[key],count:n})).sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key)),action:'回到對應場景，請學生說明觀察依據，再重新作答。'})).sort((a,b)=>b.incorrect-a.incorrect||a.id.localeCompare(b.id));
 const followUp=required.filter(q=>q.answered<students).map(q=>({id:q.id,title:q.title,sceneTitle:sceneById.get(q.sceneId)?.title??'原場景',missing:students-q.answered})).sort((a,b)=>b.missing-a.missing||a.id.localeCompare(b.id));
 const manualReview=questions.filter(q=>q.ungradedCount>0).map(q=>({id:q.id,title:q.title,answers:q.ungradedCount,sceneTitle:sceneById.get(q.sceneId)?.title??'原場景'}));
 const sceneGaps=scenes.map(s=>({id:s.id,title:s.title,opened:s.opened,unopened:Math.max(0,students-s.opened),startedUnopened:Math.max(0,started-s.opened)})).filter(s=>s.unopened>0).sort((a,b)=>b.startedUnopened-a.startedUnopened||b.unopened-a.unopened||a.id.localeCompare(b.id));
 const steps=[];if(students-started>0)steps.push({kind:'access',text:`先協助 ${students-started} 位尚無已儲存紀錄的學生確認登入、教材開放與連線；不要直接判定為未學習。`});
 if(review.length)steps.push({kind:'review',questionId:review[0].id,text:`優先回顧「${review[0].sceneTitle}」的「${review[0].title}」：${review[0].incorrect} 位學生最後儲存的答案答錯，帶領找線索後再作答。`});
 if(sceneGaps.some(s=>s.startedUnopened>0)){const s=sceneGaps.find(s=>s.startedUnopened>0);steps.push({kind:'scene',text:`安排補探索「${s.title}」；已開始的學生中，仍有 ${s.startedUnopened} 位沒有此場景的開啟紀錄。`});}
 if(followUp.length)steps.push({kind:'finish',questionId:followUp[0].id,text:`提醒完成「${followUp[0].title}」；目前 ${followUp[0].missing} 位學生尚無此題已儲存答案。`});
 if(manualReview.length)steps.push({kind:'manual',questionId:manualReview[0].id,text:`老師先查看「${manualReview[0].title}」的 ${manualReview[0].answers} 份未判分答案，再決定是否補充教學；未設定參考答案不算答錯。`});
 if(students&&started&&!review.length&&!followUp.length&&!sceneGaps.length&&!manualReview.length)steps.push({kind:'reflect',text:'目前已儲存紀錄沒有待補探索或未完成題目；可邀請學生口頭說明觀察依據，作為課後回顧。'});
 const overview=!students?'目前沒有有效在班學生，暫不形成全班學習結論。':!started?`目前 ${students} 位在班學生尚無本教材版本的已儲存紀錄，暫不能判斷學習狀況。`:`目前 ${students} 位在班學生中，${started} 位已有紀錄，${completed} 位完成本版本探索要求。${possibleAnswers?`已收到 ${answered}／${possibleAnswers} 份題目答案（每人每題最後儲存一份）。`:'此版本沒有可作答的選擇題。'}`;
 return {schemaVersion:1,className,lessonTitle:selected.title,lessonId:selected.id,revision:selected.revision,asOf,lastRecordAt:lastRecordAt??null,scope:'所選教材版本累積的已儲存紀錄；依查詢時有效在班學生計算',overview,counts:{students,started,completed,notStarted:students-started,incomplete:started-completed,answered,possibleAnswers,correct,incorrect,ungraded,graded:correct+incorrect,missingAnswers:Math.max(0,possibleAnswers-answered),pendingQuestions:summary.pendingQuestions,referenceMissing:required.filter(q=>!q.graded).length,historicalParticipants:learners.length-current.length},review,followUp,manualReview,sceneGaps,nextSteps:steps,notes:['已開啟場景不等於已理解內容，完成探索不代表全部答對。','答錯與選項分布依每位目前在班學生、每題最後儲存答案計算；完整提交紀錄仍保留。','未設定參考答案不自動判分；缺選項的題目不計入作答完成度。','尚未同步的瀏覽器紀錄無法計入；離線補送以伺服器接收時間呈現。','這是教材版本的累積小結，未推測為某一堂課、觀看時長或學習能力。']};
}
const line=s=>String(s??'').replace(/[\r\n]+/g,' ');
export function recapMarkdown(r){
 const out=['# 課後小結',`班級：${line(r.className)}`,`教材：${line(r.lessonTitle)}（修訂 ${r.revision}）`,`整理時間：${new Date(r.asOf).toISOString()}`,`資料範圍：${r.scope}`,'',r.overview,'','## 探索與作答',`- 在班學生 ${r.counts.students} 位；已開始 ${r.counts.started} 位；完成探索 ${r.counts.completed} 位。`,`- 最後儲存答案 ${r.counts.answered}／${r.counts.possibleAnswers} 份；答對 ${r.counts.correct}、答錯 ${r.counts.incorrect}、未判分 ${r.counts.ungraded}。`,'','## 答錯待複習'];
 if(!r.review.length)out.push('目前沒有已儲存且判為答錯的最後答案；未作答或未判分不代表答對。');
 for(const q of r.review){out.push(`- 「${line(q.title)}」／${line(q.sceneTitle)}：${q.incorrect} 位答錯，${q.unanswered} 位尚無答案。`);for(const c of q.commonChoices)out.push(`  - 作答選項 ${line(c.key)}「${line(c.text)}」：${c.count} 位。`);}
 out.push('','## 補探索與未完成');for(const s of r.sceneGaps)out.push(`- 「${line(s.title)}」：${s.opened}／${r.counts.students} 位有開啟紀錄；已開始者中 ${s.startedUnopened} 位尚無開啟紀錄。`);for(const q of r.followUp)out.push(`- 「${line(q.title)}」：${q.missing} 位尚無此題已儲存答案。`);if(!r.sceneGaps.length&&!r.followUp.length)out.push('目前沒有可列出的補探索或未完成題目。');
 out.push('','## 待老師查看');for(const q of r.manualReview)out.push(`- 「${line(q.title)}」：${q.answers} 份未判分答案，不能當作答錯。`);if(!r.manualReview.length)out.push('目前沒有已提交但未判分的答案。');
 out.push('','## 下一次引導');for(const s of r.nextSteps)out.push('- '+line(s.text));if(!r.nextSteps.length)out.push('目前資料不足，先確認班級名冊、教材開放與紀錄同步。');out.push('','## 判讀限制',...r.notes.map(n=>'- '+n),'','本小結未包含學生姓名或個別聊天內容；詳細作答請在具授課權限的班級概況查閱。');return out.join('\n')+'\n';
}
