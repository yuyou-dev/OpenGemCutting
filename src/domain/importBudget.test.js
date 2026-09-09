import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFileBudget,assertDocumentImportBudget,IMPORT_BUDGET} from './importBudget.js';
import {parseMeshOBJ} from './mesh/index.js';
test('new import budgets distinguish bytes, CUT planes and stock vertices before geometry',()=>{
 assert.doesNotThrow(()=>assertFileBudget({size:IMPORT_BUDGET.bytes}));
 assert.throws(()=>assertFileBudget({size:IMPORT_BUDGET.bytes+1}),/20 MiB/);
 assert.throws(()=>assertDocumentImportBudget({facets:{length:4097}}),/CUT/);
 assert.throws(()=>assertDocumentImportBudget({stock:{mesh:{vertices:{length:20001}}}}),/顶点/);
 assert.doesNotThrow(()=>assertDocumentImportBudget({facets:[],stock:{mesh:{faces:[]}}}));
});
test('OBJ rejects excess unused source vertices before topology validation',()=>{
 assert.throws(()=>parseMeshOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\n',{maxVertices:2}),/顶点/);
});
