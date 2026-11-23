const SEP_MODEL='models/uvr-mdx-inst-main-96.onnx';
const SEP_MODEL_BYTES=52787031;
const SEP_MODEL_HASH='022c3c149be3a2203ff352b331f4a443fab12b2d95ccbe7aad021a1fd2637c46';
const SEP_CACHE='uvr-mdx-inst-main-'+SEP_MODEL_HASH.slice(0,12);
const SEP_TRANSFER=49152;
const SEP={file:null,duration:null,stems:null,original:null,job:null,exporting:false,source:null,playing:null,frame:0,
  position:{V:0,I:0}};

function sepStatus(message,error=false){
  $('sepStatus').textContent=message;
  $('sepStatus').className=error?'err':'';
}
function sepProgress(p,label){
  $('sepProgress').hidden=false;
  $('sepProgress').value=p;
  sepStatus(label+' '+Math.round(p*100)+'%');
}
function sepControls(){
  const busy=Boolean(SEP.job)||SEP.exporting;
  $('sepPick').disabled=busy;
  $('sepStart').disabled=busy||!SEP.file;
  $('sepCancel').hidden=!SEP.job;
  for(const el of $('sepResults').querySelectorAll('button,input'))el.disabled=busy;
}
function sepChannelData(buf){
  return Array.from({length:buf.numberOfChannels},(_,c)=>buf.getChannelData(c));
}
function sepBaseName(){return SEP.file.name.replace(/\.[^.]+$/,'')||SEP.file.name;}
function sepStemName(key){return sepBaseName()+(key==='V'?'-Vocal':'-Instrumental');}
function stemFile(buf,name){
  return new File([wavMulti(sepChannelData(buf),buf.sampleRate)],name+'.wav',{type:'audio/wav'});
}
function sepAbort(signal){if(signal.aborted)throw new DOMException('Canceled','AbortError');}
function sepBudget(){
  if(IS_APP)return (window.AndroidSeparator?AndroidSeparator.budgetMiB():0)*1048576;
  const memory=navigator.deviceMemory;
  return (memory&&memory<=2?65:memory&&memory<=4?230:430)*1048576;
}
function sepCheckSize(duration,channels=2,budget=sepBudget()){
  if(budget<20*1048576)throw new Error('Thiết bị thiếu bộ nhớ để chạy mô hình. Hãy đóng ứng dụng khác rồi thử lại.');
  const limit=Math.floor(budget/(R*channels*4*4.5));
  if(duration>limit)throw new Error('File dài quá giới hạn xử lý của thiết bị ('+fmtT(limit)+'). Hãy chọn một đoạn ngắn hơn.');
}
function sepMeta(file){
  return new Promise(resolve=>{
    const audio=document.createElement('audio'),url=URL.createObjectURL(file);
    const done=()=>{
      const seconds=Number.isFinite(audio.duration)?audio.duration:null;
      clearTimeout(timer);audio.onloadedmetadata=audio.onerror=null;
      audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer=setTimeout(done,4000);
    audio.preload='metadata';
    audio.onloadedmetadata=audio.onerror=done;
    audio.src=url;
  });
}
function sepShowFile(){
  $('sepName').textContent=SEP.file?SEP.file.name+(SEP.duration===null?'':' · '+fmtT(SEP.duration)):'';
}
$('goSeparator').onclick=()=>show('separator');
$('sepPick').onclick=()=>$('sepFile').click();
$('sepFile').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;e.target.value='';
  sepStop();
  SEP.file=file;SEP.original=null;SEP.stems=null;SEP.duration=null;
  SEP.position={V:0,I:0};
  $('sepResults').hidden=true;
  sepShowFile();sepControls();sepStatus('Đang đọc thời lượng…');
  const duration=await sepMeta(file);
  if(SEP.file!==file||SEP.job||SEP.stems)return;
  SEP.duration=duration;sepShowFile();
  sepStatus(duration===null?'Thời lượng sẽ hiện sau khi giải mã.':'');
};

