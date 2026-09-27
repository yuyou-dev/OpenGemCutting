import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryView } from '../src/application/viewModels.js';
test('built-in library retains crown/pavilion counts and search after personal library removal',()=>{
    const ui={library:'crown',filter:'all',search:'',selectedPreset:null};
    assert.equal(libraryView(ui,96).cards.length,38);
    assert.equal(libraryView({...ui,library:'pavilion'},96).cards.length,32);
    const result=libraryView({...ui,search:'经典八向'},96);
    assert.equal(result.cards.length,1); assert.equal(result.cards[0].gearNote,'96 整齿');
});
