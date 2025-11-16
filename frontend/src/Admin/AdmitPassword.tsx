import React, { useState } from 'react';
import { api } from './utils';
import { useNavigate } from 'react-router-dom';


const PasswordConfirmForm: React.FC<{word: string}> = (props) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const isValidPassword = (password: string) => {
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&\-])[A-Za-z\d@$!%*?&\-]{8,}$/;
    return regex.test(password);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isValidPassword(newPassword)) {
      setError('The password must contain at least 8 characters, 1 uppercase letter, 1 lowercase letter, and 1 special character');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('Passwords are differs');
      return;
    }

    var bodyFormData = new FormData();
    bodyFormData.append("password", newPassword)
    bodyFormData.append("word", props.word)
    const response = await api.post('/confirm-password-change', bodyFormData).catch((err) => {return err.response});
    
    if (response?.status < 400) {
        navigate("/login")
    } else {
        setError('Cannot process request');
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
            New password:
            <input 
              type="password" 
              value={newPassword} 
              onChange={(e) => setNewPassword(e.target.value)} 
              style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
            />
          </label>
        </div>

        <div>
          <label>
            Repeat password:
            <input 
              type="password" 
              value={confirmPassword} 
              onChange={(e) => setConfirmPassword(e.target.value)} 
              style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
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
            Confirm
          </button>
        </div>
      </form>

      <div style={{ color: 'red', textAlign: 'center' }}>
        {error}
      </div>
    </div>
  );
};

export default PasswordConfirmForm;