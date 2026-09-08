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
  exp?: number;
}

const TOKEN = "auth-token";
const NAME = "name";
const REFRESH = "auth-refresh-token";
const CSRF = "auth-csrf-token";
const COOKIE_SESSION = "auth-cookie-session";
const AUTH_DEBUG_KEY = "auth-debug-events";
const SESSION_CREDENTIAL_PREFIX = "auth-session-";

type AuthDebugEvent = {
  event: string;
  at: string;
  details?: Record<string, boolean | string | null>;
};

function authDebug(event: string, details?: AuthDebugEvent["details"]) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth_debug") === "1") sessionStorage.setItem("auth-debug-enabled", "1");
  if (sessionStorage.getItem("auth-debug-enabled") !== "1") return;
  const entry: AuthDebugEvent = { event, at: new Date().toISOString(), details };
  let events: AuthDebugEvent[] = [];
  try { events = JSON.parse(sessionStorage.getItem(AUTH_DEBUG_KEY) ?? "[]"); } catch { /* reset malformed diagnostics */ }
  events.push(entry);
  sessionStorage.setItem(AUTH_DEBUG_KEY, JSON.stringify(events.slice(-30)));
  console.info("auth debug", entry);
}

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
  () => credentialGet(TOKEN),
  refreshAccessToken,
);

// Some privacy-focused browsers can evict localStorage while preserving the
// current tab's sessionStorage. Keep an in-tab copy so completing a magic link
// cannot race that eviction. localStorage remains the durable store for normal
// browsers; closing the tab still drops this fallback.
function credentialGet(key: string) {
  return localStorage.getItem(key) ?? sessionStorage.getItem(`${SESSION_CREDENTIAL_PREFIX}${key}`);
}

function credentialSet(key: string, value: string) {
  sessionStorage.setItem(`${SESSION_CREDENTIAL_PREFIX}${key}`, value);
  localStorage.setItem(key, value);
}

function credentialRemove(key: string) {
  sessionStorage.removeItem(`${SESSION_CREDENTIAL_PREFIX}${key}`);
  localStorage.removeItem(key);
}
api.interceptors.request.use((request) => {
	const csrf = csrfCredential();
	if (csrf) request.headers.set("X-CSRF-Token", csrf);
	return request;
});

/** Clear session and send the user to login (idempotent). */
export function forceLogout(redirect = true) {
  if (logoutInProgress) return;
  logoutInProgress = true;
	 authDebug("force-logout");
  delToken("forced logout");
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
	const refresh_token = credentialGet(REFRESH);
	const csrf = csrfCredential();
	const cookieSession = credentialGet(COOKIE_SESSION) === "1";
	if (!refresh_token && (!cookieSession || !csrf)) throw new Error("missing refresh credential");
  const response = await refreshClient.post(
		"/auth/refresh",
		refresh_token ? { refresh_token, device_id: deviceID() } : { device_id: deviceID() },
		{ headers: csrf ? { "X-CSRF-Token": csrf } : {} },
	);
  if (!hasCoherentCredential(response.data?.access_token, response.data?.refresh_token, response.data?.csrf_token ?? csrf)) {
		throw new Error("incomplete refresh response");
	}
  const credential: RotatedCredential = {
	accessToken: response.data.access_token,
	refreshToken: response.data.refresh_token || undefined,
	csrfToken: response.data.csrf_token ?? csrf ?? undefined,
  };
  return finalizeRotatedCredential(
	sessionEpoch,
	capturedEpoch,
	credential,
	(next) => storeToken(next.accessToken, next.refreshToken, next.csrfToken),
	(next) => revokeRefreshCredential(next.refreshToken ?? null, next.csrfToken),
  );
}

export function isTokenExists() {
  return getToken() !== undefined;
}

export function getToken() {
	const token = credentialGet(TOKEN);
	const refreshToken = credentialGet(REFRESH);
	const csrf = credentialGet(CSRF);
	const cookieSession = credentialGet(COOKIE_SESSION) === "1";
	if (!token || !hasCoherentCredential(token, refreshToken, cookieSession ? csrf : null)) {
		authDebug("credential-rejected", {
			hasAccess: Boolean(token), hasRefresh: Boolean(refreshToken), hasCSRF: Boolean(csrf), cookieSession,
		});
		// Reject unmarked legacy access-only storage, while retaining an
		// explicitly established HttpOnly-cookie session.
		if (token !== null || refreshToken !== null || credentialGet(NAME) !== null || csrf !== null) {
			delToken("incomplete credential");
		}
		return undefined;
	}
	// Access credentials are opaque to the SPA. The backend is authoritative
	// for their format and validity; a 401 drives refresh and one retry.
	return token;
}

export function delToken(reason = "unspecified") {
	authDebug("credential-cleared", { reason });
	sessionEpoch.invalidate();
  accessTokenRecovery.reset();
	credentialRemove(TOKEN);
	credentialRemove(NAME);
	credentialRemove(REFRESH);
	credentialRemove(CSRF);
	credentialRemove(COOKIE_SESSION);
}

export function setToken(token_value: string, refreshToken?: string, csrfToken?: string) {
	csrfToken ||= csrfCookie();
	authDebug("set-token-response", {
		hasAccess: Boolean(token_value), hasRefresh: Boolean(refreshToken), hasCSRF: Boolean(csrfToken),
	});
	if (!hasCoherentCredential(token_value, refreshToken, csrfToken)) {
		delToken("incomplete server response");
		throw new Error("incomplete session credential");
	}
	sessionEpoch.invalidate();
  accessTokenRecovery.reset();
	storeToken(token_value, refreshToken!, csrfToken);
	authDebug("token-stored", {
		hasAccess: Boolean(credentialGet(TOKEN)), hasRefresh: Boolean(credentialGet(REFRESH)), hasCSRF: Boolean(credentialGet(CSRF)),
	});
  logoutInProgress = false;
}

function storeToken(token_value: string, refreshToken?: string, csrfToken?: string) {
	let displayName = "";
	try {
		const decoded = jwtDecode<JwtPayload>(token_value);
		displayName = decoded.login ?? decoded.name ?? "";
	} catch {
		// Display metadata is optional. Never discard a server-issued session
		// merely because its access credential is not a browser-decodable JWT.
	}
	credentialSet(TOKEN, token_value);
	credentialSet(NAME, displayName);
	if (refreshToken) {
		credentialSet(REFRESH, refreshToken);
		credentialRemove(COOKIE_SESSION);
	} else {
		credentialRemove(REFRESH);
		credentialSet(COOKIE_SESSION, "1");
	}
	if (csrfToken) credentialSet(CSRF, csrfToken);
}

function csrfCredential() {
	return credentialGet(CSRF) || csrfCookie();
}

function csrfCookie() {
	const prefix = "csrf_token=";
	const raw = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
	if (!raw) return undefined;
	try {
		return decodeURIComponent(raw.slice(prefix.length));
	} catch {
		return undefined;
	}
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
	const refresh_token = credentialGet(REFRESH);
	const csrf = csrfCredential();
	// Explicit logout is locally immediate, but StrictMode and repeated clicks
	// share the same server revocation before the route navigates to login.
	delToken("explicit logout");
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
  return credentialGet(NAME);
}
