import axios from "axios"
import config from "../config"


let TOKEN = 'auth-token'

export function getToken() {
    let token = localStorage.getItem(TOKEN)

    if (token) {
        return token
    } else {
        return ''
    }
}

export function setToken(token_value: string) {
    localStorage.setItem(TOKEN, token_value)
}

export const api = axios.create({ baseURL: config["BASE_URL"] })
