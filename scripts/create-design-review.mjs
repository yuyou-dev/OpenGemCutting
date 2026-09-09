import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { importFacetingJSON } from '../src/domain/faceting.js';

const [designPath,...args]=process.argv.slice(2);
if(!designPath)throw new Error('Usage: npm run design:review -- design.json --out output/study [--reference image.png --views views.json --notes notes.txt]');
const options={};for(let i=0;i<args.length;i+=2){if(!['--out','--reference','--views','--notes'].includes(args[i])||!args[i+1])throw new Error(`Unknown or missing argument ${args[i]}`);options[args[i].slice(2)]=args[i+1];}
if(!options.out)throw new Error('--out is required; choose a new output directory.');
const out=path.resolve(options.out);
try { await fs.access(path.join(out,"review.json")); throw new Error("Review already exists; choose a new output directory."); } catch(error) { if(error.code !== "ENOENT") throw error; }
await fs.mkdir(out,{recursive:true});
const document=importFacetingJSON(await fs.readFile(designPath,'utf8'));
const manifest={format:'facet-design-review-v1',document};
if(options.reference){
 const filename=`reference${path.extname(options.reference).toLowerCase()}`;
 if(!['.png','.jpg','.jpeg','.webp'].includes(path.extname(filename)))throw new Error('Reference must be PNG, JPG or WebP.');
 if(path.resolve(options.reference)!==path.join(out,filename))await fs.copyFile(options.reference,path.join(out,filename),constants.COPYFILE_EXCL);
 manifest.reference={...(options.views?JSON.parse(await fs.readFile(options.views,'utf8')):{}),file:filename};
}
if(options.notes)manifest.notes=await fs.readFile(options.notes,'utf8');
const target=path.join(out,'review.json');await fs.writeFile(target,JSON.stringify(manifest,null,2),{flag:'wx'});
console.log(`Created ${target}\nOpen the workbench URL with ?review=${encodeURIComponent(path.relative(process.cwd(),target).split(path.sep).join('/'))}`);
