import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { api, setToken } from "./utils";




const LoginForm: React.FC = () => {
  const [uname_or_email, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = isLoginMode ? '/auth/login' : '/auth/login-mail';
    
    var bodyFormData = new FormData();
    bodyFormData.append("uname_or_email", uname_or_email)
    if (isLoginMode) {
      bodyFormData.append("password", password)
    }

    const response = await api.post(url, bodyFormData).catch((err) => {return err.response});

    if (response?.status === 401 || response?.status === 400) {
        setError('Incorrect email login data, check it out');
    } else if (response?.status > 199 && response?.status < 400) {
        setError("")
        if (isLoginMode) {
          setToken(response.data.token);
          navigate("/admin")
        } else {
          alert("Mail sent")
        }
    } else {
        setError('Cannot process request')
    }
  };

  return (
    <div style={{
      width: '300px',
      margin: 'auto',
      padding: '40px',
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

export const MailAdmit: React.FC<{word: string}> = (props) => {
  var bodyFormData = new FormData();
  bodyFormData.append("word", props.word)
  const [result, setResult] = useState('bad');

  useEffect(() => {
    async function _() {
      var response = await api.post('/auth/confirm-login-mail', bodyFormData).catch((err) => {return err.response});
      if (response?.status > 199 && response?.status < 400) {
          setToken(response.data.token);
          setResult("ok")
      }
    }
    _().then(() => {})
  }, [])

  if (result == "ok") {
      return <Navigate to="/admin" />
  } else {
      return <p>Incorrect link</p>
  }
}