# Regenerate with Python RDKit 2022.09.3 (Debian bookworm python3-rdkit):
# python3 generate_oracle.py workbook-oracle.json.gz regenerated.json.gz
# This independent Python query construction must not call the native bridge.
import json,gzip,hashlib
from rdkit import Chem,rdBase
from rdkit.Chem import rdqueries
from rdkit import RDLogger
RDLogger.DisableLog('rdApp.*')
import sys
# Rebuild from an extracted source JSON, or the existing fixture (retains source
# strings and spreadsheet row provenance without requiring the private workbook).
if sys.argv[1].endswith('.gz'):
 with gzip.open(sys.argv[1],'rt') as f: old=json.load(f)
 source={k:old[k] for k in ('source','sha256','sheet_counts')}
 source['structures']=[{'smiles':e['smiles'],'locations':e['locations']} for e in old['valid']+old['invalid']]
else:
 source=json.load(open(sys.argv[1]))
valid=[]; invalid=[]
for entry in source['structures']:
 params=Chem.SmilesParserParams(); params.parseName=False; params.allowCXSMILES=False
 m=None if any(c.isspace() for c in entry['smiles']) else Chem.MolFromSmiles(entry['smiles'],params)
 if m is None: invalid.append(entry);continue
 valid.append((entry,m))
queries=['C','CC','CO','CN','C=C','C#N','C1CCCCC1','C1CCCCCC1','C1CCCCCCC1','c1ccccc1','c1ccncc1','C1CCOC1','O=C1OC=CC=C1','C1=CC2=C(C=CO2)C3=C1C=CC(=O)O3','C1=CC(=O)OC2=CC3=C(C=CO3)C=C21','C[C@H](O)C(=O)O','C[C@@H](O)C(=O)O','F/C=C/F','F/C=C\\F','[13CH3]O','[NH3+]CC(=O)[O-]','O.O','O[CH3]','c1ccc(O[CH3])cc1','c1ccc(O[CH2][CH3])cc1','[OH]c1ccccc1','c1cc([CH3])ccc1','c1ccc(OC)cc1']
def query(smiles,bond_order,hetero):
 m=Chem.MolFromSmiles(smiles)
 # Convert molecule into query graph, retaining RDKit's chemical predicates.
 q=Chem.RWMol(Chem.MolFromSmarts(Chem.MolToSmarts(m)))
 if hetero:
  for a in m.GetAtoms():
   if a.GetAtomicNum()==6 and a.GetIsotope()==0 and a.GetFormalCharge()==0:
    qa=rdqueries.AtomNumGreaterQueryAtom(1)
    if a.GetIsAromatic(): qa.ExpandQuery(rdqueries.IsAromaticQueryAtom())
    qa.ExpandQuery(rdqueries.FormalChargeEqualsQueryAtom(0))
    if a.GetNumExplicitHs(): qa.ExpandQuery(rdqueries.HCountEqualsQueryAtom(a.GetNumExplicitHs()))
    qa.SetChiralTag(a.GetChiralTag())
    q.ReplaceAtom(a.GetIdx(),qa)
 if not bond_order:
  for b in m.GetBonds():
   if b.GetBondType()==Chem.BondType.SINGLE:
    q.ReplaceBond(b.GetIdx(),Chem.BondFromSmarts('~'))
 return q
cases=[]
for s in queries:
 for bond in (False,True):
  for hetero in (False,True):
   for stereo in (False,True):
    q=query(s,bond,hetero)
    matches=[i for i,(_,m) in enumerate(valid) if m.HasSubstructMatch(q,useChirality=stereo)]
    cases.append({'query':s,'bond_order':bond,'hetero_atoms':hetero,'stereochemistry':stereo,'matches':matches})
output={'source':source['source'],'sha256':source['sha256'],'rdkit':rdBase.rdkitVersion,'sheet_counts':source['sheet_counts'],'valid':[dict(e,canonical=Chem.MolToSmiles(m),atoms=m.GetNumAtoms(),reordered=Chem.MolToSmiles(Chem.RenumberAtoms(m,list(reversed(range(m.GetNumAtoms())))),canonical=False)) for e,m in valid],'invalid':invalid,'cases':cases}
with gzip.open(sys.argv[2],'wt') as f: json.dump(output,f,separators=(',',':'))
print(json.dumps({'valid':len(valid),'invalid':len(invalid),'cases':len(cases),'comparisons':len(valid)*len(cases),'invalid_examples':invalid[:4]}))
