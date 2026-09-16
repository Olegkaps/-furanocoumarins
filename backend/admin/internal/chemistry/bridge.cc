//go:build rdkit && cgo

#include "bridge.h"
#include <GraphMol/SmilesParse/SmilesParse.h>
#include <GraphMol/SmilesParse/SmartsWrite.h>
#include <GraphMol/SmilesParse/SmilesWrite.h>
#include <GraphMol/Substruct/SubstructMatch.h>
#include <GraphMol/QueryAtom.h>
#include <GraphMol/QueryBond.h>
#include <GraphMol/QueryOps.h>
#include <memory>

struct Molecule {
  std::unique_ptr<RDKit::RWMol> mol;
  std::string identity;
};

extern "C" void* furano_parse(const char* smiles, int query, int bonds, int hetero) {
  try {
    RDKit::SmilesParserParams params;
    params.parseName = false;
    params.allowCXSMILES = false;
    std::unique_ptr<RDKit::RWMol> mol(RDKit::SmilesToMol(smiles, params));
    if (!mol || mol->getNumAtoms() == 0 || mol->getNumAtoms() > (query ? 64u : 512u)) return nullptr;
    const auto identity = RDKit::MolToSmiles(*mol);
    if (query) {
      auto source = std::move(mol);
      mol.reset(RDKit::SmartsToMol(RDKit::MolToSmarts(*source)));
      if (!mol) return nullptr;
      for (unsigned int n = 0; n < mol->getNumAtoms(); ++n) {
        const auto* atom = source->getAtomWithIdx(n);
        RDKit::QueryAtom replacement(*static_cast<const RDKit::QueryAtom*>(mol->getAtomWithIdx(n)));
        if (hetero && atom->getAtomicNum() == 6 && atom->getFormalCharge() == 0 && atom->getIsotope() == 0) {
          auto* heavy = RDKit::makeAtomNumQuery<RDKit::ATOM_LESS_QUERY>(1, "AtomAtomicNumGreater");
          replacement.setQuery(heavy);
          // Preserve explicit aromatic intent. Ordinary SMILES carbon becomes
          // an atomic-number query: adding an aliphatic predicate here would
          // wrongly remove aromatic hits when hetero matching is enabled.
          if (atom->getIsAromatic()) replacement.expandQuery(RDKit::makeAtomAromaticQuery());
          replacement.expandQuery(RDKit::makeAtomFormalChargeQuery(0));
          // Bracketed hydrogens are a local substitution constraint. Retain
          // O[CH3] (methyl, not ethyl) even when carbon may match a heteroatom.
          if (atom->getNumExplicitHs() > 0)
            replacement.expandQuery(RDKit::makeAtomHCountQuery(atom->getNumExplicitHs()));
        }
        mol->replaceAtom(n, &replacement);
      }
      if (!bonds) {
        for (unsigned int n = 0; n < mol->getNumBonds(); ++n) {
          const auto* bond = mol->getBondWithIdx(n);
          if (bond->getBondType() == RDKit::Bond::SINGLE) {
            RDKit::QueryBond replacement(*bond);
            replacement.setQuery(RDKit::makeBondNullQuery());
            mol->replaceBond(n, &replacement);
          }
        }
      }
    }
    return new Molecule{std::move(mol), identity};
  } catch (...) { return nullptr; }
}
extern "C" void furano_free(void* molecule) { delete static_cast<Molecule*>(molecule); }
extern "C" int furano_match(void* target, void* query, int stereo) {
  try {
    const auto& t = *static_cast<Molecule*>(target);
    const auto& q = *static_cast<Molecule*>(query);
    // Canonical isomeric identity is independent of atom numbering. RDKit 2022
    // can miss an identical fused stereochemical ring under a different ordering.
    if (t.identity == q.identity) return 1;
    RDKit::SubstructMatchParameters params;
    params.useChirality = stereo;
    params.maxMatches = 1;
    params.numThreads = 1;
    return !RDKit::SubstructMatch(*t.mol, *q.mol, params).empty();
  } catch (...) { return -1; }
}


