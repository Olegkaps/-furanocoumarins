import React, { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, Link } from "react-router-dom";
import { api, setToken, deviceID } from "./utils";
import "./Admin.css";

const LoginForm: React.FC = () => {
  const [uname_or_email, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);
	const [challenge, setChallenge] = useState("");
	const [otp, setOTP] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = challenge ? "/auth/login-verify-otp" : isLoginMode ? "/auth/login" : "/auth/login-mail";

    const bodyFormData = new FormData();
    bodyFormData.append("uname_or_email", uname_or_email);
	if (challenge) {
		bodyFormData.append("challenge", challenge);
		bodyFormData.append("code", otp);
		bodyFormData.append("device_id", deviceID());
	} else if (isLoginMode) {
      bodyFormData.append("password", password);
    }

    const response = await api
      .post(url, bodyFormData)
      .catch((err) => err.response);

    if (response?.status === 401 || response?.status === 400) {
	  if (challenge) {
		setChallenge("");
		setOTP("");
		setPassword("");
		setError("That code is invalid or already used. Enter your password again to request a fresh code.");
	  } else {
		setError("Incorrect username or password");
	  }
    } else if (response?.status > 199 && response?.status < 400) {
      setError("");
	  setNotice("");
	  if (response.data?.otp_sent) {
		setChallenge(response.data.login_challenge);
		return;
	  }
      if (isLoginMode || challenge) {
		setToken(response.data.access_token, response.data.refresh_token, response.data.csrf_token);
        navigate("/admin");
      } else {
		setNotice("If the account exists, a sign-in link was requested. If it does not arrive, wait briefly and request another link.");
      }
    } else {
      setError("Cannot process request");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Sign in</h2>
		<p className="auth-card__notice">Use your password plus an email code, or request an email login link. Both are complete sign-in methods; magic links never require a password.</p>
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
		  {challenge ? (
			<label>Email verification code<input value={otp} onChange={(e) => setOTP(e.target.value)} inputMode="numeric" autoComplete="one-time-code" /></label>
		  ) : isLoginMode && (
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
			  {challenge ? "Verify code" : isLoginMode ? "Login" : "Send login link"}
            </button>
          </div>
        </form>
        {error && <p className="auth-card__error">{error}</p>}
		{notice && <p className="auth-card__notice" role="status">{notice}</p>}
        <div className="auth-card__links">
          <button
            type="button"
            className="btn"
			onClick={() => { setChallenge(""); setOTP(""); setError(""); setNotice(""); setIsLoginMode(!isLoginMode); }}
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
  const word = props.word;
	const [result, setResult] = useState<"pending" | "ok" | "error">("pending");
	const confirmationStarted = useRef(false);

  useEffect(() => {
	if (confirmationStarted.current) return;
	confirmationStarted.current = true;
    async function confirm() {
      const bodyFormData = new FormData();
      bodyFormData.append("word", word);
      bodyFormData.append("device_id", deviceID());
      const response = await api
        .post("/auth/confirm-login-mail", bodyFormData)
        .catch((err) => err.response);
      if (response?.status > 199 && response?.status < 400) {
		setToken(response.data.access_token, response.data.refresh_token, response.data.csrf_token);
        setResult("ok");
	  } else {
		setResult("error");
      }
    }
    void confirm();
  }, [word]);

  if (result === "ok") {
	return <Navigate to="/admin" />;
  }
	if (result === "pending") {
		return <p className="empty-state" role="status">Signing you in…</p>;
	}
	return <div className="empty-state"><p>This sign-in link is invalid or has already been used.</p><Link to="/login">Request a fresh sign-in link</Link></div>;
};
