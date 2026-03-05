import pandas as pd

filename = "C:/Users/kapsh/Downloads/Furanocoumarins in Apiaceae (1).xlsx"
sheet = "Structures"
column = "positioned_radicals"

d = pd.read_excel(filename, sheet)

r = d[column]

values = set()

bad_values = []
for v in r.values:
    if not isinstance(v, str):
        bad_values.append(v)
        continue

    for i in v.split("_"):
        values.add(i)

print(f"{bad_values=}")
print(*values)
