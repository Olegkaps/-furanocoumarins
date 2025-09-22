import React, { useState, useEffect } from 'react';
import axios from 'axios';

const AdminPage: React.FC = () => {
    const [tables, setTables] = useState([]);
    const [activeTable, setActiveTable] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [googleLink, setGoogleLink] = useState('');
    const token = localStorage.getItem('token');

    useEffect(() => {
        const fetchTables = async () => {
            try {
                const response = await axios.get('/get-tables-list', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setTables(response.data.tables.sort((a: any, b: any) => b.timestamp - a.timestamp));
                setActiveTable(response.data.activeTable);
            } catch (error) {
                if (error.response.status === 401) {
                    setTimeout(() => window.location.href = '/login', 3000);
                    alert('Ошибка авторизации. Перенаправление на страницу входа...');
                }
            }
        };
        fetchTables();
    }, [token]);

    const handleCreateTable = async () => {
        try {
            await axios.post('/create-table', {
                googleLink,
                headers: { Authorization: `Bearer ${token}` }
            });
            setShowCreateForm(false);
            // Обновить список таблиц
            fetchTables();
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <div style={{ padding: '20px' }}>
            <h1>Панель администратора</h1>

            {showCreateForm && (
                <form onSubmit={handleCreateTable}>
                    <input 
                        type="text" 
                        value={googleLink} 
                        onChange={(e) => setGoogleLink(e.target.value)} 
                        placeholder="Ссылка на Google таблицу"
                        style={{ padding: '10px', marginBottom: '10px' }}
                    />
                    <button type="submit">Создать таблицу</button>
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
                        {table.name === activeTable && <div style={{ color: 'blue' }}>Активная таблица!</div>}
                        <h3>{table.name}</h3>
                        <p>Создана: {table.createdAt}</p>
                        <p>Строк: {table.rowsCount}</p>

                        {table.name !== activeTable && (
                            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                                <button onClick={() => /* логика установки активной таблицы */}>
                                    <i className="fas fa-crown"></i> Сделать активной
                                </button>
                                <button onClick={() => /* логика удаления таблицы */}>
                                    <i className="fas fa-trash"></i> Удалить
                                </button>
                            </div>
                        )}
                    </div>
                ))}

                <div 
                    style={{ 
                        padding: '20px', 
                        border: '1px dashed #000', 
                        cursor: 'pointer' 
                    }}
                    onClick={() => setShowCreateForm(true)}
                >
                    <h3>+ Создать новую таблицу</h3>
                </div>
            </div>
        </div>
    );
};

export default AdminPage;