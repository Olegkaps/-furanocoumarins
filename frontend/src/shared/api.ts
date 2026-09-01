import axios from "axios";
import { jwtDecode } from "jwt-decode";
import config from "../config";
import { createAccessTokenRecovery, hasCoherentCredential } from "./refreshPolicy";
import { createSessionEpoch, finalizeRotatedCredential, type RotatedCredential } from "./sessionEpoch";

export function isEmpty(obj: object) {
  return Object.keys(obj).length === 0;
}

interface JwtPayload {
  name?: string;
  login?: string;
  created?: number;
  iat?: number;
  exp: number;
}

const TOKEN = "auth-token";
const NAME = "name";
const REFRESH = "auth-refresh-token";
const CSRF = "auth-csrf-token";

export const api = axios.create({
  baseURL: config["BASE_URL"],
  headers: { "Access-Control-Allow-Origin": "true" },
	withCredentials: true,
});
const refreshClient = axios.create({ baseURL: config["BASE_URL"], withCredentials: true });
const sessionEpoch = createSessionEpoch();

let logoutInProgress = false;
let logoutInFlight: Promise<void> | null = null;
const accessTokenRecovery = createAccessTokenRecovery(
  () => localStorage.getItem(TOKEN),
  refreshAccessToken,
);
api.interceptors.request.use((request) => {
	const csrf = localStorage.getItem(CSRF);
	if (csrf) request.headers.set("X-CSRF-Token", csrf);
	return request;
});

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
  async (error) => {
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

    const request = error?.config;
    // Expired and signing-key-stale access tokens both recover through one
    // rotating refresh request. Concurrent failures share the same winner.
    if (status === 401 && authHeader.length > 0 && request && !request.__authRetried) {
      request.__authRetried = true;
      try {
        // A 401 can arrive after another request has already completed the
        // rotating refresh. Reuse that newer access-token generation instead
        // of replaying the newly rotated refresh credential.
        const accessToken = await accessTokenRecovery.recover(authHeader);
        request.headers.set?.("Authorization", `Bearer ${accessToken}`);
        if (typeof request.headers.set !== "function") request.headers.Authorization = `Bearer ${accessToken}`;
        return api.request(request);
	  } catch (refreshError) {
		// A rejected refresh credential is final. Network errors and authd 5xx
		// responses are temporary, so retain the rotating credential and let the
		// caller show a retryable error instead of destroying the session.
		if (axios.isAxiosError(refreshError) && refreshError.response?.status === 401) {
			forceLogout(true);
		}
		// Preserve the refresh failure's status. Returning the original access
		// 401 would make legacy callers misclassify an authd outage as an invalid
		// session and erase otherwise recoverable credentials.
		return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);

async function refreshAccessToken(): Promise<string> {
	const capturedEpoch = sessionEpoch.capture();
	const refresh_token = localStorage.getItem(REFRESH);
	if (!refresh_token) throw new Error("missing refresh token");
  const response = await refreshClient.post("/auth/refresh", { refresh_token, device_id: deviceID() });
  if (!response.data?.access_token || !response.data?.refresh_token) throw new Error("incomplete refresh response");
  const credential: RotatedCredential = {
	accessToken: response.data.access_token,
	refreshToken: response.data.refresh_token,
	csrfToken: response.data.csrf_token,
  };
  return finalizeRotatedCredential(
	sessionEpoch,
	capturedEpoch,
	credential,
	(next) => storeToken(next.accessToken, next.refreshToken, next.csrfToken),
	(next) => revokeRefreshCredential(next.refreshToken, next.csrfToken),
  );
}

export function isTokenExists() {
  return getToken() !== undefined;
}

export function getToken() {
  const token = localStorage.getItem(TOKEN);
	const refreshToken = localStorage.getItem(REFRESH);
	if (!token || !refreshToken) {
		// Pre-refresh deployments stored only an access token. Treat every
		// incomplete pair as logged out and remove all session-derived state so
		// /login cannot redirect into an unrecoverable 401 loop.
		if (token !== null || refreshToken !== null || localStorage.getItem(NAME) !== null || localStorage.getItem(CSRF) !== null) {
			delToken();
		}
		return undefined;
	}
  try {
    const decoded = jwtDecode<JwtPayload>(token);
    // Keep an expired access token long enough for the response interceptor to
    // exchange the independent refresh credential and retry the request.
    if (!decoded.exp) return undefined;
  } catch {
    delToken();
    return undefined;
  }
  return localStorage.getItem(TOKEN) ?? undefined;
}

export function delToken() {
	sessionEpoch.invalidate();
  accessTokenRecovery.reset();
  localStorage.removeItem(TOKEN);
  localStorage.removeItem(NAME);
  localStorage.removeItem(REFRESH);
	localStorage.removeItem(CSRF);
}

export function setToken(token_value: string, refreshToken?: string, csrfToken?: string) {
	if (!hasCoherentCredential(token_value, refreshToken)) {
		delToken();
		throw new Error("incomplete session credential");
	}
	sessionEpoch.invalidate();
  accessTokenRecovery.reset();
	storeToken(token_value, refreshToken!, csrfToken);
  logoutInProgress = false;
}

function storeToken(token_value: string, refreshToken: string, csrfToken?: string) {
  localStorage.setItem(TOKEN, token_value);
  const decoded = jwtDecode<JwtPayload>(token_value);
	localStorage.setItem(NAME, decoded.login ?? decoded.name ?? "");
	localStorage.setItem(REFRESH, refreshToken);
	if (csrfToken) localStorage.setItem(CSRF, csrfToken);
}

async function revokeRefreshCredential(refreshToken: string | null, csrf?: string | null): Promise<void> {
	try {
		await refreshClient.post("/auth/logout", refreshToken ? { refresh_token: refreshToken } : {}, {
			headers: csrf ? { "X-CSRF-Token": csrf } : {},
		});
	} catch (error) {
		if (axios.isAxiosError(error) && error.response?.status === 401) return;
		throw error;
	}
}

export async function logoutSession(): Promise<void> {
	if (logoutInFlight) return logoutInFlight;
	const refresh_token = localStorage.getItem(REFRESH);
	const csrf = localStorage.getItem(CSRF);
	// Explicit logout is locally immediate, but StrictMode and repeated clicks
	// share the same server revocation before the route navigates to login.
	delToken();
	logoutInFlight = (async () => {
		// The old credential and any rotated winner are separate revocation
		// obligations. Waiting for recovery to settle keeps StrictMode remounts
		// and navigation behind the barrier that cleans up the winner.
		await Promise.all([
			revokeRefreshCredential(refresh_token, csrf).catch(() => undefined),
			accessTokenRecovery.waitForIdle(),
		]);
	})().finally(() => { logoutInFlight = null; });
	return logoutInFlight;
}

export function deviceID() {
	const key = "auth-device-id";
	let value = localStorage.getItem(key);
	if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
	return value;
}

export function getName() {
  return localStorage.getItem(NAME);
}
