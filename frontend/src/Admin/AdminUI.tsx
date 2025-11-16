import React, { useState, useEffect } from 'react';
import { api, getToken, isTokenExists } from './utils';
import { Navigate } from 'react-router-dom';
import {CirclePlus} from '@gravity-ui/icons';

class Table {
    id: string
    name: string
    timestamp: string
    rowsCount: number

    constructor(
        id: string,
        name: string,
        timestamp: string,
        rowsCount: number
    ) {
        this.id = id
        this.name = name
        this.timestamp = timestamp
        this.rowsCount = rowsCount
    }
}


const AdminPage: React.FC = () => {
    const [tables, setTables] = useState(Array<Table>);
    const [activeTable, setActiveTable] = useState('');
    const [tableId, setTableID] = useState('');

    const [showCreateForm, setShowCreateForm] = useState(false);
    
    const [googleLink, setGoogleLink] = useState('');
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

        return

        setTables(response.data.tables.sort((a: any, b: any) => b.timestamp - a.timestamp));
        setActiveTable(response.data.activeTable);

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
        bodyFormData.append("link", googleLink)
        bodyFormData.append("meta", googleMetaList)

        let response = await api.post('/create-table', bodyFormData, {
            headers: { Authorization: `Bearer ${token}` }
        }).catch((err) => {return err.response});

        if (response?.status === 400) {
            alert('Incorrect link');
        }

        setShowCreateForm(false);
        fetchTables();
    };

    const handleSetActiveTable = async (e: React.FormEvent) => {
        e.preventDefault();
        let token = getToken();
        
        await api.post('/set-active-table', {  // rewrite
            tableId,
            headers: { Authorization: `Bearer ${token}` }
        }).catch((err) => {return err.response});

        setTimeout(() => fetchTables(), 5000);
    };

    const handleDeleteTable = async (e: React.FormEvent) => {
        e.preventDefault();
        let token = getToken();
        
        await api.post(`/delete-table/${tableId}`, {  // rewrite
            headers: { Authorization: `Bearer ${token}` }
        }).catch((err) => {return err.response});

        setTimeout(() => fetchTables(), 5000);
    };

    return (
        <div style={{ padding: '20px' }}>
            <h2 style={{ fontSize: 'xx-large', position: 'absolute', top: '5%', left: '40%' }}>Existing Tables</h2>

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
                        <p style={{ color: '#e6dedeff' }}>Create table from Google Sheet</p>
                        <input 
                            type="text" 
                            value={googleLink} 
                            onChange={(e) => setGoogleLink(e.target.value)} 
                            placeholder="link to Google sheet"
                            style={{ 
                                padding: '10px',
                                marginBottom: '10px',
                            }}
                        />
                        <br></br>
                        <input 
                            type="text" 
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '20px' }}>
                {tables.map(table => (
                    <div 
                        key={table.id} 
                        style={{ 
                            padding: '20px', 
                            border: table.name === activeTable ? '2px solid blue' : '1px solid #ccc', 
                            background: table.name === activeTable ? '#f0f8ff' : '#fff'
                        }}
                    >
                        {table.name === activeTable && <div style={{ color: 'blue' }}>active</div>}
                        <h3>{table.name}</h3>
                        <p>Created: {table.timestamp}</p>
                        <p>Rows: {table.rowsCount}</p>

                        {table.name !== activeTable && (
                            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                                <button onClick={() => setTableID(table.id)}>
                                    {/* also show form 'are you sure?' */}
                                    <i className="fas fa-crown"></i> Make active
                                </button>
                                <button onClick={() => setTableID(table.id)}>
                                    <i className="fas fa-trash"></i> Delete
                                </button>
                            </div>
                        )}
                    </div>
                ))}

                <div 
                    style={{ 
                        padding: '20px', 
                        border: '1px dashed #000', 
                        cursor: 'pointer',
                        backgroundColor: '#56f64eff',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                    }}
                    onClick={() => setShowCreateForm(true)}
                >
                    <CirclePlus {...{style: {width: '50px', height: '50px', alignSelf: 'center'}}} />
                    <h5>Create Table</h5>
                </div>
            </div>
        </div>
    );
};

export default AdminPage;