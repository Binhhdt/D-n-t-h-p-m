/* The worker receives local FFT tensors and loads only the ONNX Runtime assets. */
const ORT_URL='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
importScripts('separator-dsp.js');
let session;
self.onmessage=async ({data})=>{
  try{
    if(data.model){
      importScripts(ORT_URL+'ort.wasm.min.js');
      ort.env.wasm.wasmPaths=ORT_URL;
      ort.env.wasm.numThreads=1;
      session=await ort.InferenceSession.create(data.model,{
        executionProviders:['wasm'],graphOptimizationLevel:'basic',
        enableCpuMemArena:false,enableMemPattern:false
      });
      self.postMessage({ready:true});
      return;
    }
    const result=await session.run({input:new ort.Tensor('float32',data.spectrum,[1,4,SEP_BINS,SEP_FRAMES])});
    const backing=result.output.data;
    self.postMessage({backing},[backing.buffer]);
  }catch(error){
    self.postMessage({error:error.message||String(error)});
  }
};
