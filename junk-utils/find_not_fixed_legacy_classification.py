import pandas as pd
from functools import partial

filename = "C:/Users/kapsh/Downloads/Furanocoumarins in Apiaceae.xlsx"
sheet = "Species"

d = pd.read_excel(filename, sheet)
d.fillna("", inplace=True)

with open("out.txt", "w") as f:
    print = partial(print, file=f)

    class Specie:
        comapre_fields = [
            "familia",
            "subfamily",
            "superclade",
            "tribe",
            "clade",
            "subtribe",
            "genus",
            "species",
        ]

        def __init__(
            self,
            lsid: str,
            familia: str,
            subfamily: str,
            superclade: str,
            tribe: str,
            clade: str,
            subtribe: str,
            genus: str,
            species: str,
        ) -> None:
            self.lsid = lsid
            self.familia = familia
            self.subfamily = subfamily
            self.superclade = superclade
            self.tribe = tribe
            self.clade = clade
            self.subtribe = subtribe
            self.genus = genus
            self.species = species

        def __eq__(self, other) -> bool:
            diff_fields = []
            self_values = []
            other_values = []
            for field in self.comapre_fields:
                s_val: str = getattr(self, field)
                o_val: str = getattr(other, field)
                if s_val.strip() != o_val.strip():
                    diff_fields.append(field)
                    self_values.append(s_val)
                    other_values.append(o_val)

            if len(diff_fields) > 0:
                print("=" * 10)
                print(f"for lsid {self.lsid} has diff:")
                print(*diff_fields, sep="\t")
                print(*self_values, sep="\t")
                print(*other_values, sep="\t")

            return len(diff_fields) == 0


    original_rows: dict[str, Specie] = {}
    original_cols = [
        "lsid_original",
        "familia",
        "subfamily",
        "superclade",
        "tribe",
        "clade",
        "subtribe",
        "genus_original",
        "species_original",
    ]
    assert Specie(*original_cols)

    pimenov_rows: dict[str, Specie] = {}
    pimenov_cols = [
        "lsid_pimenov",
        "familia",
        "subfamily",
        "superclade",
        "tribe",
        "clade",
        "subtribe",
        "genus_pimenov",
        "species_pimenov",
    ]
    assert Specie(*pimenov_cols)

    powo_rows: dict[str, Specie] = {}
    powo_cols = [
        "lsid_accepted",
        "familia",
        "subfamily",
        "superclade",
        "tribe",
        "clade",
        "subtribe",
        "genus_accepted",
        "species_accepted",
    ]
    assert Specie(*powo_cols)

    for _, line in d.iterrows():
        for rows_dict, cols in zip(
            (original_rows, pimenov_rows, powo_rows),
            (original_cols, pimenov_cols, powo_cols),
        ):
            if line[cols[0]] == "":
                continue

            curr_values = [line[c] for c in cols]
            curr_original = [line[c] for c in original_cols]
            for i in range(len(curr_values)):
                if curr_values[i] == "":
                    curr_values[i] = curr_original[i]

            rows_dict[curr_values[0]] = Specie(*curr_values)

    for rows_dict in (pimenov_rows, powo_rows):
        for lsid, specie in rows_dict.items():
            original_specie = original_rows.get(lsid, None)

            if original_specie is None:
                print("="*10)
                print(f"not found lsid {lsid}")
                continue

            original_rows[lsid] == specie
