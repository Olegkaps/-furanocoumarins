import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const server = await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,server:{middlewareMode:true,ws:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});
after(()=>server.close());
const {loadDrawerStructure,exportDrawerStructure}=await server.ssrLoadModule('/src/SearchApp/drawerHydrogens.ts');
const document = atoms => ({root:{nodes:[{$ref:'mol0'}]},mol0:{type:'molecule',atoms,bonds:[]}});

test('loading tags only bracket hydrogen counts, restores isotope and identity after reorder',async()=>{
 let loaded;
 const editor={setMolecule:async s=>{loaded=JSON.parse(s)},structService:{layout:async({struct})=>{
  assert.equal(struct,'[H]O[1001CH3].[1002C@@H](N)C(=O)O');
  return {struct:JSON.stringify(document([{label:'C',isotope:1002},{label:'O'},{label:'C',isotope:1001},{label:'H'}]))};
 }}};
 await loadDrawerStructure(editor,'[H]O[13CH3].[C@@H](N)C(=O)O');
 assert.deepEqual(loaded.mol0.atoms,[{label:'C',implicitHCount:1},{label:'O'},{label:'C',isotope:13,implicitHCount:3},{label:'H'}]);
});
test('export keeps isotope, chirality and only selected hydrogens; snapshot stays unmodified',async()=>{
 const original=document([{label:'C',isotope:13,implicitHCount:3},{label:'O'},{label:'C',implicitHCount:1}]);
 const editor={getKet:async()=>JSON.stringify(original),structService:{convert:async({struct})=>{
  const tagged=JSON.parse(struct);
  assert.equal(tagged.mol0.atoms[0].isotope,1001);
  assert.equal(tagged.mol0.atoms[2].isotope,1002);
  assert.equal(tagged.mol0.atoms[1].implicitHCount,undefined);
  return {struct:'C[C@@H](O)[1002C@H](F)O[1001CH3]'};
 }}};
 assert.equal(await exportDrawerStructure(editor),'C[C@@H](O)[C@H](F)O[13CH3]');
 assert.equal(original.mol0.atoms[0].isotope,13);
 assert.equal(original.mol0.atoms[0].implicitHCount,3);
});
test('normal unmarked molecules bypass identity conversion',async()=>{
 let loaded;
 await loadDrawerStructure({setMolecule:async s=>{loaded=s}},'[H]OC');
 assert.equal(loaded,'[H]OC');
 assert.equal(await exportDrawerStructure({getKet:async()=>JSON.stringify(document([{label:'C'}])),getSmiles:async()=> 'C'}),'C');
});
test('missing or duplicate identities and incompatible hydrogens fail closed',async()=>{
 for(const result of ['OC','O[1001CH2]C','O[1001CH3].[1001CH3]']){
  const editor={getKet:async()=>JSON.stringify(document([{label:'C',implicitHCount:3}])),structService:{convert:async()=>({struct:result})}};
  await assert.rejects(exportDrawerStructure(editor),/preserve fixed hydrogens/);
 }
 for(const atoms of [[{label:'C'}],[{label:'C',isotope:1001},{label:'C',isotope:1001}]]){
  await assert.rejects(loadDrawerStructure({setMolecule:async()=>assert.fail('must not apply lost constraints'),structService:{layout:async()=>({struct:JSON.stringify(document(atoms))})}},'O[CH3]'),/preserve fixed hydrogens/);
 }
});
