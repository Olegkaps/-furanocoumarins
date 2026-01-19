class DataRows {
    total_length: number
    key_row: Map<string, string>
    value_rows: Array<Map<string, string>>

    constructor(key_row: Map<string, string>, rows: Array<Map<string, string>>) {
        this.key_row = key_row
        this.value_rows = rows
        this.total_length = rows.length
    }

    add_row(row: Map<string, string>) {
        this.value_rows.push(row)
        this.total_length += 1
    }
}


export default DataRows;