# Auth master

Auth-master is the only runtime source for identity, sessions, OTP, invitations,
bans, roles, and superuser authority. The browser talks to the same-origin
`/auth/*` backend-for-frontend routes served by `go-auth`; it never calls
`authd` directly.

## In This Project

- Public search pages stay public.
- Admin data mutations require the `admin` role.
- Superuser-only actions include invitations, user listing and bans, role
  assignment, session management, and signing-key rotation.
- Every protected request revalidates the access token through auth-master.
- The backend does not trust local JWT verification, stale cached role data, or
  the legacy PostgreSQL users table for runtime authorization.

## Main Flow

1. The frontend restores a cookie-backed session on app startup.
2. Login, magic-link callback, registration, reset, and session-management calls
   go through fixed `/auth/*` routes.
3. Auth-master returns the authoritative user and role state.
4. Backend middleware fails closed on invalid tokens, upstream outages, oversized
   responses, malformed upstream JSON, or non-allowlisted proxy fields.

## Code Links

- [App session restore](../../../frontend/src/App.tsx)
- [Frontend auth API helpers](../../../frontend/src/shared/api.ts)
- [Admin routes and pages](../../../frontend/src/Admin/Admin.tsx)
- [Backend route wiring](../../../backend/admin/internal/presentation/http/router.go)
- [Auth-master BFF handler](../../../backend/admin/internal/presentation/http/authmaster/handler.go)
- [Auth-master middleware](../../../backend/admin/internal/presentation/http/authmaster/middleware.go)
- [Auth-master client](../../../backend/admin/internal/infrastructure/authmaster/client.go)
- [Authoritative docs](../../AUTH_MASTER.md)

## Related Notes

- [[Local dev]]
- [[Auth e2e]]
- [[Production deploy]]
- [[Search UI]]
