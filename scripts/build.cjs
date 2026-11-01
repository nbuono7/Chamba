const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..'),out=path.join(root,'public-dist');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
for(const file of fs.readdirSync(root)){if(/\.(html|png|ico|webmanifest|txt)$/.test(file))fs.copyFileSync(path.join(root,file),path.join(out,file));}
fs.cpSync(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
console.log('Static site built; server code, tests, dependencies and database migrations are excluded.');
