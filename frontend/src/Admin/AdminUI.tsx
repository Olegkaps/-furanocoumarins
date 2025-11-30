import React, { useState, useEffect } from 'react';
import { api, getToken, isTokenExists } from './utils';
import { Navigate } from 'react-router-dom';
import {CirclePlus, TrashBin, CrownDiamond} from '@gravity-ui/icons';

class Table {
    version: string
    created_at: string
    is_active: boolean
    is_ok: boolean

    constructor(
        version: string,
        created_at: string,
        is_active: boolean,
        is_ok: boolean,
    ) {
        this.version = version
        this.created_at = created_at
        this.is_active = is_active
        this.is_ok = is_ok
    }
}


const AdminPage: React.FC = () => {
    const [tables, setTables] = useState(Array<Table>);

    const [showCreateForm, setShowCreateForm] = useState(false);
    
    const [googleSheetFile, setGoogleSheetFile] = useState<File>();
    const [googleMetaList, setGoogleMetaList] = useState('');

    if (!isTokenExists()) {
        return <Navigate to="/login" />
    }
    let token = getToken();

    const fetchTables = async () => {
        let token = getToken();
        const response = await api.post('/get-tables-list', {}, {
            headers: { Authorization: `Bearer ${token}` }
        }).catch((err) => {return err.response});

        setTables(response.data?.sort(
            (a: any, b: any) => {
            let date_b = new Date(b.created_at)
            let date_a = new Date(a.created_at)
            if (date_a < date_b) return -1;
            if (date_a > date_b) return 1;
        }));

        if (response?.status === 401) {
            setTimeout(() => window.location.href = '/login', 3000);
            alert('Anauthorized...');
        } else if (response?.status >= 400) {
            alert('Error request')
        }
    };

    useEffect(() => {
        fetchTables();
    }, [token]);

    const handleCreateTable = async (e: React.FormEvent) => {
        e.preventDefault();
        let token = getToken();
        var bodyFormData = new FormData();
        
        if (!googleSheetFile) {
            alert("error: no file")
            return;
        }
        bodyFormData.append("file", googleSheetFile)
        bodyFormData.append("meta", googleMetaList)

        let response = await api.post('/create-table', bodyFormData, {
            headers: { Authorization: `Bearer ${token}` }
        }).catch((err) => {return err.response});

        if (response?.status === 400) {
            alert('Incorrect link');
        }

        setShowCreateForm(false);
        setTimeout(() => fetchTables(), 10000);
    };

    const handleSetActiveTable = async (e: React.FormEvent, tableTimestamp: string) => {
        e.preventDefault();
        let token = getToken();
        var bodyFormData = new FormData();
        
        bodyFormData.append("table_timestamp", tableTimestamp)
        console.log(tableTimestamp)
        await api.post('/make-table-active', bodyFormData, {
            headers: { Authorization: `Bearer ${token}` }
        }).catch((err) => {return err.response});

        setTimeout(() => fetchTables(), 5000);
    };

    const handleDeleteTable = async (e: React.FormEvent, tableTimestamp: string) => {
        e.preventDefault();
        let token = getToken();
        var bodyFormData = new FormData();

        bodyFormData.append("table_timestamp", tableTimestamp)
        await api.post(`/delete-table`, bodyFormData, {
            headers: { Authorization: `Bearer ${token}` }
        }).catch((err) => {return err.response});

        setTimeout(() => fetchTables(), 5000);
    };

    const handleDeleteBadTables = async (e: React.FormEvent) => {
        e.preventDefault();
        let token = getToken();
        var bodyFormData = new FormData();

        await api.post(`/delete-tables`, bodyFormData, {
            headers: { Authorization: `Bearer ${token}` }
        }).catch((err) => {return err.response});

        setTimeout(() => fetchTables(), 10000);
    };

    return (
        <div style={{ padding: '20px' }}>
            <h2 style={{ fontSize: 'xx-large', position: 'absolute', top: '5%', left: '40%' }}>Existing Tables: {tables.length}/10</h2>
            <div style={{border: '1px solid #818485ff', borderRadius: "10%", backgroundColor: "#e9fafeff", width: "10%", padding: "10px", position: 'absolute', top: "5%", left: "10%"}}>
                <p style={{paddingLeft: "15px"}}><b>Clear tables</b></p>
                <button onClick={handleDeleteBadTables}
                    style={{
                        borderRadius: "15%",
                        backgroundColor: "#f4fff2ff",
                        borderColor: "grey",
                        marginLeft: "35%",
                        marginRight: "35%",
                    }}>
                    <i className="fas fa-trash"></i> <TrashBin {...{style: {width: '30px', height: '30px'}}}/>
                </button>
            </div>

            <div style={{height: "90px"}}></div>

            {showCreateForm && (
                <form onSubmit={handleCreateTable}
                    style={{
                        position: 'absolute',
                        backgroundColor: 'grey',
                        opacity: "90%",
                        top: '0',
                        left: '0',
                        width: "100%",
                        height: "100%",
                    }}>
                    <div style={{
                        position: 'absolute',
                        top: '35%',
                        left: '40%',
                    }}>
                        <p style={{ color: '#e6dedeff' }}>Create table from XLSX file</p>
                        <input 
                            type="file" 
                            required={true}
                            onChange={(e) => setGoogleSheetFile(e.target.files?.[0])} 
                            placeholder="Google sheet file"
                            style={{ 
                                padding: '10px',
                                marginBottom: '10px',
                            }}
                        />
                        <br></br>
                        <input 
                            type="text" 
                            required={true}
                            value={googleMetaList} 
                            onChange={(e) => setGoogleMetaList(e.target.value)} 
                            placeholder="List with metadata"
                            style={{ 
                                padding: '10px',
                                marginBottom: '10px',
                            }}
                        />
                        <br></br>
                        <button style={{ position: 'relative', left: '30%', }} type="submit">Create</button>
                    </div>
                </form>
            )}

            { !showCreateForm &&
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '20px' }}>
                {tables?.map(table => (
                    <div 
                        key={table.created_at}
                        style={{ 
                            padding: '20px',
                            borderRadius: '10%',
                            border: table.is_active ? '2px solid yellow' : (table.is_ok ? '1px solid blue' : '1px solid red'), 
                            background: table.is_active ? '#f9ffd1ff' : (table.is_ok ? '#f0f8ff' : '#ffd0d0ff')
                        }}
                    >
                        { table.is_active && <div style={{position: 'absolute', width: '100%', height: '100%'}}><CrownDiamond {...{style: {width: '40px', height: '40px', color: '#afac08ff', position: 'relative',  top: "-2%", left: "4.4%"}}} /></div>}
                        <h3>Created:</h3> 
                        <h3>{table.created_at.replace("T", " ").replace("Z", "")}</h3>
                        <p>Version: {table.version}</p>

                        { !table.is_active &&
                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                            { table.is_ok &&
                            <button onClick={(e) => {handleSetActiveTable(e, table.created_at)}}
                                style={{
                                    borderRadius: "15%",
                                    backgroundColor: "#fdffd1ff",
                                    borderColor: "yellow",
                                    color: '#afac08ff'
                                }}>
                                {/* TO DO: also show form 'are you sure?' */}
                                <i className="fas fa-crown"></i> Activate
                            </button>
                            } { CheckTimeBeforeDeletion(table.created_at) &&
                            <button onClick={(e) => {handleDeleteTable(e, table.created_at)}}
                                style={{
                                    borderRadius: "15%",
                                    backgroundColor: "#fddcdcff",
                                    borderColor: "red"
                                }}>
                                {/* TO DO: also show form 'are you sure?' */}
                                <i className="fas fa-trash"></i> <TrashBin {...{style: {width: '30px', height: '30px', color: 'red'}}}/>
                            </button>
                            }
                        </div>
                        }
                    </div>
                ))}

                { tables.length < 10 &&
                <div 
                    style={{ 
                        padding: '20px', 
                        border: '1px dashed #000', 
                        borderRadius: '10%',
                        cursor: 'pointer',
                        backgroundColor: '#b7ffb3ff',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                    }}
                    onClick={() => setShowCreateForm(true)}
                >
                    <CirclePlus {...{style: {width: '50px', height: '50px', alignSelf: 'center'}}} />
                    <h5>Create Table</h5>
                </div>
                }
            </div>
            }
        </div>
    );
};

const CheckTimeBeforeDeletion = (time: string) => {
    var date = new Date(time)
    var curr_time = new Date()
    curr_time.setMinutes(curr_time.getMinutes() - 5);

    return date < curr_time
}

export default AdminPage;