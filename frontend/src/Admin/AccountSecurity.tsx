import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "./utils";

type User = { id: string; login: string; email?: string; superuser: boolean; banned_at?: string };
type Session = { id: string; device_id?: string; device_label?: string; created_at: string; revoked?: boolean; revoked_at?: string };
type Role = { id: string; name: string };
const authHeaders = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });
const ADMIN_ROLE_PAGE_SIZE = 25;
const ADMIN_ROLE_MAX_PAGES = 1000;

class AdminRoleDiscoveryError extends Error {}

export default function AccountSecurity() {
  const [superuser, setSuperuser] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
	const [userCursor, setUserCursor] = useState("");
	const [userSearch, setUserSearch] = useState("");
	const [loadingUsers, setLoadingUsers] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
	const [roles, setRoles] = useState<Role[]>([]);
  const [invite, setInvite] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
	const fetchAdminRole = useCallback(async (signal?: AbortSignal) => {
		let cursor = "";
		const seenCursors = new Set<string>();
		for (let page = 0; page < ADMIN_ROLE_MAX_PAGES; page += 1) {
			const result = await api.get("/auth/admin/roles", {
				headers: authHeaders(),
				signal,
				params: { q: "admin", cursor: cursor || undefined, page_size: ADMIN_ROLE_PAGE_SIZE },
			});
			const matches = (result.data.roles ?? []).filter((role: Role) => role.name === "admin");
			if (matches.length === 1) return matches[0] as Role;
			if (matches.length > 1) {
				throw new AdminRoleDiscoveryError("More than one exact admin role was returned. Repair auth-master role-name uniqueness and retry.");
			}
			const nextCursor = String(result.data.next_cursor ?? "");
			if (!nextCursor) {
				throw new AdminRoleDiscoveryError(`The exact admin role was not found after checking ${page + 1} role page${page === 0 ? "" : "s"}. Verify auth-master bootstrap and retry.`);
			}
			if (nextCursor === cursor || seenCursors.has(nextCursor)) {
				throw new AdminRoleDiscoveryError("Admin role lookup stopped because auth-master repeated a pagination cursor. Retry, then check auth-master pagination.");
			}
			seenCursors.add(nextCursor);
			cursor = nextCursor;
		}
		throw new AdminRoleDiscoveryError(`Admin role lookup exceeded ${ADMIN_ROLE_MAX_PAGES} pages. Narrow the role catalog or inspect auth-master pagination.`);
	}, []);
	const fetchUsers = useCallback(async (query: string, cursor = "", append = false, signal?: AbortSignal) => {
		setLoadingUsers(true);
		try {
			const result = await api.get("/auth/admin/users", { headers: authHeaders(), signal, params: { q: query || undefined, cursor: cursor || undefined, page_size: 25 } });
			const page = result.data.users ?? [];
			setUsers((current) => append ? [...current, ...page.filter((user: User) => !current.some((item) => item.id === user.id))] : page);
			setUserCursor(result.data.next_cursor ?? "");
		} finally {
			setLoadingUsers(false);
		}
	}, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setError("");
	  const currentHeaders = authHeaders();
	  const [me, ownSessions] = await Promise.all([api.get("/auth/me", { headers: currentHeaders, signal }), api.get("/auth/sessions", { headers: currentHeaders, signal })]);
      setSuperuser(Boolean(me.data.superuser)); setSessions(ownSessions.data.sessions ?? ownSessions.data ?? []);
	  if (me.data.superuser) {
		  const [, adminRole] = await Promise.all([fetchUsers("", "", false, signal), fetchAdminRole(signal)]);
		  setRoles([adminRole]);
	  }
	} catch (loadError) {
	  if (axios.isCancel(loadError)) return;
	  setError(loadError instanceof AdminRoleDiscoveryError ? loadError.message : "Could not load account security data");
    }
	// getToken is intentionally read for each request: access tokens rotate after
	// expiry and signing-key changes while this component remains mounted.
  }, [fetchAdminRole, fetchUsers]);
  useEffect(() => {
	const controller = new AbortController();
	void load(controller.signal);
	return () => controller.abort();
  }, [load]);
  async function perform(action: () => Promise<void>) {
	try {
		setError("");
		await action();
	} catch {
		setError("Account security action failed; try again");
	}
  }
  async function createInvite() {
	await perform(async () => {
		const result = await api.post("/auth/admin/invitations", { email: invite, ttl_seconds: 86400 }, { headers: authHeaders() });
		setNotice(result.data.registration_url ?? "Invitation created");
	});
  }
  async function ban(user: User) {
	await perform(async () => {
		if (user.banned_at) await api.delete(`/auth/admin/users/${user.id}/ban`, { headers: authHeaders() });
		else await api.post(`/auth/admin/users/${user.id}/ban`, { reason: "Banned from furanocoumarins" }, { headers: authHeaders() });
		await fetchUsers(userSearch);
	});
  }
  return <section className="admin-page" aria-label="Account security" data-testid="account-security">
    <h2>Account security</h2>
    <h3>Sessions</h3>
    {error && <p className="auth-card__error" data-testid="security-error">{error}</p>}
	{sessions.length === 0 ? <p className="empty-state">No sessions</p> : <ul data-testid="session-list">{sessions.map((s) => <li key={s.id} data-device-id={s.device_id}>{s.device_label || s.device_id || s.id} <span>{s.revoked || s.revoked_at ? "revoked" : "active"}</span> <button data-testid={`revoke-session-${s.id}`} className="btn" disabled={Boolean(s.revoked || s.revoked_at)} onClick={() => void perform(async () => { await api.delete(`/auth/sessions/${s.id}`, { headers: authHeaders() }); await load(); })}>Revoke</button></li>)}</ul>}
    {superuser && <><h3>Users and invitations</h3>
      <label>Invite email <input data-testid="invite-email" value={invite} onChange={(e) => setInvite(e.target.value)} /></label> <button data-testid="create-invite" className="btn" onClick={createInvite}>Create invitation</button>
      {notice && <p data-testid="security-notice">{notice}</p>}
	  <form onSubmit={(event) => { event.preventDefault(); void perform(() => fetchUsers(userSearch)); }}><label>Find users <input data-testid="user-search" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} /></label> <button className="btn" type="submit" disabled={loadingUsers}>Search</button></form>
	  {users.length === 0 ? <p className="empty-state">No users</p> : <ul data-testid="user-list">{users.map((u) => <li key={u.id} data-testid={`user-${u.login}`}>{u.login} {u.email} {u.superuser ? "(superuser)" : ""} <button data-testid={`ban-${u.login}`} className="btn" disabled={u.superuser} onClick={() => void ban(u)}>{u.banned_at ? "Unban" : "Ban"}</button> <button data-testid={`grant-admin-${u.login}`} className="btn" disabled={u.superuser} onClick={() => void perform(async () => { const admin = roles.find((r) => r.name === "admin"); if (!admin) throw new Error("admin role unavailable"); await api.post(`/auth/admin/roles/${admin.id}/members`, { user_id: u.id, level: "member" }, { headers: authHeaders() }); setNotice(`Granted admin to ${u.login}`); })}>Grant admin</button></li>)}</ul>}
	  {userCursor && <button data-testid="load-more-users" className="btn" disabled={loadingUsers} onClick={() => void perform(() => fetchUsers(userSearch, userCursor, true))}>{loadingUsers ? "Loading…" : "Load more users"}</button>}
	  <button data-testid="rotate-signing-key" className="btn" onClick={() => void perform(async () => { await api.post("/auth/admin/signing-keys/rotate", {}, { headers: authHeaders() }); setNotice("Signing key rotated"); })}>Rotate signing key</button>
    </>}
  </section>;
}
