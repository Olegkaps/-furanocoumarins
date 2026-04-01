rads = """INSERT""".split("\n")

header = rads[0].split("\t")

result_pos = []
result_neg = []

position_filter = {
    "5-1": "5",
    "8-1": "8",
    "6-1": "6",
    "2'-1": "2`",
    "3'-1": "3`",
}

ignored_positions = set[str]()

raidicals_filter = {
    "C1": "methyl",
    "Epoxy": "epoxy",
    "OEpoxy": "epoxy",
    "OAcetonide": "acetonide",
    "OC5Acetonide": "acetonide",
    "OC1": "methoxy",
    "OOC1": "methoxy",
    "OC12": "fattyacid",
    "OOC12": "fattyacid",
    "OC14": "fattyacid",
    "OOC14": "fattyacid",
    "OC18": "fattyacid",
    "OOC18": "fattyacid",
    "OC10": "geranoxy",
    "OOC10": "geranoxy",
    "OC5": "isoprenoxy",
    "OOC5": "isoprenoxy",
    "OFalcarindiol": "acetylene",
    "OH": "hydroxy",
    "OC2": "acetoxy",
    "OOC2": "acetoxy",
    "OO": "ester",
    "Coum": "coumarin",
    "C1Coum": "coumarin",
    "CCoum": "coumarin",
    "OCoum": "coumarin",
    "OOC3Coum": "coumarin",
    "Phenyl": "phenyl",
    "OOPhenyl": "phenyl",
    "OOC2Phenyl": "phenyl",
    "OOC1Phenyl": "phenyl",
    "OC3Phenyl": "phenyl",
    "OOC3Phenyl": "phenyl",
}

ignored_radicals = set[str]()

for row in rads[1:]:
    pos_val = []
    neg_val = []
    for i, item in enumerate(row.split("\t")):
        if item == "":
            continue

        if position := position_filter.get(header[i]):
            pos_val.append(position)
        else:
            ignored_positions.add(header[i])

        if alias := raidicals_filter.get(item):
            neg_val.append(alias)
        else:
            if len(item) > 1:
                neg_val.append("other")
            ignored_radicals.add(item)

    result_neg.append("_".join(set(neg_val)))
    result_pos.append("_".join(set(pos_val)))

with open("result-cols.txt", "w") as f:
    print("radicals\tpositioned_radicals", file=f)
    for i in range(len(result_neg)):
        print(f"{result_neg[i]}\t{result_pos[i]}", file=f)


print(f"Ignored radicals: {ignored_radicals}")
print(f"Ignored positions: {ignored_positions}")
