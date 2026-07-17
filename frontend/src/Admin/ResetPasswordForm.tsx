import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./utils";
import "./Admin.css";

const ResetPasswordForm: React.FC = () => {
  const [loginOrEmail, setLoginOrEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const bodyFormData = new FormData();
    bodyFormData.append("uname_or_email", loginOrEmail);
    const response = await api
      .post("/auth/change-password", bodyFormData)
      .catch((err) => err.response);

    if (response?.status === 200) {
      setSuccess("The confirmation email has been sent");
      setError("");
    } else if (response?.status === 404 || response?.status === 400) {
      setError("User not found");
      setSuccess("");
    } else {
      setError("Cannot process request");
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
          <div className="auth-card__actions">
            <button type="submit" className="btn btn-primary">
              Send reset link
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
