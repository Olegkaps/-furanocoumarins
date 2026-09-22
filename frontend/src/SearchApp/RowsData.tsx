class DataRows {
    total_length: number
    specie_row: Map<string, string>
    specie_key: string
    specie_val: string
    specie_count_key: string
    specie_count_val: string
    chemical_row: Map<string, string>
    chemical_key: string
    chemical_val: string
    chemical_count_key: string
    chemical_count_val: string
    value_rows: Array<Map<string, string>>

    constructor(
        specie_row: Map<string, string>, specie_key: string,
        specie_count_key: string,
        chem_row: Map<string, string>, chemical_key: string,
        chemical_count_key: string,
        rows: Array<Map<string, string>>,
    ) {
        this.specie_row = specie_row
        this.specie_key = specie_key
        this.specie_val = this.specie_row.get(this.specie_key) || ""
        this.specie_count_key = specie_count_key
        this.specie_count_val = this.specie_row.get(this.specie_count_key) || ""
        this.chemical_row = chem_row
        this.chemical_key = chemical_key
        this.chemical_val = this.chemical_row.get(this.chemical_key) || ""
        this.chemical_count_key = chemical_count_key
        this.chemical_count_val = this.chemical_row.get(this.chemical_count_key) || ""
        this.value_rows = rows
        this.total_length = rows.length
    }

    add_row(row: Map<string, string>) {
        this.value_rows.push(row)
        this.total_length += 1
    }
}


export default DataRows;
