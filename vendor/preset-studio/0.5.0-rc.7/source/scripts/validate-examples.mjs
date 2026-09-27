/** Runtime validation for all shipped JSON examples. Node standard library only. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateComponent,validateWorkspace,importNativeDocument,instantiateCatalog,builtinCatalog,inspectComponent,instancePlanes,machineReport} from '../src/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),results=[];
for(const f of fs.readdirSync(path.join(root,'examples')).filter(f=>f.endsWith('.json'))){
 const data=JSON.parse(fs.readFileSync(path.join(root,'examples',f),'utf8'));let count=1,mode;
 if(data.kind==='opengemcutting-component'){validateComponent(data);mode='component';}
 else if(data.kind==='opengemcutting-component-library'){data.components.forEach(validateComponent);count=data.components.length;mode='library';}
 else if(data.kind==='opengemcutting-component-workspace'){const state=validateWorkspace(data);const planes=[...state.basePlanes,...state.girdlePlanes,...state.groups.filter(g=>g.id!==state.editId).flatMap(g=>instancePlanes(g.component,g.transform)),...instancePlanes(state.draft,state.transform)];mode=`workspace: ${state.machine.teeth} gear, ${machineReport(planes,state.machine.teeth).exact?'exact':'review blocked'}`;}
 else if(data.kind==='facet-96-document'){importNativeDocument(data);mode='native96';}
 else continue;
 results.push({file:f,mode,count,valid:true});
}
const catalog=builtinCatalog().map(instantiateCatalog).map(c=>{const x=inspectComponent(c);if(!(x.stats.volume>0)||x.stats.inactive.length)throw Error('Invalid built-in: '+c.id);return {id:c.id,faces:c.planes.length,valid:true};});
console.log(JSON.stringify({runtimeFiles:results.length,results,builtins:catalog.length,allBuiltinsValid:true},null,2));
