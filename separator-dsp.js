/* UVR-MDX-NET-Inst_Main expects a 44.1 kHz centered STFT, periodic Hann,
   and a [1, 4, 2048, 96] tensor of left/right real/imaginary planes. */
const SEP_FFT=4096,SEP_HOP=1024,SEP_BINS=2048,SEP_FRAMES=96;
const SEP_CONTEXT=8*SEP_HOP,SEP_OVERLAP=16*SEP_HOP;
const SEP_LENGTH=(SEP_FRAMES-1)*SEP_HOP-2*SEP_CONTEXT;
function sepReflect(i,n){
  if(n===1)return 0;
  const cycle=2*(n-1),pos=((i%cycle)+cycle)%cycle;
  return pos<n?pos:cycle-pos;
}

async function separateAudio(input,output,infer,checkpoint,onProgress){
  const length=input[0].length,channels=input.length,fft=makeFFT(SEP_FFT);
  const win=hann(SEP_FFT),re=new Float32Array(SEP_FFT),im=new Float32Array(SEP_FFT);
  const fade=Float32Array.from({length:SEP_OVERLAP},(_,i)=>0.5-0.5*Math.cos(Math.PI*i/SEP_OVERLAP));
  const plane=SEP_BINS*SEP_FRAMES,step=SEP_LENGTH-SEP_OVERLAP;
  for(let start=0;start<length;start+=step){
    const size=Math.min(SEP_LENGTH,length-start),last=start+size===length;
    const spec=new Float32Array(4*plane);
    // The model estimates through bin 2047. Preserve the single real Nyquist bin.
    const nyquist=input.map(()=>new Float32Array(SEP_FRAMES));
    for(let f=0;f<SEP_FRAMES;f++){
      const offset=start-SEP_CONTEXT+f*SEP_HOP-SEP_FFT/2;
      const inRange=offset>=0&&offset+SEP_FFT<=length;
      for(let ch=0;ch<channels;ch++){
        const source=input[ch],base=ch*2*plane;
        for(let i=0;i<SEP_FFT;i++){
          const k=offset+i;
          re[i]=source[inRange?k:sepReflect(k,length)]*win[i];im[i]=0;
        }
        fft(re,im);
        for(let b=0;b<SEP_BINS;b++){
          const j=base+b*SEP_FRAMES+f;
          spec[j]=re[b];spec[plane+j]=im[b];
        }
        nyquist[ch][f]=re[SEP_BINS];
      }
      if((f&7)===7)await checkpoint();
    }
    if(channels===1)spec.copyWithin(2*plane,0,2*plane);
    const backing=await infer(spec);
    await checkpoint();
    if(!backing||backing.length!==4*plane)throw new Error('Kết quả tách không đúng kích thước.');
    const chunk=input.map(()=>new Float32Array(size));
    for(let f=0;f<SEP_FRAMES;f++){
      const offset=f*SEP_HOP-SEP_CONTEXT-SEP_FFT/2;
      const lo=Math.max(0,-offset),hi=Math.min(SEP_FFT,size-offset);
      if(lo>=hi)continue;
      for(let ch=0;ch<channels;ch++){
        const base=ch*2*plane;
        for(let b=0;b<SEP_BINS;b++){
          const j=base+b*SEP_FRAMES+f;
          re[b]=channels===1?0.5*(backing[j]+backing[2*plane+j]):backing[j];
          im[b]=b===0?0:channels===1?-0.5*(backing[plane+j]+backing[3*plane+j]):-backing[plane+j];
          if(!Number.isFinite(re[b])||!Number.isFinite(im[b]))throw new Error('Mô hình trả về dữ liệu âm thanh không hợp lệ.');
          if(b>0){re[SEP_FFT-b]=re[b];im[SEP_FFT-b]=-im[b];}
        }
        re[SEP_BINS]=nyquist[ch][f];im[SEP_BINS]=0;
        fft(re,im);
        // Four squared Hann windows at quarter hops sum to 1.5 in the retained region.
        const target=chunk[ch];
        for(let i=lo;i<hi;i++)target[offset+i]+=re[i]*win[i]/(1.5*SEP_FFT);
      }
      if((f&7)===7)await checkpoint();
    }
    for(let ch=0;ch<channels;ch++){
      const target=output[ch],source=chunk[ch];
      for(let i=0;i<size;i++){
        let w=1;
        if(start&&i<SEP_OVERLAP)w=fade[i];
        if(!last&&i>=step)w=1-fade[i-step];
        target[start+i]+=w*source[i];
      }
    }
    onProgress((last?length:start+step)/length);
    await checkpoint();
    if(last)break;
  }
}
