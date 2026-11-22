/* The worker receives only local FFT tensors. Its only fetches are runtime/model files. */
const ORT_URL='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
let session;
self.onmessage=async ({data})=>{
  try{
    if(data.model){
      importScripts(ORT_URL+'ort.wasm.min.js');
      ort.env.wasm.wasmPaths=ORT_URL;
      ort.env.wasm.numThreads=1;
      session=await ort.InferenceSession.create(data.model,{executionProviders:['wasm']});
      self.postMessage({ready:true});
      return;
    }
    const {magnitude,frames}=data;
    const result=await session.run({magnitude:new ort.Tensor('float32',magnitude,[frames,2,2049])});
    const vocals=result.vocals.data;
    self.postMessage({vocals},[vocals.buffer]);
  }catch(error){
    self.postMessage({error:error.message||String(error)});
  }
};
