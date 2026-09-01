import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "./utils";
import "./Admin.css";

const ResetPasswordForm: React.FC = () => {
	const navigate = useNavigate();
  const [loginOrEmail, setLoginOrEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
	const [code, setCode] = useState("");
	const [password, setPassword] = useState("");
	const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
	const response = await api
	  .post(sent ? "/auth/password-reset/complete" : "/auth/password-reset/start", sent ? { login: loginOrEmail, code, new_password: password } : { login: loginOrEmail })
      .catch((err) => err.response);

	if (response?.status >= 200 && response?.status < 300) {
	  if (sent) {
		setSuccess("Password changed. You can sign in now.");
		navigate("/login");
	  } else {
		setSent(true);
		setSuccess("If the account exists, a reset code was requested. If it does not arrive, wait briefly and request another code.");
	  }
      setError("");
	} else if (sent && response?.status === 401) {
	  setError("That code is invalid or expired. Check the code and try again, or request a new code.");
	  setSuccess("");
	} else if (sent && response?.status === 400) {
	  setError(response?.data?.error ?? "The password does not meet policy. Choose a stronger password; the same valid code can be retried.");
      setSuccess("");
    } else {
	  setError("Cannot process the request right now. Your account status has not been disclosed; please retry.");
      setSuccess("");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Reset password</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Username or email
            <input
              type="text"
              value={loginOrEmail}
              onChange={(e) => setLoginOrEmail(e.target.value)}
              autoComplete="username"
            />
          </label>
		  {sent && <><label>Email code<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" /></label><label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label><button type="button" className="btn" onClick={() => { setSent(false); setCode(""); setPassword(""); setError(""); setSuccess(""); }}>Request a new code</button></>}
          <div className="auth-card__actions">
            <button type="submit" className="btn btn-primary">
		  {sent ? "Reset password" : "Send reset code"}
            </button>
          </div>
        </form>
        {success && <p className="auth-card__success">{success}</p>}
        {error && <p className="auth-card__error">{error}</p>}
        <div className="auth-card__links">
          <Link to="/login">Back to login</Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordForm;
