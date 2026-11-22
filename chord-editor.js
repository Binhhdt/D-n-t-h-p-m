const cDisplay=code=>chordName(code,CS.shift,cFlat(),CS.simple);
const cFlat=()=>keyUsesFlat(chordPc(CS.res.key.tonic+CS.shift),CS.res.key.minor);
function cEvents(r=CS.res){
  if(r.events)return r.events;
  return r.beats.flatMap((t,i)=>i&&r.chord[i]===r.chord[i-1]?[]:[{id:'b'+i,t,c:r.chord[i]}]);
}
function cBars(r=CS.res){
  const events=cEvents(r),grid=r.beats.filter((_,i)=>i===0||(i>=r.down&&(i-r.down)%r.meter===0));
  if(events.length&&events[0].t<grid[0]-0.02)grid.unshift(events[0].t);
  let k=0,active=NO_CHORD;
  return grid.map((t,i)=>{
    while(k<events.length&&events[k].t<=t+0.02){active=events[k].c;k++;}
    const chords=[active],end=i+1<grid.length?grid[i+1]:Infinity;
    while(k<events.length&&events[k].t<end-0.02){
      active=events[k++].c;
      if(active!==chords[chords.length-1])chords.push(active);
    }
    return {t,chords};
  });
}
function cTimeline(){
  const box=$('cTimeline'),events=cEvents(),scroll=box.scrollLeft;
  box.textContent='';
  for(const [i,event] of events.entries()){
    const button=document.createElement('button'),time=document.createElement('span'),label=document.createElement('b');
    time.textContent=fmtT(event.t);label.textContent=cDisplay(event.c);
    button.className='chordPart';button.append(time,label);
    const end=i+1<events.length?events[i+1].t:CS.buf.duration;
    button.style.minWidth=Math.min(220,Math.max(76,(end-event.t)*52))+'px';
    button.title=event.manual?'Đã sửa':event.confidence==null?'Sửa hợp âm':'Độ tin cậy '+event.confidence+'%';
    button.onclick=()=>cOpenEditor(event);
    box.append(button);
  }
  box.scrollLeft=scroll;
  $('cSimple').checked=CS.simple;
  $('cComparison').hidden=!CS.comparison;
  if(CS.comparison){
    $('cSource').value=CS.source;
    if($('cComparison').open)cCompare();
  }
}
function cCompare(){
  const leftResult=CS.source==='original'?CS.res:CS.comparison.other;
  const rightResult=CS.source==='instrumental'?CS.res:CS.comparison.other;
  const original=cEvents(leftResult),instrumental=cEvents(rightResult);
  const candidates=[...new Set([0,...original.map(e=>e.t),...instrumental.map(e=>e.t)])].sort((a,b)=>a-b);
  // Small detector timing differences are shown at the same comparison position.
  const times=candidates.filter((t,i)=>i===0||t-candidates[i-1]>0.12);
  const body=$('cCompareRows'),frag=document.createDocumentFragment();
  let a=0,b=0;
  for(const t of times){
    while(a+1<original.length&&original[a+1].t<=t+0.12)a++;
    while(b+1<instrumental.length&&instrumental[b+1].t<=t+0.12)b++;
    const one=original[a]&&original[a].t<=t+0.12?original[a]:null;
    const two=instrumental[b]&&instrumental[b].t<=t+0.12?instrumental[b]:null;
    const row=document.createElement('tr');
    const text=(e,r)=>{
      if(!e)return '–';
      const flat=keyUsesFlat(chordPc(r.key.tonic+CS.shift),r.key.minor);
      return chordName(e.c,CS.shift,flat,CS.simple)+(e.manual?' · Đã sửa':e.confidence==null?'':' · '+e.confidence+'%');
    };
    for(const value of [fmtT(t),text(one,leftResult),text(two,rightResult)]){
      const cell=document.createElement('td');cell.textContent=value;row.append(cell);
    }
    frag.append(row);
  }
  body.textContent='';body.append(frag);
  $('cCompareNote').textContent='Số ô nhịp · Bài gốc '+cBars(leftResult).length+' · Nhạc nền '+cBars(rightResult).length;
}
function cChangeSource(source){
  if(!CS.comparison||source===CS.source||!['original','instrumental'].includes(source))return;
  cRememberLyricEdits();
  const {other}=CS.comparison;
  CS.comparison.other=CS.res;CS.res=other;
  [CS.style,CS.comparison.otherStyle]=[CS.comparison.otherStyle,CS.style];
  CS.source=source;
  cRefreshLyrics();cRender();
  cStatus(source==='original'?'Đang dùng hợp âm từ bài gốc. File phát là nhạc nền.':'Đang dùng hợp âm từ nhạc nền.');
}

