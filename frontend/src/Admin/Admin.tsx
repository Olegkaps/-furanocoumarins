import { useParams, Navigate } from "react-router-dom";
import { ArrowRightFromSquare } from "@gravity-ui/icons";
import { delToken, getName, isTokenExists } from "./utils";
import LoginForm, { MailAdmit } from "./LoginForm";
import ResetPasswordForm from "./ResetPasswordForm";
import PasswordConfirmForm from "./AdmitPassword";
import AdminPage from "./AdminUI";

export function AdminApp() {
  const username = getName();
  return (
    <div>
      <div
        style={{
          position: "absolute",
          top: "4%",
          right: "3%",
          backgroundColor: "#fffacdff",
          border: "1px solid grey",
          borderRadius: "8px",
          padding: "10px 16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <p style={{ margin: 0, fontWeight: "bold" }}>{username}</p>
        <a
          href="/logout"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            padding: "8px 16px",
            backgroundColor: "#f9eccaff",
            color: "black",
            border: "1px solid grey",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          Logout <ArrowRightFromSquare />
        </a>
      </div>
      <AdminPage />
    </div>
  );
}

export function AdminLogin() {
  if (isTokenExists()) {
    return <Navigate to="/admin" />;
  }
  return <LoginForm />;
}

export function AdminLogout() {
  delToken();
  return <Navigate to="/login" />;
}

export function AdminReset() {
  return <ResetPasswordForm />;
}

export function AdminAdmit() {
  const { code } = useParams<{ code: string }>();
  if (code?.startsWith("psw")) {
    return <PasswordConfirmForm word={code} />;
  }
  if (code?.startsWith("lin")) {
    return <MailAdmit word={code} />;
  }
  return <p>wrong code</p>;
}
