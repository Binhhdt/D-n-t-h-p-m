const {readFileSync,writeFileSync}=require('node:fs');
const vm=require('node:vm');

const source=readFileSync('app-version.js','utf8');
const version=vm.runInNewContext(source+'\nAPP_VERSION');
if(typeof version.name!=='string'||!/^\d+\.\d+(\.\d+)?$/.test(version.versionName)||
   !Number.isInteger(version.versionCode)||version.versionCode<1||version.versionCode>2100000000){
  throw new Error('Invalid app version in app-version.js');
}
const metadata={...version,buildDate:new Date().toISOString()};
writeFileSync(process.argv[2],Object.entries(version)
  .filter(([key])=>key==='versionCode'||key==='versionName')
  .map(([key,value])=>key+'='+value).join('\n')+'\n');
writeFileSync(process.argv[3],'const APP_VERSION = Object.freeze('+JSON.stringify(metadata,null,2)+');\n');
