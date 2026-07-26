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

let logoutInProgress = false;

/** Clear session and send the user to login (idempotent). */
export function forceLogout(redirect = true) {
  if (logoutInProgress) return;
  logoutInProgress = true;
  delToken();
  const path = window.location.pathname;
  const onAuthPage =
    path.startsWith("/login") ||
    path.startsWith("/logout") ||
    path.startsWith("/reset") ||
    path.startsWith("/admit");
  if (redirect && !onAuthPage) {
    window.location.assign("/login");
  } else {
    logoutInProgress = false;
  }
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const headers = error?.config?.headers;
    let authHeader = "";
    if (headers) {
      if (typeof headers.get === "function") {
        authHeader = String(
          headers.get("Authorization") ?? headers.get("authorization") ?? "",
        );
      } else {
        authHeader = String(
          headers.Authorization ?? headers.authorization ?? "",
        );
      }
    }

    // Only treat 401 as session expiry when the request used a bearer token.
    // Login / password-reset 401s must not redirect.
    if (status === 401 && authHeader.length > 0) {
      forceLogout(true);
    }
    return Promise.reject(error);
  },
);

async function renew_token(token: string) {
  return await api
    .post("/auth/renew-token", {}, { headers: { Authorization: `Bearer ${token}` } })
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
    const now = Date.now() / 1000;

    if (!decoded.exp || now >= decoded.exp) {
      delToken();
      return undefined;
    }

    const lifetime = decoded.exp - decoded.created;
    if (lifetime > 0 && now - decoded.created > lifetime / 2) {
      renew_token(token).then((response) => {
        if (response?.status === 200 && response.data?.token) {
          setToken(response.data.token);
        }
        // 401 is handled by the axios interceptor (forceLogout)
      });
    }
  } catch {
    delToken();
    return undefined;
  }
  return localStorage.getItem(TOKEN) ?? undefined;
}

export function delToken() {
  localStorage.removeItem(TOKEN);
  localStorage.removeItem(NAME);
}

export function setToken(token_value: string) {
  localStorage.setItem(TOKEN, token_value);
  const decoded = jwtDecode<JwtPayload>(token_value);
  localStorage.setItem(NAME, decoded.name);
  logoutInProgress = false;
}

export function getName() {
  return localStorage.getItem(NAME);
}
