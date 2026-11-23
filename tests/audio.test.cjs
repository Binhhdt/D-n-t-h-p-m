const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');

function engine(){
  const context=vm.createContext({performance,setTimeout});
  const html=fs.readFileSync('index.html','utf8');
  for(const source of ['fft.js','chords.js','separator-dsp.js'])
    vm.runInContext(fs.readFileSync(source,'utf8'),context,{filename:source});
  vm.runInContext(html.match(/<script>\s*const R=[\s\S]*?<\/script>/)[0].slice(8,-9),context,{filename:'index audio'});
  return vm.runInContext('({SR,HOP,analyzeSong,chordName,chordParts,pitchTrack,median,midiToHz,separateAudio,SEP_LENGTH,SEP_OVERLAP})',context);
}
const {analyzeSong,chordName,chordParts,pitchTrack,median,midiToHz,SR,HOP,separateAudio,SEP_LENGTH,SEP_OVERLAP}=engine();

test('legacy and advanced IDs, simple spelling and inversion transposition',()=>{
  assert.deepEqual([0,21,24,104,209,302,421,503,612-1,711,809,821,907].map(c=>chordName(c)),
    ['C','Am','–','E7','Asus4','Dsus2','–','D#dim','Baug','Bm7b5','A6','Am6','G9']);
  assert.equal(chordName(400,2),'Dmaj7');
  assert.equal(chordName(121,2),'Bm7');
  assert.equal(chordName(104,-2),'D7');
  assert.equal(chordName(5000,2),'D/F#');
  assert.equal(chordName(5000,2,false,true),'D');
  assert.equal(chordName(421,0,true),'–');
});

function piece(chords,time=1.4){
  const x=new Float32Array(Math.ceil(SR*(chords.length*time+0.55)));
  for(const [idx,[bass,...notes]] of chords.entries()){
    const start=Math.round(idx*time*SR),count=Math.round(time*SR);
    for(let i=0;i<count;i++){
      const t=i/SR,phase=t%0.35,attack=Math.min(1,i/160,(count-i)/160);
      for(const n of notes){
        const w=2*Math.PI*midiToHz(n)*t;
        x[start+i]+=(0.05+0.025*Math.exp(-phase*15))*attack*(Math.sin(w)+0.24*Math.sin(2*w)+0.12*Math.sin(3*w));
      }
      if(bass!=null){
        const w=2*Math.PI*midiToHz(bass)*t;
        x[start+i]+=0.145*attack*(0.75+0.25*Math.exp(-phase*6))*(Math.sin(w)+0.14*Math.sin(2*w));
      }
    }
  }
  return x;
}
const detect=(r,t)=>chordName(r.events.filter(e=>e.t<=t).at(-1)?.c??24);
test('major/minor, extensions, secondary dominants, inversions and silence',async()=>{
  const pairs=[
    [[36,60,64,67],'C'],[[45,60,64,69],'Am'],[[38,62,65,69,72],'Dm7'],[[43,59,62,65,67],'G7'],
    [[45,60,64,69],'Am'],[[38,62,65,69],'Dm'],[[40,59,62,64,68],'E7'],[[45,60,64,69],'Am'],
    [[36,59,60,64,67],'Cmaj7'],[[35,59,62,65],'Bdim'],[[36,60,64,68],'Caug'],
    [[38,62,67,69],'Dsus4'],[[36,60,62,67],'Csus2'],[[35,57,59,62,65],'Bm7b5'],
    [[36,57,60,64,67],'C6'],[[45,57,60,64,66],'Am6'],[[43,57,59,62,65,67],'G9'],
    [[40,60,64,67],'C/E'],[[35,59,62,67],'G/B'],[[48,57,60,64],'Am/C'],
    [[null,69],'–']
  ];
  const r=await analyzeSong(piece(pairs.map(([p])=>p)),null,true);
  assert.ok(r);
  assert.deepEqual(pairs.map((_,i)=>detect(r,i*1.4+0.8)),pairs.map(([,n])=>n));
  assert.ok(r.events.filter(e=>e.c!==24).every(e=>e.confidence>=0&&e.confidence<=100));
});
test('two chord changes inside one beat and legacy result stays available',async()=>{
  const a=[45,60,64,69],d=[38,62,65,69],e=[40,59,62,64,68],c=[36,60,64,67];
  const x=piece([a,a,d,e,c,c,a,a,d,e,c,c,a,a,d,e,c,c,a,a,d,e,c,c],0.42);
  const r=await analyzeSong(x,null,true);
  const old=await analyzeSong(x);
  assert.ok(old.chord.length&&old.events===undefined);
  for(const [idx,label] of [[2,'Dm'],[3,'E7'],[4,'C'],[8,'Dm'],[9,'E7']])
    assert.equal(detect(r,idx*0.42+0.23),label);
});
test('YIN still measures the reference A4',async()=>{
  const x=Float32Array.from({length:SR*2},(_,i)=>0.35*Math.sin(2*Math.PI*440*i/SR));
  const notes=await pitchTrack(x);
  const a=Array.from(notes).filter(Number.isFinite);
  assert.ok(a.length>50&&Math.abs(median(a)-69)<0.05);
});
test('STFT overlap-add preserves mono/stereo length and samples with an unchanged complex spectrum',async()=>{
  for(const channels of [1,2]){
    const n=channels===1?1193:SEP_LENGTH+SEP_OVERLAP+23;
    const input=Array.from({length:channels},(_,c)=>Float32Array.from({length:n},(_,i)=>0.3*Math.sin(i*(0.037+c*0.02))));
    const output=input.map(()=>new Float32Array(n)),progress=[];
    await separateAudio(input,output,
      spectrum=>structuredClone(spectrum,{transfer:[spectrum.buffer]}),
      async()=>{},p=>progress.push(p));
    for(let c=0;c<channels;c++){
      let error=0;
      for(let i=0;i<n;i++)error=Math.max(error,Math.abs(input[c][i]-output[c][i]));
      assert.ok(error<5e-6,String(error));
    }
    assert.equal(progress.at(-1),1);
    if(channels===2)assert.ok(progress.length>1);
  }
});
test('separation stops before inference when canceled during preprocessing',async()=>{
  const input=[new Float32Array(SEP_LENGTH)],output=[new Float32Array(SEP_LENGTH)];
  const canceled=new Error('canceled');
  await assert.rejects(separateAudio(input,output,()=>assert.fail('inference started'),async()=>{throw canceled;},()=>{}),canceled);
});
test('packaged UVR MDX-Net model matches the web integrity metadata',()=>{
  const model=fs.readFileSync('models/uvr-mdx-inst-main-96.onnx');
  const app=fs.readFileSync('separator.js','utf8');
  assert.ok(app.includes('SEP_MODEL_BYTES='+model.length));
  assert.ok(app.includes(crypto.createHash('sha256').update(model).digest('hex')));
});

