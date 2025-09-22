import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';

import { api, setToken } from "./utils";




const LoginForm: React.FC = () => {
  const [uname_or_email, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = isLoginMode ? '/login' : '/login-mail';
    const data = isLoginMode
    ? { uname_or_email, password }
    : { uname_or_email, };

    const response = await api.post(url, data).catch((err) => {return err.response});

    if (response?.status === 401) {
        setError('Incorrect email login data, check it out');
    } else if (response?.status === 200) {
        setToken(response.data.token);    
        return <Navigate to="/admin" />
    } else {
        setError('Cannot process request')
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
      <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>Authorization</h2>

        <form onSubmit={handleSubmit}>
          <div>
            <label>
              Username or Email:
              <input 
                type="text" 
                value={uname_or_email} 
                onChange={(e) => setLogin(e.target.value)} 
                style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
              />
            </label>
      {isLoginMode ? (
            <label>
              Password:
              <input 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
              />
            </label>
      ) : (
        <></>
      )}
          </div>
        </form>

      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        <button 
          type="submit" 
          onClick={handleSubmit} 
          style={{ padding: '10px 20px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '5px' }}
        >
          Login
        </button>
      </div>

      <div style={{ color: 'red', textAlign: 'center' }}>
        {error}
      </div>

      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        <a 
          href="#" 
          onClick={() => setIsLoginMode(!isLoginMode)} 
          style={{ color: '#007bff', textDecoration: 'none' }}
        >
          {isLoginMode ? 'Log in by mail' : 'Log in by password'}
        </a>
      </div>

      <div style={{ textAlign: 'center', marginTop: '15px' }}>
        <a href="/reset" style={{ color: '#007bff', textDecoration: 'none' }}>
          Reset password
        </a>
      </div>
    </div>
  );
};

export default LoginForm;