const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');

function metadata(source){
  return vm.runInNewContext(source+'\nAPP_VERSION');
}

const [apk,aapt]=process.argv.slice(2);
const badge=execFileSync(aapt,['dump','badging',apk],{encoding:'utf8'});
const [,code,name]=badge.match(/^package: .*versionCode='(\d+)' versionName='([^']+)'/m);
const web=metadata(readFileSync('app-version.js','utf8'));
const packed=metadata(execFileSync('unzip',['-p',apk,'assets/app-version.js'],{encoding:'utf8'}));
assert.equal(name,web.versionName);
assert.equal(Number(code),web.versionCode);
assert.equal(packed.versionName,name);
assert.equal(packed.versionCode,Number(code));
assert.equal(packed.name,web.name);
assert.ok(Number.isFinite(Date.parse(packed.buildDate)));
console.log(`Verified APK and web version ${name} (code ${code})`);