async function scoreGuitarSet(root){
  const {execFileSync}=require('node:child_process');
  const path=require('node:path');
  let baseline=0,advanced=0,duration=0;
  for(const file of fs.readdirSync(root).filter(n=>n.endsWith('_comp.json'))){
    const name=path.join(root,file.slice(0,-5));
    const data=execFileSync('ffmpeg',['-v','error','-i',name+'.wav','-f','f32le','-ar',String(SR),'-ac','1','pipe:1'],{maxBuffer:8e6});
    const x=new Float32Array(data.buffer,data.byteOffset,data.length/4);
    const intervals=JSON.parse(fs.readFileSync(name+'.json','utf8'));
    const old=await analyzeSong(x),next=await analyzeSong(x,null,true);
    const score=[0,0,0];
    for(const entry of intervals){
      const [rootName,type]=entry.value.split(':');
      if(!['min','maj'].includes(type))continue;
      const expected=rootName+(type==='min'?'m':'');
      for(let t=entry.time+0.05;t<entry.time+entry.duration&&t<x.length/SR;t+=0.1){
        const i=Math.max(0,old.beats.findLastIndex(v=>v<=t));
        const code=next.events.findLast(e=>e.t<=t)?.c??24;
        score[0]+=+(chordName(old.chord[i],0,false,true)===expected);
        score[1]+=+(chordName(code,0,false,true)===expected);
        score[2]++;
      }
    }
    baseline+=score[0];advanced+=score[1];duration+=score[2];
    console.log(file,{legacy:score[0],advanced:score[1],evaluated:score[2]});
  }
  assert.ok(duration>0);
  console.log({baseline,advanced,duration,baselinePct:100*baseline/duration,advancedPct:100*advanced/duration});
  assert.ok(advanced>=baseline);
}
if(process.env.CHORD_FIXTURES){
  const root=process.env.CHORD_FIXTURES;
  test('real GuitarSet major and minor: duration-weighted accuracy versus baseline',async()=>{
    await scoreGuitarSet(root);
  });
  test('YIN on annotated GuitarSet solo with only one active reference note',async()=>{
    const {execFileSync}=require('node:child_process');
    const name=require('node:path').join(root,'00_SS3-84-Bb_solo');
    const data=execFileSync('ffmpeg',['-v','error','-i',name+'.wav','-f','f32le','-ar',String(SR),'-ac','1','pipe:1'],{maxBuffer:8e6});
    const reference=JSON.parse(fs.readFileSync(name+'.json','utf8'));
    const notes=await pitchTrack(new Float32Array(data.buffer,data.byteOffset,data.length/4));
    let correct=0,evaluated=0;
    for(let i=0;i<notes.length;i++){
      const t=i*HOP/SR;
      const active=reference.filter(e=>e.time+0.035<t&&t<e.time+e.duration-0.03);
      if(active.length!==1)continue;
      evaluated++;
      correct+=+(Math.abs(notes[i]-active[0].value)<0.5);
    }
    console.log({correct,evaluated,pct:100*correct/evaluated});
    assert.ok(evaluated>1000&&correct/evaluated>0.8);
  });
}
