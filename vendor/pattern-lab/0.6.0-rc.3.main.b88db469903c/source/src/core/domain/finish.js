export const POLISHED=Object.freeze({version:1,model:'ggx-dielectric',state:'polished',alpha:0});
export function finish(value=POLISHED){
 if(value.model!==undefined&&value.model!=='ggx-dielectric')throw new Error('UNSUPPORTED_SURFACE_MODEL');
 const state=value.state||'polished';if(!['polished','frosted'].includes(state))throw new Error('INVALID_FINISH');
 const alpha=state==='polished'?0:(value.alpha??.25);if(!Number.isFinite(alpha)||alpha<.001||alpha>1){if(state!=='polished')throw new RangeError('Frosted GGX alpha must be .001..1');}
 if(value.scatter!==undefined&&(!Number.isFinite(value.scatter)||value.scatter<0||value.scatter>1))throw new RangeError('Surface scatter must be 0..1');
 return {version:1,model:'ggx-dielectric',state,alpha,...(value.scatter===undefined?{}:{scatter:value.scatter})};
}
export function resolveFinish(plan,plane){return finish(plan.surfaceOverrides?.[plane.id]??plane.finish??POLISHED);}
export function setFinish(plan,id,value){if(typeof id!=='string'||!id)throw new Error('FACET_ID_REQUIRED');return {...plan,surfaceOverrides:{...plan.surfaceOverrides,[id]:finish(value)}};}
