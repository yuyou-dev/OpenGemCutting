import { build } from 'vite';
import { readFile, writeFile, mkdir, readdir, cp, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { moduleInfo } from '../../src/lab/info.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? `output/preset-lab-${moduleInfo.moduleVersion}`), directory = path.join(output,'package');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value,null,2)+'\n';
async function files(base, prefix='') {
    const out=[];
    for(const e of await readdir(path.join(base,prefix),{withFileTypes:true})) {
        const p=path.posix.join(prefix,e.name); if(e.isDirectory()) out.push(...await files(base,p)); else if(e.isFile()) out.push(p);
    }
    return out.sort();
}
const hashes = async base => Object.fromEntries(await Promise.all((await files(base)).map(async f=>[f,hash(await readFile(path.join(base,f)))])));
await mkdir(path.dirname(output),{recursive:true}); await mkdir(output);
await build({root,configFile:path.join(root,'vite.module.config.mjs')});
await cp(path.join(root,'dist/module'),directory,{recursive:true});
const runtimeFiles=await hashes(directory);
for(const name of ['src','vendor','tests','scripts']) await cp(path.join(root,name),path.join(directory,'source',name),{recursive:true});
for(const name of ['package.json','package-lock.json','vite.module.config.mjs','LICENSE']) await copyFile(path.join(root,name),path.join(directory,'source',name==='package-lock.json'?'npm-shrinkwrap.json':name));
const sourceFiles=await hashes(path.join(directory,'source'));
const dependencies=[];
for(const name of ['react','react-dom','scheduler','@tabler/icons-react','@fontsource-variable/noto-sans-sc','@fontsource/ibm-plex-mono']) {
    const base=path.join(root,'node_modules',name), pkg=JSON.parse(await readFile(path.join(base,'package.json'))), licenseFile=`licenses/${name.replaceAll('/','-')}.txt`;
    await mkdir(path.join(directory,'licenses'),{recursive:true}); await copyFile(path.join(base,'LICENSE'),path.join(directory,licenseFile));
    dependencies.push({name,version:pkg.version,license:pkg.license,licenseFile});
}
await copyFile(path.join(root,'LICENSE'),path.join(directory,'LICENSE'));
await copyFile(path.join(root,'scripts/module/self-test.mjs'),path.join(directory,'self-test.mjs'));
await writeFile(path.join(directory,'THIRD_PARTY_NOTICES.md'),'# Bundled dependencies\n\n'+dependencies.map(d=>`- ${d.name} ${d.version}: ${d.license} ([license](${d.licenseFile}))`).join('\n')+'\n\nLaboratory code is MIT. No SUVA logo or other restricted brand asset is included. Shared navigation license is retained in source/vendor.\n');
await writeFile(path.join(directory,'README.md'),'# Crown / pavilion laboratory\n\nNative ESM API 2. mountPresetStudio(element, options) or createPresetStudioSession(options). Source and newDesign are mutually exclusive. Host owns persistence and onResult. Lifecycle: pause, resume, flush, returnResult, dispose. flush preserves unapplied edits; returnResult requires applied groups.\n\nRebuild: cd source && npm ci && npm run module:build. No development server or adjacent source checkout is required at runtime.\n');
await writeFile(path.join(directory,'package.json'),json({name:'@facet96/preset-studio',version:moduleInfo.moduleVersion,type:'module',private:true,license:'MIT',main:'./index.js',scripts:{test:'node self-test.mjs'}}));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const fileHashes=await hashes(directory), status=git(['status','--porcelain=v1','--untracked-files=all']);
const manifest={packageName:'@facet96/preset-studio',moduleVersion:moduleInfo.moduleVersion,contractVersion:moduleInfo.contractVersion,entryApiVersion:2,
    publicContractArchiveSha256:'b94531101cfef0a946fed3cc7b7d526d44146a1e0c574b08f088790f6930cbd3',
    source:{commit:git(['rev-parse','HEAD']),dirty:!!status,status,files:sourceFiles,contentSha256:hash(JSON.stringify(sourceFiles))},
    runtimeDependencies:[],bundledDependencies:dependencies,reactStrategy:'bundled-private-root',runtimeFiles,runtimeContentSha256:hash(JSON.stringify(runtimeFiles)),fileHashes};
await writeFile(path.join(directory,'MANIFEST.json'),json(manifest));
fileHashes['MANIFEST.json']=hash(await readFile(path.join(directory,'MANIFEST.json')));
await writeFile(path.join(directory,'SHA256SUMS'),Object.entries(fileHashes).sort(([a],[b])=>a.localeCompare(b,'en')).map(([f,h])=>`${h}  ${f}`).join('\n')+'\n');
execFileSync(process.execPath,[path.join(directory,'self-test.mjs')],{stdio:'inherit'});
const packed=JSON.parse(execFileSync('npm',['pack','--json','--ignore-scripts','--pack-destination',output],{cwd:directory,encoding:'utf8'}));
const archive=path.join(output,packed[0].filename), sha256=hash(await readFile(archive));
await writeFile(path.join(output,'ARCHIVE-SHA256SUMS'),`${sha256}  ${path.basename(archive)}\n`);
console.log(json({archive,sha256,moduleVersion:moduleInfo.moduleVersion}));
