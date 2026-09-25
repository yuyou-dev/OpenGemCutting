// Test registration only. No production registry/import refers to this file.
export function secondLaboratory(events) {
  const moduleInfo = { id:'acceptance-probe', moduleVersion:'1.0.0', contractVersion:'1.0.0', entryApiVersion:1 };
  return { id:'probe', moduleId:moduleInfo.id, moduleVersion:moduleInfo.moduleVersion, contractVersion:moduleInfo.contractVersion,
    async load() { events.push('load'); return { moduleInfo, async mount(element, options) {
      events.push({ capabilities:Object.keys(options).sort(), persistence:Object.keys(options.persistence).sort() });
      element.textContent='Temporary acceptance laboratory';
      let disposed=false;
      return { pause(){events.push('pause');}, resume(){events.push('resume');},
        async returnResult(){events.push('return');}, dispose(){if(!disposed){disposed=true;element.textContent='';events.push('dispose');}} };
    }}; }};
}