// Every simple path in a query embeds into a distinct target path. Counting
// canonical path labels and recording occurrence thresholds is therefore
// monotone under subgraph matching. Hash collisions only add false positives.
// Base features drop the relaxed label dimension. Additional anchored paths
// retain explicit heteroatoms and multiple bonds without constraining wildcard
// positions. Aromatic carbon is not a separate atom label.
#include <algorithm>
#include <functional>
#include <map>
#include <set>
#include <vector>
extern "C" int furano_atoms(void* molecule) {
  return static_cast<Molecule*>(molecule)->mol->getNumAtoms();
}
extern "C" int furano_bonds(void* molecule) {
  return static_cast<Molecule*>(molecule)->mol->getNumBonds();
}
extern "C" int furano_fingerprint(void* molecule, int mode, int32_t* output, int capacity) {
  try {
    const auto& mol = *static_cast<Molecule*>(molecule)->mol;
    // A SMILES wildcard becomes an unconstrained query atom in MolToSmarts.
    // Conservatively bypass screening in all modes for wildcard structures.
    for (const auto atom : mol.atoms()) if (!atom->getAtomicNum()) return -1;
    std::map<std::vector<unsigned>, unsigned> counts;
    std::vector<bool> visited(mol.getNumAtoms());
    std::vector<unsigned> path;
    std::vector<unsigned> anchoredPath;
    unsigned traversed = 0;
    bool overflow = false;
    std::function<void(unsigned,unsigned)> walk = [&](unsigned at, unsigned depth) {
      if (overflow) return;
      if (++traversed > 100000) { overflow = true; return; }
      visited[at] = true;
      const auto element = mol.getAtomWithIdx(at)->getAtomicNum();
      path.push_back((mode & 2) ? 0 : element);
      anchoredPath.push_back(element == 6 ? 0 : element);
      auto reverse = path;
      std::reverse(reverse.begin(), reverse.end());
      ++counts[std::min(path, reverse)];
      // At most two exact non-carbon/non-single anchors per wildcard path.
      // Emit every subset on BOTH sides: relaxing a query carbon or single
      // bond can introduce extra target anchors but cannot remove its subset.
      // Prefix separates these labels from the existing full-label paths.
      std::vector<unsigned> masked(anchoredPath.size(), 0);
      auto anchorFeature = [&]() {
        if (overflow) return;
        if (++traversed > 100000) { overflow = true; return; }
        auto reversed = masked;
        std::reverse(reversed.begin(), reversed.end());
        auto key = std::min(masked, reversed);
        key.insert(key.begin(), 1002);
        ++counts[key];
      };
      for (unsigned a = 0; a < anchoredPath.size(); ++a) {
        if (!anchoredPath[a]) continue;
        masked[a] = anchoredPath[a];
        anchorFeature();
        for (unsigned b = a + 1; b < anchoredPath.size(); ++b) {
          if (!anchoredPath[b]) continue;
          masked[b] = anchoredPath[b];
          anchorFeature();
          masked[b] = 0;
        }
        masked[a] = 0;
      }
      if (depth < 4) {
        for (const auto bond : mol.atomBonds(mol.getAtomWithIdx(at))) {
          unsigned next = bond->getOtherAtomIdx(at);
          if (visited[next]) continue;
          path.push_back((mode & 1) ? static_cast<unsigned>(bond->getBondType()) : 0);
          anchoredPath.push_back(bond->getBondType() == RDKit::Bond::SINGLE ? 0 : static_cast<unsigned>(bond->getBondType()));
          walk(next, depth + 1);
          anchoredPath.pop_back();
          path.pop_back();
        }
      }
      path.pop_back();
      anchoredPath.pop_back();
      visited[at] = false;
    };
    for (unsigned i = 0; i < mol.getNumAtoms() && !overflow; ++i) walk(i, 0);
    // Degree thresholds count atoms with at least k neighbours, not exact
    // degrees: substitution can add neighbours without invalidating a query.
    for (const auto atom : mol.atoms()) {
      for (unsigned degree = 1; degree <= atom->getDegree(); ++degree)
        ++counts[{1000, degree}];
    }
    // All simple cycles up to eight atoms, not an SSSR basis (which is not
    // subgraph-monotone). Start at the lowest atom id to count each cycle twice,
    // once per direction, independently of molecular atom ordering.
    std::vector<std::vector<unsigned>> cycles;
    std::vector<unsigned> cycleAtoms;
    std::function<void(unsigned,unsigned,unsigned)> cycle = [&](unsigned start, unsigned at, unsigned depth) {
      if (overflow) return;
      if (++traversed > 100000) { overflow = true; return; }
      visited[at] = true;
      cycleAtoms.push_back(at);
      for (const auto bond : mol.atomBonds(mol.getAtomWithIdx(at))) {
        unsigned next = bond->getOtherAtomIdx(at);
        if (next == start && depth >= 2) {
          ++counts[{1001, depth + 1}];
          if (cycleAtoms[1] < at) cycles.push_back(cycleAtoms);
        }
        else if (next > start && !visited[next] && depth < 7) cycle(start, next, depth + 1);
      }
      cycleAtoms.pop_back();
      visited[at] = false;
    };
    for (unsigned i = 0; i < mol.getNumAtoms() && !overflow; ++i) cycle(i, i, 0);
    // Pairwise intersections of ALL simple cycles, not a ring basis. A
    // subgraph embedding preserves each selected cycle pair's shared vertices
    // and edges even if the target has additional rings or substituents.
    std::vector<std::vector<std::pair<unsigned, std::vector<unsigned>>>> attachments(cycles.size());
    for (unsigned a = 0; a < cycles.size() && !overflow; ++a) {
      for (unsigned b = a + 1; b < cycles.size(); ++b) {
        if (++traversed > 100000) { overflow = true; break; }
        unsigned sharedAtoms = 0, sharedEdges = 0;
        std::vector<unsigned> edgesA, edgesB;
        for (unsigned i = 0; i < cycles[a].size(); ++i) {
          const unsigned at = cycles[a][i], next = cycles[a][(i + 1) % cycles[a].size()];
          if (std::find(cycles[b].begin(), cycles[b].end(), at) != cycles[b].end()) ++sharedAtoms;
          for (unsigned j = 0; j < cycles[b].size(); ++j) {
            const unsigned bt = cycles[b][j], bn = cycles[b][(j + 1) % cycles[b].size()];
            if ((at == bt && next == bn) || (at == bn && next == bt)) {
              ++sharedEdges; edgesA.push_back(i); edgesB.push_back(j);
            }
          }
        }
        if (sharedEdges) {
          attachments[a].push_back({static_cast<unsigned>(cycles[b].size()), edgesA});
          attachments[b].push_back({static_cast<unsigned>(cycles[a].size()), edgesB});
        }
        if (sharedAtoms) ++counts[{1003, static_cast<unsigned>(std::min(cycles[a].size(), cycles[b].size())),
          static_cast<unsigned>(std::max(cycles[a].size(), cycles[b].size())), sharedAtoms, sharedEdges}];
      }
    }
    // Positions of two fusions around a central cycle distinguish angular
    // from linear ring systems. Enumerate actual selected cycles and shared
    // edges; shortest molecular paths or perceived ring bases are not monotone.
    for (unsigned central = 0; central < cycles.size() && !overflow; ++central) {
      const auto& attached = attachments[central];
      for (unsigned a = 0; a < attached.size() && !overflow; ++a) {
        for (unsigned b = a + 1; b < attached.size() && !overflow; ++b) {
          for (auto edgeA : attached[a].second) {
            for (auto edgeB : attached[b].second) {
              if (++traversed > 100000) { overflow = true; break; }
              unsigned distance = edgeA > edgeB ? edgeA - edgeB : edgeB - edgeA;
              distance = std::min(distance, static_cast<unsigned>(cycles[central].size()) - distance);
              ++counts[{1004, static_cast<unsigned>(cycles[central].size()),
                std::min(attached[a].first, attached[b].first),
                std::max(attached[a].first, attached[b].first), distance}];
            }
            if (overflow) break;
          }
        }
      }
    }
    // Never publish a truncated target feature set: that causes false negatives.
    if (overflow) return -1;
    std::set<int32_t> features;
    for (const auto& entry : counts) {
      for (unsigned threshold = 1; threshold <= entry.second; threshold = threshold < 8 ? threshold + 1 : threshold * 2) {
        uint32_t hash = 2166136261u;
        auto mix = [&](unsigned value) {
          for (int n = 0; n < 4; ++n) { hash ^= (value >> (n * 8)) & 255; hash *= 16777619u; }
        };
        mix(entry.first.size());
        for (auto value : entry.first) mix(value);
        mix(threshold);
        features.insert(static_cast<int32_t>((hash & 0x7fffffffu) | 1u));
      }
    }
    if (features.size() > static_cast<unsigned>(capacity)) return -1;
    std::copy(features.begin(), features.end(), output);
    return features.size();
  } catch (...) { return -1; }
}