let cEditing=null,cReturnFocus=null,cEditCounter=0;
const cOption=(value,label)=>new Option(label,String(value));
function cEditorSelect(code){
  const {root,quality,bass}=chordParts(code);
  $('cEditRoot').value=code===NO_CHORD?'none':String(root);
  $('cEditQuality').value=String(quality?quality.id:0);
  $('cEditBass').value=bass===null?'none':bass;
  cEditorOptions();
}
function cEditorOptions(){
  const none=$('cEditRoot').value==='none';
  $('cEditQuality').disabled=none;$('cEditBass').disabled=none;
  const root=Number($('cEditRoot').value),quality=CHORD_QUALITIES.find(q=>q.id===Number($('cEditQuality').value));
  const valid=new Set(quality.notes.slice(1).map(n=>chordPc(root+n)));
  for(const option of $('cEditBass').options)option.disabled=option.value!=='none'&&!valid.has(Number(option.value));
  const selected=$('cEditBass').selectedOptions[0];
  if(selected&&selected.disabled)$('cEditBass').value='none';
}
function cOpenEditor(event=null){
  cEditing=event;cReturnFocus=document.activeElement;
  if(cSrc){cPaused=cTime();cStop();}
  const roots=(cFlat()?FLAT:NAMES);
  const names=NAMES.map((_,i)=>cOption(i,roots[chordPc(i+CS.shift)]));
  for(const id of ['cEditRoot','cEditQuality','cEditBass'])$(id).textContent='';
  $('cEditRoot').append(cOption('none','Không có hợp âm'),...names);
  $('cEditQuality').append(...CHORD_QUALITIES.map(q=>cOption(q.id,q.suffix||'Trưởng')));
  $('cEditBass').append(cOption('none','Theo nốt gốc'),...names.map(o=>o.cloneNode(true)));
  cEditorSelect(event?event.c:0);
  $('cEditTime').max=Math.max(0,CS.buf.duration-0.01).toFixed(2);
  $('cEditTime').value=Math.min(Number($('cEditTime').max),event?event.t:cTime()).toFixed(2);
  $('cEditTitle').textContent=event?'Sửa hợp âm':'Thêm hợp âm';
  $('cEditRemove').hidden=!event;$('cEditMessage').textContent='';
  const alternatives=$('cAlternatives');alternatives.textContent='';
  for(const candidate of (event&&event.alternatives)||[]){
    const button=document.createElement('button');button.type='button';
    button.textContent=chordName(candidate.c,CS.shift,cFlat())+' · '+candidate.confidence+'%';
    button.onclick=()=>cEditorSelect(candidate.c);alternatives.append(button);
  }
  $('cAltLabel').hidden=!alternatives.children.length;
  $('cEditConfidence').textContent=event&&event.manual?'Đã sửa thủ công':!event||event.confidence==null?'':'Độ tin cậy ước tính '+event.confidence+'%';
  $('cEditor').hidden=false;$('cEditRoot').focus();
}
function cCloseEditor(){
  $('cEditor').hidden=true;
  if(cReturnFocus&&cReturnFocus.isConnected)cReturnFocus.focus();
  cEditing=null;cReturnFocus=null;
}
function cEditCommit(remove){
  const input=$('cEditTime'),time=input.valueAsNumber;
  if(!remove&&(!Number.isFinite(time)||time<0||time>=CS.buf.duration)){
    $('cEditMessage').textContent='Nhập số giây trong thời lượng bài hát.';return;
  }
  const root=$('cEditRoot').value,bass=$('cEditBass').value;
  const q=CHORD_QUALITIES.find(quality=>quality.id===Number($('cEditQuality').value));
  const code=root==='none'?NO_CHORD:chordCode(Number(root),q,bass==='none'?null:Number(bass));
  const events=cEvents().filter(e=>!cEditing||e.id!==cEditing.id);
  if(!remove&&events.some(e=>Math.abs(e.t-time)<0.01)){
    $('cEditMessage').textContent='Đã có hợp âm ở thời điểm này. Hãy chọn thời điểm khác.';return;
  }
  cRememberLyricEdits();
  if(!remove){
    const entry={id:cEditing?cEditing.id:'m'+Date.now()+'-'+(++cEditCounter),t:time,c:code,manual:true};
    if(cEditing&&cEditing.alternatives)entry.alternatives=cEditing.alternatives.filter(e=>e.c!==code);
    events.push(entry);
  }
  CS.res.events=events.sort((a,b)=>a.t-b.t);
  cCloseEditor();cRefreshLyrics();cRender();
  $('cAddChord').focus();
}
function cRememberLyricEdits(){
  if(!LY.on)return;
  LY.lines.forEach((line,i)=>{
    if(line.blank||line.overrides)return;
    const previous=line.pl||[];
    lyAuto(i);
    const suggestions=line.pl.slice();
    const matched=new Set();
    line.overrides={};
    line.extras=[];
    for(const old of previous){
      const candidates=suggestions.filter(p=>p.c===old.c&&!matched.has(p.id));
      candidates.sort((a,b)=>Math.abs(a.w-old.w)-Math.abs(b.w-old.w));
      const match=candidates[0];
      if(match){
        matched.add(match.id);
        if(match.w!==old.w)line.overrides[match.id]=old.w;
      }else line.extras.push(old);
    }
    for(const p of suggestions)if(!matched.has(p.id))line.overrides[p.id]=null;
    line.pl=previous;
  });
}
function cRefreshLyrics(){
  if(!LY.on)return;
  LY.sel=null;LY.lines.forEach((_,i)=>lyAuto(i));
  if(!$('lyText').hidden)$('lyText').value=lyText();
}
function chordChartText(){
  return $('cKey').textContent+' · '+Math.round(CS.res.bpm)+' BPM\n\n'+
    CS.bars.map(b=>fmtT(b.t)+'  '+b.chords.map(cDisplay).join('  ')).join('\n');
}
$('cSimple').onchange=e=>{
  CS.simple=e.target.checked;cRender();
  if(LY.on&&!$('lyText').hidden)$('lyText').value=lyText();
};
$('cSource').onchange=e=>cChangeSource(e.target.value);
$('cComparison').ontoggle=()=>{if(CS.comparison&&$('cComparison').open)cCompare();};
$('cAddChord').onclick=()=>cOpenEditor();
$('cEditRoot').onchange=$('cEditQuality').onchange=cEditorOptions;
$('cEditSave').onclick=()=>cEditCommit(false);
$('cEditRemove').onclick=()=>cEditCommit(true);
$('cEditCancel').onclick=cCloseEditor;
$('cEditor').onkeydown=e=>{if(e.key==='Escape')cCloseEditor();};
for(const button of document.querySelectorAll('[data-chord-nudge]'))button.onclick=()=>{
  const input=$('cEditTime');
  input.value=Math.min(Number(input.max),Math.max(0,(input.valueAsNumber||0)+Number(button.dataset.chordNudge))).toFixed(2);
};
$('cChartCopy').onclick=async()=>{
  const box=$('cChartText'),text=chordChartText();
  try{
    if(IS_APP)Android.copy(text);else await navigator.clipboard.writeText(text);
    box.hidden=true;$('cChartStatus').textContent='Đã sao chép hợp âm.';
  }catch{box.value=text;box.hidden=false;box.focus();box.select();}
};
$('cChartSave').onclick=async()=>{
  try{$('cChartStatus').textContent=await saveOut('hop-am.txt',chordChartText(),'text/plain');}
  catch(error){$('cChartStatus').textContent=saveErr(error);}
};
