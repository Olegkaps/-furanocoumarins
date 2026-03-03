rads = """INSERT""".split("\n")

header = rads[0].split("\t")

result_pos = []
result_neg = []

for row in rads[1:]:
    pos_val = []
    neg_val = []
    for i, item in enumerate(row.split("\t")):
        if item == "":
            continue
        pos_val.append(header[i] + "=" + item)
        neg_val.append(item)
    result_neg.append("_".join(neg_val))
    result_pos.append("_".join(pos_val))

with open("result-cols", "w") as f:
    print("radicals\tpositioned_radicals", file=f)
    for i in range(len(result_neg)):
        print(f"{result_neg[i]}\t{result_pos[i]}", file=f)
