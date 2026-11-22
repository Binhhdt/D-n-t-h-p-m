/* Preserve the numerical IDs stored by earlier versions, including the no-chord ID. */
const NO_CHORD=24;
const CHORD_QUALITIES=[
  {id:0,suffix:'',notes:[0,4,7],simple:0},
  {id:12,suffix:'m',notes:[0,3,7],simple:12},
  {id:100,suffix:'7',notes:[0,4,7,10],simple:0},
  {id:112,suffix:'m7',notes:[0,3,7,10],simple:12},
  {id:400,suffix:'maj7',notes:[0,4,7,11],simple:0},
  {id:500,suffix:'dim',notes:[0,3,6],simple:12},
  {id:600,suffix:'aug',notes:[0,4,8],simple:0},
  {id:300,suffix:'sus2',notes:[0,2,7],simple:0},
  {id:200,suffix:'sus4',notes:[0,5,7],simple:0},
  {id:700,suffix:'m7b5',notes:[0,3,6,10],simple:12},
  {id:800,suffix:'6',notes:[0,4,7,9],simple:0},
  {id:812,suffix:'m6',notes:[0,3,7,9],simple:12},
  {id:900,suffix:'9',notes:[0,4,7,10,2],simple:0}
];
const chordPc=n=>((n%12)+12)%12;
function chordParts(code){
  const bass=code>=1000?Math.floor(code/1000)-1:null;
  const base=code%1000,root=base%12;
  // The hundreds are storage tags, so roots are relative to the tag.
  const quality=CHORD_QUALITIES.find(q=>base>=q.id&&base<q.id+12);
  return {root:quality?base-quality.id:root,quality,bass};
}
function chordCode(root,quality,bass=null){
  return root+quality.id+(bass!==null&&bass!==root?1000*(bass+1):0);
}
function chordName(code,shift=0,flat=false,simple=false){
  if(code===NO_CHORD)return '–';
  const {root,quality,bass}=chordParts(code),names=flat?FLAT:NAMES;
  if(!quality)return '–';
  const head=names[chordPc(root+shift)];
  return simple?head+(quality.simple?'m':''):head+quality.suffix+
    (bass===null?'':'/'+names[chordPc(bass+shift)]);
}

/* Downweight a peak when a stronger, lower peak accounts for it as an overtone.
   Bass evidence comes from the lowest supported fundamental, not all low partials. */
function chordSpectralFrame(peaks,fund,bass,offset){
  if(!peaks.length)return;
  const max=peaks.reduce((m,p)=>Math.max(m,p.amp),0);
  const accepted=[];
  let low=null;
  for(const p of peaks){
    if(p.amp<max*0.018)continue;
    let harmonic=0;
    for(const a of accepted){
      const ratio=p.hz/a.hz,h=Math.round(ratio);
      if(h>=2&&h<=6&&Math.abs(p.hz-h*a.hz)<Math.max(4,p.hz*0.009))
        harmonic=Math.max(harmonic,a.amp*(h===2?0.7:h===3?0.42:0.27));
    }
    const strength=p.amp-0.85*harmonic;
    if(strength<max*0.016)continue;
    accepted.push({hz:p.hz,amp:strength});
    const w=Math.sqrt(strength);
    fund[offset+p.pc]+=w;
    if(p.hz<250&&strength>max*0.09){
      if(!low)low=p;
      const near=p.hz<low.hz*1.09;
      bass[offset+p.pc]+=w*(near?1:0.12);
    }
  }
}

function chordViterbi(rows,penalty,shapes){
  const size=rows[0].length,back=[];
  let scores=Float32Array.from(rows[0]);
  for(let i=1;i<rows.length;i++){
    let best=0;
    const dominant=new Int16Array(12).fill(-1);
    for(let j=0;j<size;j++){
      if(scores[j]>scores[best])best=j;
      const s=shapes[j];
      if(s&&(s.quality.id===100||s.quality.id===900)){
        const next=chordPc(s.root+5),old=dominant[next];
        if(old<0||scores[j]>scores[old])dominant[next]=j;
      }
    }
    const next=new Float32Array(size),links=new Int16Array(size),cost=penalty(i);
    for(let j=0;j<size;j++){
      const s=shapes[j];
      let from=best,value=scores[best]-cost;
      if(scores[j]>=value){from=j;value=scores[j];}
      if(s&&(s.quality.id===0||s.quality.id===12)){
        const d=dominant[s.root];
        if(d>=0&&scores[d]-cost+0.045>value){from=d;value=scores[d]-cost+0.045;}
      }
      links[j]=from;next[j]=value+rows[i][j];
    }
    scores=next;back.push(links);
  }
  let end=0;
  for(let j=1;j<size;j++)if(scores[j]>scores[end])end=j;
  const path=new Int16Array(rows.length);
  for(let i=rows.length-1;i>=0;i--){path[i]=end;if(i)end=back[i-1][end];}
  return path;
}

