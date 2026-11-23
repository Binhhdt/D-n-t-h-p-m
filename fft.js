function makeFFT(n){
  const rev=new Uint32Array(n),co=new Float32Array(n/2),si=new Float32Array(n/2);
  let bits=0;while((1<<bits)<n)bits++;
  for(let i=0;i<n;i++){let r=0;for(let b=0;b<bits;b++)if(i&(1<<b))r|=1<<(bits-1-b);rev[i]=r;}
  for(let k=0;k<n/2;k++){co[k]=Math.cos(2*Math.PI*k/n);si[k]=Math.sin(2*Math.PI*k/n);}
  return function(re,im){
    for(let i=0;i<n;i++){const j=rev[i];if(j>i){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
    for(let size=2;size<=n;size<<=1){
      const half=size>>1,step=n/size;
      for(let i=0;i<n;i+=size)for(let j=0,k=0;j<half;j++,k+=step){
        const a=i+j,b=a+half,tr=re[b]*co[k]+im[b]*si[k],ti=im[b]*co[k]-re[b]*si[k];
        re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;
      }
    }
  };
}
const hann=n=>{const w=new Float32Array(n);for(let i=0;i<n;i++)w[i]=0.5-0.5*Math.cos(2*Math.PI*i/n);return w;};
