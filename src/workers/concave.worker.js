import { createFacetingDocument } from '../domain/faceting.js';
import { evaluateConcaveUpdate } from '../application/concaveEvaluation.js';
let base;
self.onmessage = ({ data }) => {
  try {
    if (data.document) base = createFacetingDocument(data.document);
    self.postMessage({ result: evaluateConcaveUpdate(base, data.operation) });
  } catch (error) { self.postMessage({ error: error.message }); }
};
