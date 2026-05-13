# @mydenicek/shared-auth

Entra ID (Azure AD) JWT verification for mydenicek services.

## Usage

```typescript
import { verifyEntraToken } from "@mydenicek/shared-auth";

// Requires AZURE_TENANT_ID and AZURE_CLIENT_ID env vars.
const claims = await verifyEntraToken(bearerToken);
// claims: { oid, tid, name, roles, scopes }
```

## Environment variables

| Variable            | Description                          |
| ------------------- | ------------------------------------ |
| `AZURE_TENANT_ID`   | Entra tenant ID used to build issuer URL |
| `AZURE_CLIENT_ID`   | App registration client ID (audience) |

## Behaviour

- JWKS is fetched once from `https://login.microsoftonline.com/common/discovery/v2.0/keys` and cached in memory for the process lifetime.
- Throws `Error` for expired tokens, invalid signatures, wrong audience/issuer, or missing required claims (`oid`, `tid`).
- `roles` comes from the `roles` claim (app roles); `scopes` comes from the `scp` / `scope` claim (delegated scopes).
