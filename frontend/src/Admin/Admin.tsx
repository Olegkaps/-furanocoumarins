import {
    useParams,
    Navigate,
} from "react-router-dom";

import {ArrowRightFromSquare} from '@gravity-ui/icons';

import { delToken, getName, isTokenExists} from "./utils";
import LoginForm, { MailAdmit } from "./LoginForm";
import ResetPasswordForm from "./ResetPasswordForm";
import PasswordConfirmForm from "./AdmitPassword";
import AdminPage from "./AdminUI";


class AdminApp {
    response: any

    constructor() {
        this.response = undefined
    }

    App() {
        let username = getName()

        return <div>
            <div style={{
                position: 'absolute',
                top: '5%',
                right: '3%',
                backgroundColor: '#f0e68c',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px'
            }}>
                <p style={{ margin: 0, fontWeight: 'bold' }}>{username}</p>
                <a
                    href="/logout"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '8px 16px',
                        backgroundColor: '#fae6b0',
                        color: 'black',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer'
                    }}
                >
                    Logout <ArrowRightFromSquare />
                </a>
            </div>
            <AdminPage />
        </div>
    }

    Login() {
        if (isTokenExists()) {
            return <Navigate to="/admin" />
        }
        return <LoginForm />
    }

    Logout() {
        delToken()
        return <Navigate to="/login" />
    }

    Reset() {
        return <ResetPasswordForm />
    }

    Admit() {
        const {code} = useParams()

        if (code?.startsWith("psw")) {
            return <PasswordConfirmForm {...{word: code}} />
        } else if (code?.startsWith("lin")) {
            return <MailAdmit {...{word: code}}/>
        }
        return <p>wrong code</p>
    }
}


let Admin = new AdminApp()

export default Admin;
