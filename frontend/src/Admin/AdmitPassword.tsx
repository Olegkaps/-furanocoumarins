import React, { useState } from "react";
import { api } from "./utils";
import { useNavigate } from "react-router-dom";
import "./Admin.css";

const PasswordConfirmForm: React.FC<{ word: string }> = (props) => {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const isValidPassword = (password: string) => {
    const regex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&-])[A-Za-z\d@$!%*?&-]{8,}$/;
    return regex.test(password);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValidPassword(newPassword)) {
      setError(
        "The password must contain at least 8 characters, 1 uppercase letter, 1 lowercase letter, and 1 special character",
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords are differs");
      return;
    }

    const bodyFormData = new FormData();
    bodyFormData.append("password", newPassword);
    bodyFormData.append("word", props.word);
    const response = await api
      .post("/auth/confirm-password-change", bodyFormData)
      .catch((err) => err.response);

    if (response?.status < 400) {
      navigate("/login");
    } else {
      setError("Cannot process request");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Set new password</h2>
        <form onSubmit={handleSubmit}>
          <label>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label>
            Repeat password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <div className="auth-card__actions">
            <button type="submit" className="btn btn-primary">
              Confirm
            </button>
          </div>
        </form>
        {error && <p className="auth-card__error">{error}</p>}
      </div>
    </div>
  );
};

export default PasswordConfirmForm;
