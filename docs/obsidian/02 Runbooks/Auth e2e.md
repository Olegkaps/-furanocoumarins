# Auth e2e

The auth e2e flow validates the private auth-master integration, same-origin
`/auth/*` browser surface, Mailpit email flow, and protected admin behavior.
Use it after auth, session, invitation, role, or admin-access changes.

## Command

```bash
make test-e2e
```

This delegates to:

```bash
./scripts/auth-e2e.sh
```

## What It Exercises

- Isolated Compose project.
- Source and auth PostgreSQL services.
- Private `authd`.
- Mailpit, exposed by the e2e stack for browser-visible email assertions.
- `go-auth` BFF routes.
- Frontend browser journeys through Playwright.
- Passwordless migrated-superuser flow.
- Password login/reset and account-security behavior.
- Fail-closed protected operations.

## Debug Variant

```bash
make test-e2e-proxy-debug
```

The debug target narrows the browser run and enables additional auth proxy
diagnostics.

## Evidence To Capture

- The exact command run.
- Any failing Playwright spec name.
- Relevant `go-auth`, `authd`, and Mailpit logs.
- Browser-visible route involved, such as `/login`, `/admit`, `/register`,
  `/admin`, or `/admin/metadata`.

## Code Links

- [Auth e2e script](../../../scripts/auth-e2e.sh)
- [Playwright auth specs](../../../frontend/e2e/auth-master.spec.ts)
- [Auth integration guide](../../AUTH_MASTER.md)
- [Makefile targets](../../../Makefile)

## Related Notes

- [[Auth master]]
- [[Local dev]]
- [[Production deploy]]
