import { useEffect, useState } from "react";
import { useParams, useSearchParams, Navigate, Link } from "react-router-dom";
import { ArrowRightFromSquare } from "@gravity-ui/icons";
import { getName, isTokenExists, logoutSession } from "./utils";
import LoginForm, { MailAdmit } from "./LoginForm";
import ResetPasswordForm from "./ResetPasswordForm";
import PasswordConfirmForm from "./AdmitPassword";
import AdminPage from "./AdminUI";
import FullNavigation from "../FullNavigation/FullNavigation";
import "./Admin.css";
import { PageTour } from "../shared/tour/PageTour";
import AccountSecurity from "./AccountSecurity";

export function AdminApp() {
  const username = getName();
  return (
    <div>
      <FullNavigation pageName="admin" />
      <PageTour tourId="admin" />
      <div className="admin-page" style={{ paddingTop: 8 }}>
        <div className="admin-topbar" style={{ marginBottom: 8 }} data-tour="admin-header">
          <h1 className="admin-topbar__title" style={{ fontSize: "1.75rem" }}>
            Administration
          </h1>
          <div className="admin-user">
            <p className="admin-user__name">{username}</p>
            <Link to="/logout" className="btn">
              Logout <ArrowRightFromSquare width={16} height={16} />
            </Link>
          </div>
        </div>
      </div>
      <AdminPage />
	  <AccountSecurity />
    </div>
  );
}

export function AdminLogin() {
  if (isTokenExists()) {
    return <Navigate to="/admin" />;
  }
  return (
    <>
      <FullNavigation />
      <LoginForm />
    </>
  );
}

export function AdminLogout() {
	const [complete, setComplete] = useState(false);
	useEffect(() => {
		let mounted = true;
		void logoutSession().finally(() => { if (mounted) setComplete(true); });
		return () => { mounted = false; };
	}, []);
	return complete ? <Navigate to="/login" /> : <p className="empty-state">Signing out…</p>;
}

export function AdminReset() {
  return (
    <>
      <FullNavigation />
      <ResetPasswordForm />
    </>
  );
}

export function AdminAdmit() {
  const { code } = useParams<{ code: string }>();
  if (code?.startsWith("psw")) {
    return (
      <>
        <FullNavigation />
        <PasswordConfirmForm word={code} />
      </>
    );
  }
  if (code?.startsWith("lin")) {
    return (
      <>
        <FullNavigation />
        <MailAdmit word={code} />
      </>
    );
  }
  return <p className="empty-state">Wrong code</p>;
}

export function AdminMagicCallback() {
	const [params] = useSearchParams();
	const token = params.get("token");
	return token ? <MailAdmit word={token} /> : <p className="empty-state">Wrong code</p>;
}
