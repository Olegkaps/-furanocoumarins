import React, { useEffect, useState } from "react";
import { Navigate, useNavigate, Link } from "react-router-dom";
import { api, setToken } from "./utils";
import "./Admin.css";

const LoginForm: React.FC = () => {
  const [uname_or_email, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = isLoginMode ? "/auth/login" : "/auth/login-mail";

    const bodyFormData = new FormData();
    bodyFormData.append("uname_or_email", uname_or_email);
    if (isLoginMode) {
      bodyFormData.append("password", password);
    }

    const response = await api
      .post(url, bodyFormData)
      .catch((err) => err.response);

    if (response?.status === 401 || response?.status === 400) {
      setError("Incorrect email login data, check it out");
    } else if (response?.status > 199 && response?.status < 400) {
      setError("");
      if (isLoginMode) {
        setToken(response.data.token);
        navigate("/admin");
      } else {
        alert("Mail sent");
      }
    } else {
      setError("Cannot process request");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Sign in</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Username or email
            <input
              type="text"
              value={uname_or_email}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
            />
          </label>
          {isLoginMode && (
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
          )}
          <div className="auth-card__actions">
            <button type="submit" className="btn btn-primary">
              {isLoginMode ? "Login" : "Send login link"}
            </button>
          </div>
        </form>
        {error && <p className="auth-card__error">{error}</p>}
        <div className="auth-card__links">
          <button
            type="button"
            className="btn"
            onClick={() => setIsLoginMode(!isLoginMode)}
          >
            {isLoginMode ? "Log in by mail" : "Log in by password"}
          </button>
          <Link to="/reset">Reset password</Link>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;

export const MailAdmit: React.FC<{ word: string }> = (props) => {
  const bodyFormData = new FormData();
  bodyFormData.append("word", props.word);
  const [result, setResult] = useState("bad");

  useEffect(() => {
    async function confirm() {
      const response = await api
        .post("/auth/confirm-login-mail", bodyFormData)
        .catch((err) => err.response);
      if (response?.status > 199 && response?.status < 400) {
        setToken(response.data.token);
        setResult("ok");
      }
    }
    void confirm();
  }, []);

  if (result === "ok") {
    return <Navigate to="/admin" />;
  }
  return <p className="empty-state">Incorrect link</p>;
};
