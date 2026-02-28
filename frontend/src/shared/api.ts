import axios from "axios";
import { jwtDecode } from "jwt-decode";
import config from "../config";

export function isEmpty(obj: object) {
  return Object.keys(obj).length === 0;
}

interface JwtPayload {
  name: string;
  role: string;
  created: number;
  exp: number;
}

const TOKEN = "auth-token";
const NAME = "name";

export const api = axios.create({
  baseURL: config["BASE_URL"],
  headers: { "Access-Control-Allow-Origin": "true" },
});

async function renew_token(token: string) {
  return await api
    .post("/renew-token", {}, { headers: { Authorization: `Bearer ${token}` } })
    .catch((err) => err.response);
}

export function isTokenExists() {
  return getToken() !== undefined;
}

export function getToken() {
  const token = localStorage.getItem(TOKEN);
  if (!token) return undefined;
  try {
    const decoded = jwtDecode<JwtPayload>(token);
    if (
      Date.now() / 1000 - decoded.created >
      (decoded.exp - decoded.created) / 2
    ) {
      renew_token(token).then((response) => {
        if (response?.status === 200) {
          setToken(response.data.token);
        } else if (response?.status === 401) {
          return undefined;
        }
      });
    }
  } catch (error) {
    alert(error);
    return undefined;
  }
  return localStorage.getItem(TOKEN);
}

export function delToken() {
  localStorage.removeItem(TOKEN);
  localStorage.removeItem(NAME);
}

export function setToken(token_value: string) {
  localStorage.setItem(TOKEN, token_value);
  const decoded = jwtDecode<JwtPayload>(token_value);
  localStorage.setItem(NAME, decoded.name);
}

export function getName() {
  return localStorage.getItem(NAME);
}
