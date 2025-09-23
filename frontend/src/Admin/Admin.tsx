// import React from "react";
import {
//    Link,
    useParams,
    Navigate,
} from "react-router-dom";

import {ArrowRightFromSquare} from '@gravity-ui/icons';
//import { jwtDecode } from 'jwt-decode';

import { api, getToken, setToken } from "./utils";
import LoginForm from "./LoginForm";
import ResetPasswordForm from "./ResetPasswordForm";
import PasswordConfirmForm from "./AdmitPassword";


// interface JwtPayload {
//     username: string,
//     role: string,
//     timestamp: number,
//     ttl: number,
// }


class AdminApp {
    response: any

    constructor() {
        this.response = undefined
    }

    async renew_token(token: string){
        return await api.post('/renew-token', { headers: { Authorization: `Bearer ${token}` } }).catch((err) => {return err.response});
    }

    App() {
        // let token = getToken()
        // if (!token) {
        //     return <Navigate to="/login" />
        // }
        // let user_data = jwtDecode<JwtPayload>(token)


        // if (Date.now() - user_data.timestamp > user_data.ttl / 2) {
        //     this.renew_token(token).then(resp => this.response = resp)
        //     const response = this.response
        //     if (response?.status === 200) {
        //         setToken(response.data.token);    
        //     } else if (response?.status === 401) {
        //         return <Navigate to="/login" />
        //     }
        // }
        // let username = user_data.username
        let username = "Admin_oleg"

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
            <p>Admin</p>
        </div>
    }

    Login() {
        let token = getToken()
        if (token) {
            return <Navigate to="/admin" />
        }
        return <LoginForm />
    }

    Logout() {
        setToken("")
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
            return <p>login by email</p>
        }
        return <p>wrong code</p>
    }
}


let Admin = new AdminApp()

export default Admin;