async function sepWebModel(signal){
  if(!window.Worker||!window.crypto||!window.crypto.subtle)throw new Error('Hãy mở ứng dụng trên HTTPS hoặc localhost để chạy mô hình.');
  let cache;
  try{cache=await caches.open(SEP_CACHE);}catch{}
  const url=new URL(SEP_MODEL,location.href).href;
  let response=cache?await cache.match(url):null;
  sepAbort(signal);
  const download=!response;
  if(download){
    const consent=await ask('Tải mô hình tách giọng hát?',
      'Mô hình UVR MDX-Net tải một lần, dung lượng 52,8 MB. Trình duyệt còn tải ONNX Runtime khi cần.',
      [['download','Tải mô hình'],['cancel','Hủy']]);
    sepAbort(signal);
    if(consent!=='download')throw new DOMException('Canceled','AbortError');
    sepProgress(0,'Đang tải mô hình');
    response=await fetch(url,{signal});
    if(!response.ok||!response.body)throw new Error('Không tải được mô hình UVR MDX-Net.');
  }
  const data=new Uint8Array(SEP_MODEL_BYTES);
  const reader=response.body.getReader();
  let offset=0;
  try{
    for(;;){
      const {value,done}=await reader.read();
      sepAbort(signal);
      if(done)break;
      if(offset+value.length>data.length)throw new Error('Kích thước mô hình không khớp.');
      data.set(value,offset);offset+=value.length;
      if(download)sepProgress(offset/data.length,'Đang tải mô hình');
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
  if(offset!==SEP_MODEL_BYTES||hash!==SEP_MODEL_HASH){
    if(cache)await cache.delete(url);
    throw new Error('Mô hình tải về bị lỗi. Hãy thử lại.');
  }
  if(download&&cache)await cache.put(url,new Response(data)).catch(()=>{});
  sepAbort(signal);
  return data.buffer;
}
async function sepWebRunner(job){
  const {signal}=job;
  const model=await sepWebModel(signal);
  sepProgress(0,'Đang mở mô hình');
  const worker=new Worker('separator-worker.js');
  job.cleanup=()=>worker.terminate();
  function exchange(message,transfer){
    return new Promise((resolve,reject)=>{
      const cancel=()=>finish(()=>reject(new DOMException('Canceled','AbortError')));
      const finish=fn=>{
        signal.removeEventListener('abort',cancel);
        worker.onmessage=worker.onerror=null;fn();
      };
      if(signal.aborted){cancel();return;}
      signal.addEventListener('abort',cancel,{once:true});
      worker.onerror=event=>finish(()=>reject(new Error(event.message||'Không mở được ONNX Runtime.')));
      worker.onmessage=({data})=>finish(()=>data.error?reject(new Error(data.error)):resolve(data));
      try{worker.postMessage(message,transfer);}catch(error){finish(()=>reject(error));}
    });
  }
  await exchange({model},[model]);
  return async spectrum=>(await exchange({spectrum},[spectrum.buffer])).backing;
}
async function sepAndroidRunner(job){
  const api=window.AndroidSeparator;
  const id=api&&api.open();
  if(!id)throw new Error('Không mở được mô hình. Hãy thử lại sau khi giải phóng bộ nhớ.');
  job.cleanup=()=>api.end(id);
  const wait=async expected=>{
    for(;;){
      sepAbort(job.signal);
      const status=api.status(id);
      if(status===expected)return;
      if(status==='closed'||status==='error')throw new Error('ONNX Runtime không xử lý được đoạn âm thanh.');
      await new Promise(resolve=>setTimeout(resolve,35));
    }
  };
  sepProgress(0,'Đang mở mô hình');
  await wait('ready');
  return async spectrum=>{
    const bytes=new Uint8Array(spectrum.buffer);
    if(!api.begin(id,SEP_FRAMES))throw new Error('Không cấp được bộ nhớ cho mô hình.');
    for(let off=0;off<bytes.length;off+=SEP_TRANSFER){
      const piece=bytes.subarray(off,off+SEP_TRANSFER);
      if(!api.write(id,encodeAudioBytes(piece)))throw new Error('Không chuyển được dữ liệu tới mô hình.');
      if(off%(SEP_TRANSFER*4)===0){await sleep0();sepAbort(job.signal);}
    }
    if(!api.infer(id))throw new Error('Không chạy được mô hình.');
    await wait('done');
    for(let off=0;off<bytes.length;off+=SEP_TRANSFER){
      const n=Math.min(SEP_TRANSFER,bytes.length-off);
      const decoded=atob(api.read(id,off,n));
      if(decoded.length!==n)throw new Error('Kết quả mô hình bị thiếu.');
      for(let i=0;i<n;i++)bytes[off+i]=decoded.charCodeAt(i);
      if(off%(SEP_TRANSFER*4)===0){await sleep0();sepAbort(job.signal);}
    }
    return spectrum;
  };
}

$('sepStart').onclick=async()=>{
  if(!SEP.file||SEP.job||SEP.exporting)return;
  sepStop();
  const job=new AbortController();
  SEP.job=job;SEP.stems=null;SEP.original=null;
  SEP.position={V:0,I:0};$('sepResults').hidden=true;sepControls();
  let last=performance.now();
  const check=async()=>{
    if(performance.now()-last>=20){await sleep0();last=performance.now();}
    sepAbort(job.signal);
  };
  try{
    const budget=sepBudget();
    sepCheckSize(SEP.duration||0,2,budget);
    if(SEP.file.size>Math.min(128*1048576,budget))throw new Error('File quá lớn so với bộ nhớ của thiết bị.');
    sepProgress(0,'Đang giải mã âm thanh');
    const Ctx=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    let original=await new Ctx(2,1,R).decodeAudioData(await SEP.file.arrayBuffer());
    sepAbort(job.signal);
    SEP.duration=original.duration;sepShowFile();
    sepCheckSize(original.duration,original.numberOfChannels);
    if(original.numberOfChannels>2){
      const ctx=new Ctx(2,original.length,R),source=ctx.createBufferSource();
      source.buffer=original;source.connect(ctx.destination);source.start();
      original=await ctx.startRendering();
    }
    sepAbort(job.signal);
    const infer=await (IS_APP?sepAndroidRunner(job):sepWebRunner(job));
    sepAbort(job.signal);
    const make=()=>new AudioBuffer({length:original.length,sampleRate:R,numberOfChannels:original.numberOfChannels});
    const instrumental=make(),input=sepChannelData(original),backing=sepChannelData(instrumental);
    sepProgress(0,'Đang tách âm thanh');
    await separateAudio(input,backing,infer,check,p=>sepProgress(p*0.99,'Đang tách âm thanh'));
    const vocal=make();
    // Remove the model's complex accompaniment estimate from the original mix.
    for(let c=0;c<input.length;c++){
      const voice=vocal.getChannelData(c);
      for(let start=0;start<voice.length;start+=65536){
        const end=Math.min(voice.length,start+65536);
        for(let i=start;i<end;i++)voice[i]=input[c][i]-backing[c][i];
        await check();
      }
    }
    SEP.original=original;SEP.stems={V:vocal,I:instrumental};
    for(const key of ['V','I'])$('sepSeek'+key).max=original.duration;
    $('sepResults').hidden=false;sepUpdate();sepStatus('Đã tách xong · 100%');
  }catch(error){
    if(error.name==='AbortError')sepStatus('Đã hủy xử lý.');
    else sepStatus('Không tách được âm thanh. '+(error.message||'Hãy thử file ngắn hơn hoặc chọn định dạng khác.'),true);
  }finally{
    if(job.cleanup)job.cleanup();
    SEP.job=null;
    $('sepProgress').hidden=true;sepControls();
  }
};
$('sepCancel').onclick=()=>{
  if(askDone)askDone(null);
  const job=SEP.job;
  if(!job)return;
  job.abort();
  if(job.cleanup){job.cleanup();job.cleanup=null;}
};

function sepPosition(key){
  return SEP.playing===key?Math.min(SEP.stems[key].duration,SEP.position[key]+actx.currentTime-SEP.started):SEP.position[key];
}
function sepUpdate(){
  if(!SEP.stems)return;
  for(const key of ['V','I']){
    const name=key==='V'?'vocal':'nhạc nền',time=sepPosition(key);
    $('sepPlay'+key).textContent=SEP.playing===key?'❚❚ Tạm dừng '+name:'▶ Phát '+name;
    $('sepSeek'+key).value=time;
    $('sepClock'+key).textContent=fmtT(time)+' / '+fmtT(SEP.stems[key].duration);
  }
  if(SEP.source)SEP.frame=requestAnimationFrame(sepUpdate);
}
function sepStop(){
  if(SEP.source){
    const key=SEP.playing;
    SEP.position[key]=sepPosition(key);
    const source=SEP.source;SEP.source=null;SEP.playing=null;
    source.stop();source.disconnect();
  }
  cancelAnimationFrame(SEP.frame);sepUpdate();
}
function sepPlay(key){
  if(!SEP.stems)return;
  if(SEP.playing===key){sepStop();return;}
  sepStop();
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    if(actx.state==='suspended')actx.resume();
    const buf=SEP.stems[key],source=actx.createBufferSource();
    if(SEP.position[key]>=buf.duration)SEP.position[key]=0;
    source.buffer=buf;source.connect(actx.destination);
    source.onended=()=>{
      if(SEP.source!==source)return;
      SEP.source=null;SEP.playing=null;SEP.position[key]=0;
      source.disconnect();sepUpdate();
    };
    source.start(0,SEP.position[key]);
    SEP.source=source;SEP.started=actx.currentTime;SEP.playing=key;sepUpdate();
  }catch{sepStatus('Không phát được bản này.',true);}
}
for(const key of ['V','I']){
  $('sepPlay'+key).onclick=()=>sepPlay(key);
  $('sepSeek'+key).oninput=e=>{
    const time=Number(e.target.value),playing=SEP.playing===key;
    if(playing)sepStop();
    SEP.position[key]=time;
    if(playing)sepPlay(key);
    else if(!SEP.source)sepUpdate();
  };
}
function sepLeave(){
  if(SEP.exporting)return;
  if(SEP.job)$('sepCancel').click();
  show('home');renderRecent();
}
async function sepExport(key,ext){
  if(!SEP.stems||SEP.exporting)return;
  SEP.exporting=true;sepControls();sepStop();
  sepProgress(0,'Đang tạo '+ext.toUpperCase());
  try{
    await sleep0();
    const buf=SEP.stems[key],ch=sepChannelData(buf);
    const bytes=ext==='wav'?wavMulti(ch,R):await mp3Bytes(ch[0],p=>sepProgress(p,'Đang tạo MP3'),R,256,ch[1]);
    sepStatus(await saveOut(sepStemName(key)+'.'+ext,bytes,ext==='wav'?'audio/wav':'audio/mpeg',true));
  }catch(error){sepStatus(error.code?saveErr(error):'Không tạo được '+ext.toUpperCase()+'. '+(error.message||''),true);}
  finally{SEP.exporting=false;$('sepProgress').hidden=true;sepControls();}
}
for(const button of document.querySelectorAll('[data-export-stem]')){
  button.onclick=()=>sepExport(...button.dataset.exportStem.split(','));
}
$('sepToVocal').onclick=()=>{
  show('vocal');
  openVocal(null,sepStemName('V')+'.wav',null,SEP.stems.V);
};
$('sepToTone').onclick=()=>{
  show('tone');
  openTone(null,sepStemName('I')+'.wav',null,SEP.stems.I);
};
$('sepToChords').onclick=()=>openStemChords(SEP.original,SEP.stems.I,SEP.file,sepStemName('I'));
