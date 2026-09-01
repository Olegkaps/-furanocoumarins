import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "./utils";
import "./Admin.css";

export default function Register() {
  const [params] = useSearchParams(); const token = params.get("token") ?? "";
  const [login, setLogin] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [valid, setValid] = useState<boolean | null>(null); const [done, setDone] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
	let active = true;
	api.get("/auth/registration-invite", { params: { token } })
		.then((r) => {
			if (!active) return;
			setValid(Boolean(r.data.valid));
			if (r.data.email) setEmail(r.data.email);
		})
		.catch(() => { if (active) setValid(false); });
	return () => { active = false; };
  }, [token]);
  if (done) return <Navigate to="/login" />;
  if (valid === null) return <p className="empty-state">Checking invitation…</p>;
  if (valid === false) return <p className="empty-state">Invitation is invalid or expired.</p>;
  async function submit(e: React.FormEvent) { e.preventDefault(); const response = await api.post("/auth/register", { invite_token: token, login, email, password }).catch((x) => x.response); if (response?.status === 201) setDone(true); else setError(response?.data?.error ?? "Registration failed"); }
  return <div className="auth-page"><div className="auth-card"><h2>Create account</h2><form onSubmit={submit}>
    <label>Login<input value={login} onChange={(e) => setLogin(e.target.value)} /></label>
    <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    <button className="btn btn-primary">Register</button></form>{error && <p className="auth-card__error">{error}</p>}</div></div>;
}
