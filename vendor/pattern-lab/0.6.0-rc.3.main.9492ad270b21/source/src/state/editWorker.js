import { compilePlan } from '../core/application/patternPlan.js';
import { solveEdit } from './editOperation.js';

let revision = null, compiled = null;
self.onmessage = ({ data }) => {
  try {
    if (revision !== data.revision) {
      compiled = compilePlan(data.plan);
      revision = data.revision;
    }
    self.postMessage({ id: data.id, result: solveEdit(data, compiled) });
  } catch (error) {
    self.postMessage({ id: data.id, result: { error: error.code ?? 'EDIT_FAILED', message: error.message } });
  }
};
