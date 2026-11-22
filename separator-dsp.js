/* Open-Unmix HQ uses a periodic Hann window and unnormalized, centered STFT
   at 44.1 kHz. Model tensors are [time, stereo, frequency]. */
const SEP_FFT=4096,SEP_HOP=1024,SEP_BINS=2049,SEP_FRAMES=192;
const SEP_CONTEXT=8*SEP_HOP,SEP_OVERLAP=32*SEP_HOP;
const SEP_LENGTH=(SEP_FRAMES-1)*SEP_HOP-2*SEP_CONTEXT;
function sepReflect(i,n){
  if(n===1)return 0;
  const cycle=2*(n-1),pos=((i%cycle)+cycle)%cycle;
  return pos<n?pos:cycle-pos;
}

async function separateAudio(input,output,infer,checkpoint,onProgress){
  const length=input[0].length,channels=input.length,fft=makeFFT(SEP_FFT);
  const win=hann(SEP_FFT),re=new Float32Array(SEP_FFT),im=new Float32Array(SEP_FFT);
  const step=SEP_LENGTH-SEP_OVERLAP;
  for(let start=0;start<length;start+=step){
    const size=Math.min(SEP_LENGTH,length-start),last=start+size===length;
    const frames=Math.ceil((size+2*SEP_CONTEXT)/SEP_HOP)+1;
    const spec=new Float32Array(frames*channels*SEP_BINS*2);
    const mag=new Float32Array(frames*2*SEP_BINS);
    for(let f=0;f<frames;f++){
      const offset=start-SEP_CONTEXT+f*SEP_HOP-SEP_FFT/2;
      for(let ch=0;ch<channels;ch++){
        const source=input[ch],col=(f*channels+ch)*2*SEP_BINS,row=(2*f+ch)*SEP_BINS;
        const inRange=offset>=0&&offset+SEP_FFT<=length;
        for(let i=0;i<SEP_FFT;i++){
          const k=offset+i;
          re[i]=source[inRange?k:sepReflect(k,length)]*win[i];im[i]=0;
        }
        fft(re,im);
        for(let b=0;b<SEP_BINS;b++){
          spec[col+2*b]=re[b];spec[col+2*b+1]=im[b];
          mag[row+b]=Math.sqrt(re[b]*re[b]+im[b]*im[b]);
        }
        if(channels===1)mag.copyWithin(row+SEP_BINS,row,row+SEP_BINS);
      }
      if((f&7)===7)await checkpoint();
    }
    const vocals=await infer(mag,frames);
    await checkpoint();
    const chunk=input.map(()=>new Float32Array(size));
    for(let f=0;f<frames;f++){
      const offset=f*SEP_HOP-SEP_CONTEXT-SEP_FFT/2;
      const lo=Math.max(0,-offset),hi=Math.min(SEP_FFT,size-offset);
      if(lo>=hi)continue;
      for(let ch=0;ch<channels;ch++){
        const col=(f*channels+ch)*2*SEP_BINS,row=(2*f+ch)*SEP_BINS;
        for(let b=0;b<SEP_BINS;b++){
          const r=spec[col+2*b],i=spec[col+2*b+1],m=Math.sqrt(r*r+i*i);
          const prediction=channels===1?(vocals[row+b]+vocals[row+SEP_BINS+b])/2:vocals[row+b];
          // Use a bounded vocal mask and allocate the remainder of the mix to accompaniment.
          const mask=Number.isFinite(prediction)?Math.max(0,Math.min(1,prediction/(m+1e-8))):0;
          re[b]=r*mask;im[b]=-i*mask;
          if(b>0&&b<SEP_FFT/2){re[SEP_FFT-b]=re[b];im[SEP_FFT-b]=-im[b];}
        }
        fft(re,im);
        // For four periodic Hann windows at quarter hops, the squared weights sum to 1.5.
        const target=chunk[ch];
        for(let i=lo;i<hi;i++)target[offset+i]+=re[i]*win[i]/(1.5*SEP_FFT);
      }
      if((f&7)===7)await checkpoint();
    }
    for(let ch=0;ch<channels;ch++){
      const target=output[ch],source=chunk[ch];
      for(let i=0;i<size;i++){
        let w=1;
        if(start&&i<SEP_OVERLAP)w=0.5-0.5*Math.cos(Math.PI*i/SEP_OVERLAP);
        if(!last&&i>=step)w=0.5+0.5*Math.cos(Math.PI*(i-step)/SEP_OVERLAP);
        target[start+i]+=w*source[i];
      }
    }
    onProgress((last?length:start+step)/length);
    await checkpoint();
    if(last)break;
  }
}
