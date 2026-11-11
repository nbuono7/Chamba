const fs=require('fs');const path=require('path');const {execFileSync}=require('child_process');const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');let count=0;
function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','public-dist'].includes(e.name))continue;const file=path.join(dir,e.name);if(e.isDirectory())scan(file);else if(/\.(js|cjs)$/.test(e.name)){execFileSync(process.execPath,['--check',file]);count++;}}}
scan(root);
for(const file of fs.readdirSync(root).filter(x=>x.endsWith('.html'))){const doc=new JSDOM(fs.readFileSync(path.join(root,file),'utf8')).window.document;
 for(const el of doc.querySelectorAll('script:not([type="application/ld+json"])'))if(!el.src)throw Error(file+': inline executable script');
 if(doc.querySelector('[onclick],[oninput],[onkeydown],[onchange]'))throw Error(file+': inline handler');
 for(const el of doc.querySelectorAll('script[src],link[href],img[src]')){const ref=el.getAttribute('src')||el.getAttribute('href');if(/^(https?:|data:|#)/.test(ref))continue;if(!fs.existsSync(path.join(root,ref.replace(/^\//,''))))throw Error(file+': missing '+ref);}
}
console.log(count+' JavaScript files checked; local script/style/image references verified.');
