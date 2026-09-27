import { fitReferenceRim } from '../domain/rim-fit.js';
import { previewPlanesOf } from './viewModels.js';

// Read the live store at click time; no new method on a retained store instance.
export function fitRim(store) {
    if (!store.unlocked()) return;
    const { model } = store.getState();
    const result = fitReferenceRim(model.draft, model.transform, model.stock, previewPlanesOf(model));
    store.onTransform(result.transform);
    return result;
}
