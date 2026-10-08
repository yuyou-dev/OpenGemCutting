import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {builtinCatalog,instantiateCatalog,generatePreset,inspectComponent,normalizeTransform,instancePlanes,cutSolid,geometryStats,prismSolid,cubeSolid,makeNativeDocument,exportOBJ,editPlane,machineReport,normalizeMachineProfile,GEAR_CATALOG,rebuildIntegerComponent,compatibleGears} from '../src/index.js';
import {lSolid,ringSolid,disconnectedSolid} from '../tests/fixtures.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=path.join(root,'examples');fs.mkdirSync(dir,{recursive:true});
const save=(name,data)=>fs.writeFileSync(path.join(dir,name),typeof data==='string'?data:JSON.stringify(data,null,2));
const components=builtinCatalog().map(instantiateCatalog);
save('builtin-library-70.json',{kind:'opengemcutting-component-library',schemaVersion:1,components});
const catalog=components.map(c=>{const r=inspectComponent(c);return {id:c.id,name:c.name,part:c.part,family:c.family,params:c.recipe.params,planes:c.planes.length,activePlanes:r.stats.active,volume:r.stats.volume,integer96:machineReport(instancePlanes(c),96).exact,provenance:c.provenance};});
save('catalog-index.json',catalog);
save('crown-brilliant-8.json',generatePreset());save('crown-brilliant-9.json',generatePreset({params:{symmetry:9}}));save('pavilion-line-culet.json',generatePreset({family:'keel',part:'pavilion'}));save('crown-rose.json',generatePreset({family:'rose',params:{symmetry:8,layers:3}}));save('crown-custom.json',editPlane(generatePreset(),generatePreset().planes[0].id,{d:.53}));
const groups=[{id:'example-pavilion',component:generatePreset({part:'pavilion'}),transform:normalizeTransform({translation:[0,0,-.045]})},{id:'example-crown',component:generatePreset(),transform:normalizeTransform({translation:[0,0,.045]})}];
const stock={name:'圆形底胚',kind:'preform',polys:prismSolid(),convex:true,nativeStock:null};
const state={machine:normalizeMachineProfile(),stock,basePlanes:[],nativeDocument:null,groups,draft:groups[1].component,transform:groups[1].transform,editId:groups[1].id};
save('workspace-brilliant.json',{kind:'opengemcutting-component-workspace',schemaVersion:2,state});
save('native-brilliant.json',makeNativeDocument(stock,null,groups));
const polys=cutSolid(stock.polys,groups.flatMap(g=>instancePlanes(g.component,g.transform,g.id)));save('result-brilliant.obj',exportOBJ(polys));
for(const [name,fn] of [['L-shaped',lSolid],['through-hole',ringSolid],['disconnected',disconnectedSolid]])save(`rough-${name}.obj`,exportOBJ(fn()));


save('index-gear-catalog.json',{kind:'opengemcutting-index-gear-catalog',version:1,reviewDate:'2026-09-20',numericalToleranceTeeth:1e-7,gears:GEAR_CATALOG});
const mixed=structuredClone(state);mixed.machine=normalizeMachineProfile({teeth:288});mixed.groups[1].component=generatePreset({params:{symmetry:9}});mixed.draft=mixed.groups[1].component;
save('workspace-eight-nine-288.json',{kind:'opengemcutting-component-workspace',schemaVersion:2,state:mixed});
const ellipse=structuredClone(state);ellipse.transform.scale=[1.25,1,1];
save('workspace-ellipse-review.json',{kind:'opengemcutting-component-workspace',schemaVersion:2,state:ellipse});
const repair=rebuildIntegerComponent(ellipse.draft,ellipse.transform,96);
save('crown-ellipse-integer96.json',repair.component);save('ellipse-reconstruction-audit.json',repair.report);

console.log(`Generated ${fs.readdirSync(dir).filter(f=>/\.(json|obj)$/.test(f)).length} example files, 70 original recipes, ${geometryStats(polys).cutFacets} effective example facets.`);
