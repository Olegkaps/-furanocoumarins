import React, { useState } from 'react';
import { api } from './utils';


const ResetPasswordForm: React.FC = () => {
    const [loginOrEmail, setLoginOrEmail] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        var bodyFormData = new FormData();
        bodyFormData.append("uname_or_email", loginOrEmail)
        const response = await api.post('/change-password', bodyFormData).catch((err) => {return err.response});
        
        if (response?.status === 200) {
            setSuccess('The confirmation email has been sent');
            setError('');
        } else if (response?.status === 404 || response?.status === 400) {
            setError('User not found');
            setSuccess('');
        } else {
            setError('Cannot process request');
            setSuccess('');
        }
    };

    return (
        <div style={{
            width: '300px',
            margin: 'auto',
            padding: '20px',
            border: '1px solid #ccc',
            borderRadius: '5px',
            backgroundColor: '#f9f9f9'
        }}>
            <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>Reset password</h2>

            <form onSubmit={handleSubmit}>
                <div>
                    <label>
                        Username or email:
                        <input 
                            type="text" 
                            value={loginOrEmail} 
                            onChange={(e) => setLoginOrEmail(e.target.value)} 
                            style={{ 
                                width: '100%', 
                                padding: '8px', 
                                marginBottom: '10px' 
                            }}
                        />
                    </label>
                </div>

                <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                    <button 
                        type="submit" 
                        style={{ 
                            padding: '10px 20px', 
                            backgroundColor: '#007bff', 
                            color: '#fff', 
                            border: 'none', 
                            borderRadius: '5px' 
                        }}
                    >
                        Reset
                    </button>
                </div>
            </form>

            <div style={{ color: 'green', textAlign: 'center' }}>
                {success}
            </div>

            <div style={{ color: 'red', textAlign: 'center' }}>
                {error}
            </div>

            <div style={{ textAlign: 'center', marginTop: '15px' }}>
                <a 
                    href="/login" 
                    style={{ 
                        color: '#007bff', 
                        textDecoration: 'none' 
                    }}
                >
                    Login
                </a>
            </div>
        </div>
    );
};

export default ResetPasswordForm;