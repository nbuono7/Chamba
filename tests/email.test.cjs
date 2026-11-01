const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('email delivery rejects provider failures and escapes user content',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../emailService.js'),'utf8');let status=429,request;
 const sandbox={module:{exports:{}},AbortSignal,console:{error(){}},process:{env:{RESEND_API_KEY:'fake-key-for-local-test'}},mockFetch:async(url,options)=>{request=JSON.parse(options.body);return {ok:status===200,status};}};
 vm.runInNewContext(source.replace(/^const fetch = .*\n/,'const fetch=mockFetch;\n'),sandbox);
 await assert.rejects(sandbox.module.exports.emailNuevoMensaje('<img src=x onerror=alert(1)>','test@example.invalid','Fletes'),/429/);
 status=200;await sandbox.module.exports.emailNuevoMensaje('<img src=x onerror=alert(1)>','test@example.invalid','Fletes');
 assert.ok(request.html.includes('&lt;img'));assert.ok(!request.html.includes('<img'));
});
