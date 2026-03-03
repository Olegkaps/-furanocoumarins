import pandas as pd

filename = "C:/Users/kapsh/Downloads/Копия Furanocoumarins in Apiaceae (4).xlsx"
sheet = "Structures"
column = "type_structure"

d = pd.read_excel(filename, sheet)

r = d[column]

values = set()

for v in r.values:
    for i in v.split("_"):
        values.add(i)

print(values)
