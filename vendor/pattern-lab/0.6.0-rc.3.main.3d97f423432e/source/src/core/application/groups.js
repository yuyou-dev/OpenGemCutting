import { resolveFinish, setFinish, finish } from '../domain/finish.js';

/** Facet groups come from plan.planes[].group (C1..Cn, G1, P1). The table has
 * none; bevel planes carry `parents` but no group, so they never appear here. */
export function groupsInPlan(plan) {
  const order = [];
  const byName = new Map();
  for (const p of plan.planes) {
    if (!p.group) continue;
    if (!byName.has(p.group)) {
      byName.set(p.group, []);
      order.push(p.group);
    }
    byName.get(p.group).push(p.id);
  }
  return order.map((name) => ({ name, ids: byName.get(name) }));
}

/** One surface-state change for many facet identities; frosted alpha defaults
 * to the plan's bevel alpha, matching the single-face control behavior. */
export function setFinishMany(plan, ids, value) {
  const f = finish({ state: value?.state ?? 'polished', alpha: value?.alpha ?? plan.bevel?.alpha, ...(value?.scatter===undefined?{}:{scatter:value.scatter}) });
  return ids.reduce((next, id) => setFinish(next, id, f), plan);
}

/** Flip each facet's current finish (resolved against compiled planes and the
 * running override set); ids missing from `planes` are skipped. */
export function invertFinishMany(plan, planes, ids) {
  const byId = new Map(planes.map((p) => [p.id, p]));
  return ids.reduce((next, id) => {
    const plane = byId.get(id);
    if (!plane) return next;
    const cur = resolveFinish(next, plane);
    return setFinish(next, id, { state: cur.state === 'frosted' ? 'polished' : 'frosted', alpha: next.bevel?.alpha });
  }, plan);
}

/** Remove a group name from every plane carrying it; all other plane fields
 * and planes are preserved. */
export function dissolveGroup(plan, groupName) {
  return {
    ...plan,
    planes: plan.planes.map((p) => {
      if (p.group !== groupName) return p;
      const q = { ...p };
      delete q.group;
      return q;
    }),
  };
}
