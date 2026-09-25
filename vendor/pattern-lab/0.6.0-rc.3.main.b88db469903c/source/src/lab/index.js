import pkg from '../../package.json' with { type: 'json' };
import { LAB_CONTRACT_VERSION } from '../core/application/labContract.js';

export { mountPatternLab } from './mount.jsx';
export { createLabSession } from '../state/labSession.js';
export const moduleInfo = Object.freeze({
  id: 'facet-pattern-lab', moduleVersion: pkg.version,
  contractVersion: LAB_CONTRACT_VERSION, entryApiVersion: 2,
  react: '19.2.0', reactStrategy: 'bundled-private-root',
});