/* Retain the beat grid for bars, but let spectral changes split a beat. */
async function advancedChordEvents({fund,bass,frames,fold,frameTime,hop,duration,beats,key,legacy,tick}){
  const shapes=[];
  for(const quality of CHORD_QUALITIES)for(let root=0;root<12;root++){
    const notes=quality.notes.map(n=>chordPc(n+root));
    shapes.push({root,quality,notes,code:chordCode(root,quality)});
  }
  const triads=shapes.filter(s=>s.quality.notes.length===3);
  shapes.push(null);
  const none=shapes.length-1;
  const spectral=[],energies=[];
  for(let f=0;f<frames;f++){
    const c=new Float32Array(12),b=new Float32Array(12);
    fold(fund,f,c);fold(bass,f,b);
    spectral.push({c,b});energies.push(c.reduce((a,v)=>a+v,0));
  }
  const floor=Math.max(0.001,median(energies)*0.033);
  const boundaries=[0];
  for(let j=0;j<beats.length;j++){
    const a=beats[j],b=j+1<beats.length?beats[j+1]:duration;
    if(a-boundaries[boundaries.length-1]>=0.15&&a<duration-0.14)boundaries.push(a);
    if(b-a>=0.48&&b<=duration&&b-(a+b)/2>=0.18)boundaries.push((a+b)/2);
  }
  const novelty=new Float32Array(frames);
  for(let f=2;f<frames-2;f++){
    const a=spectral[f-2].c,b=spectral[f+1].c,aa=energies[f-2],bb=energies[f+1];
    if(aa<floor||bb<floor)continue;
    for(let p=0;p<12;p++)novelty[f]+=Math.abs(a[p]/aa-b[p]/bb);
  }
  const beatGrid=boundaries.slice();
  for(let f=3;f<frames-3;f++){
    const t=frameTime+(f-0.5)*hop;
    if(novelty[f]<0.63||novelty[f]<novelty[f-1]||novelty[f]<=novelty[f+1])continue;
    if(t<0.18||t>duration-0.18)continue;
    // Keep the beat grid and add a boundary only when the change is far enough from it.
    let lo=0,hi=beatGrid.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(beatGrid[mid]<t)lo=mid+1;else hi=mid;}
    const j=lo>0&&(lo===beatGrid.length||t-beatGrid[lo-1]<beatGrid[lo]-t)?lo-1:lo;
    if(Math.abs(beatGrid[j]-t)>=0.17)boundaries.push(t);
  }
  boundaries.sort((a,b)=>a-b);
  const times=boundaries.filter((t,i)=>i===0||t-boundaries[i-1]>=0.135);
  const rows=[],features=[];
  const tonic=key.tonic;
  const scale=(key.minor?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11]).map(n=>chordPc(n+tonic));
  let beat=0;
  for(let i=0;i<times.length;i++){
    const start=times[i],end=i+1<times.length?times[i+1]:duration;
    const c=new Float32Array(12),b=new Float32Array(12),presence=new Float32Array(12);
    const first=Math.max(0,Math.min(frames-1,Math.ceil((start-frameTime)/hop)));
    const last=Math.max(first+1,Math.min(frames,Math.ceil((end-frameTime)/hop)));
    let energy=0;
    for(let f=first;f<last;f++){
      const w=energies[f],frame=spectral[f];
      energy+=w;
      if(w<floor)continue;
      const max=Math.max(...frame.c);
      for(let p=0;p<12;p++){
        c[p]+=frame.c[p]/max;b[p]+=frame.b[p]/w;
        if(frame.c[p]>=0.29*max)presence[p]++;
      }
    }
    const mx=Math.max(...c)||1,bmax=Math.max(...b)||1;
    const bx=b.indexOf(bmax),bsum=b.reduce((a,v)=>a+v,0);
    for(let p=0;p<12;p++){c[p]/=mx;b[p]/=bmax;presence[p]/=last-first;}
    const norm=Math.hypot(...c)||1;
    const sorted=Array.from(c).sort((a,b)=>b-a);
    while(beat+1<beats.length&&beats[beat+1]<=(start+end)/2)beat++;
    const prior=legacy[beat]===NO_CHORD?null:chordParts(legacy[beat]);
    let competingTriad=false;
    if(prior){
      for(const {root,quality,notes} of triads){
        if(root===prior.root&&quality.id===prior.quality.id)continue;
        const present=notes.every(p=>c[p]>=0.30&&presence[p]>=0.65);
        const exclusive=prior.quality.notes.slice(0,3).some(n=>c[chordPc(prior.root+n)]<0.12);
        if(present&&exclusive){competingTriad=true;break;}
      }
    }
    const quiet=energy/(last-first)<floor;
    const polyphony=sorted[2]>=0.16;
    const row=new Float32Array(shapes.length);
    for(let j=0;j<none;j++){
      const {root,quality,notes}=shapes[j],rootBass=b[root];
      const [a,d,f]=notes.map(p=>c[p]);
      const sum=notes.reduce((v,p)=>v+c[p],0);
      const extension=notes.slice(3);
      let value=sum/(norm*Math.sqrt(notes.length))+0.1*Math.min(a,d,f)+0.11*rootBass+0.025*a;
      if(!scale.includes(root))value-=0.022;
      if(quality.id===200||quality.id===300)value-=0.038;
      if(quality.id===500||quality.id===600)value-=0.028;
      let extended=false;
      if(extension.length){
        const v=Math.min(...extension.map(p=>c[p])),held=Math.min(...extension.map(p=>presence[p]));
        const resolves=(quality.id===100||quality.id===900)&&scale.includes(chordPc(root+5));
        value-=0.025+0.55*Math.max(0,(resolves?0.34:0.42)-v)+0.13*Math.max(0,0.5-held);
        extended=v>=0.27&&held>=0.6&&Math.min(a,d)>=0.25&&(f>=0.10||quality.id===900);
        if(quality.id===900)value-=0.024;
      }
      if(!polyphony)value-=0.25;
      if(prior&&prior.root===root&&prior.quality.simple===quality.simple){
        const anchor=competingTriad?0.045:polyphony?0.5:0.53;
        if(quality.id===prior.quality.id||quality.id===quality.simple||extended)value+=anchor;
        else value+=anchor*0.42;
      }
      row[j]=value;
    }
    const sustainedSilence=quiet&&energies[first-1]<floor&&energies[last]<floor&&
      (!prior||end-start>=0.33||energy<(last-first)*floor*0.22);
    row[none]=sustainedSilence?1.55:quiet&&!prior?1.4:sorted[1]<0.16?1.03:polyphony?0.56:0.64;
    rows.push(row);features.push({prior,bx,clear:bx>=0&&bmax>0.15&&bmax>0.55*bsum});
    if(i%250===249)await tick(0.96+0.03*i/times.length);
  }
  const path=chordViterbi(rows,i=>times[i]-times[i-1]<0.22?0.25:0.19,shapes);
  // Bridge short gaps between strums when the beat-scale estimate still supports
  // the held chord. Longer unpitched or silent segments keep the no-chord state.
  for(let i=1;i<path.length;){
    if(path[i]!==none){i++;continue;}
    let end=i+1;
    while(end<path.length&&path[end]===none)end++;
    const held=shapes[path[i-1]];
    if(held&&end<path.length&&times[end]-times[i]<0.35&&features.slice(i,end).every(({prior})=>
      prior&&prior.root===held.root&&prior.quality.simple===held.quality.simple)){
      path.fill(path[i-1],i,end);
    }
    i=end;
  }
  const events=[];
  for(let i=0;i<path.length;){
    let end=i+1;
    while(end<path.length&&path[end]===path[i])end++;
    const chosen=path[i],shape=shapes[chosen],values=new Float32Array(shapes.length);
    const bassVotes=new Float32Array(12);
    for(let j=i;j<end;j++){
      for(let k=0;k<values.length;k++)values[k]+=rows[j][k]/(end-i);
      const b=features[j];if(b.clear)bassVotes[b.bx]++;
    }
    const bestBass=bassVotes.indexOf(Math.max(...bassVotes));
    const slash=shape&&shape.root!==bestBass&&shape.notes.includes(bestBass)&&bassVotes[bestBass]>=Math.max(2,0.68*(end-i));
    const c=shape?chordCode(shape.root,shape.quality,slash?bestBass:null):NO_CHORD;
    const ordered=Array.from(values.keys()).filter(k=>k!==chosen).sort((a,b)=>values[b]-values[a]);
    const confidence=(score,margin)=>Math.round(Math.max(0,Math.min(0.99,0.48+0.32*(score-0.7)+0.8*margin))*100);
    const alternatives=ordered.filter(k=>values[k]>=values[chosen]-0.16).slice(0,3).map(k=>({
      c:shapes[k]?shapes[k].code:NO_CHORD,confidence:confidence(values[k],Math.min(0,values[k]-values[chosen]))
    }));
    events.push({id:'d'+i,t:times[i],c,confidence:confidence(values[chosen],values[chosen]-values[ordered[0]]),alternatives});
    i=end;
  }
  // When both time scales hear the same change, keep the stable beat position.
  const simpleCode=c=>{const {root,quality}=chordParts(c);return quality?root+quality.simple:NO_CHORD;};
  let nextBeat=1;
  for(let i=1;i<events.length;i++){
    const e=events[i],before=events[i-1],after=events[i+1];
    if(simpleCode(before.c)===simpleCode(e.c))continue;
    while(nextBeat<beats.length&&beats[nextBeat]<e.t-0.19)nextBeat++;
    for(let j=nextBeat;j<beats.length&&beats[j]<=e.t+0.36;j++){
      if(beats[j]<=before.t+0.12||beats[j]>=(after?after.t:duration)-0.12)continue;
      if(simpleCode(legacy[j-1])===simpleCode(before.c)&&simpleCode(legacy[j])===simpleCode(e.c)){
        e.t=beats[j];
        break;
      }
    }
  }
  return events;
}
