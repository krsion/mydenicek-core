# Architecture

## Hub-spoke topology

```mermaid
flowchart LR
  Hub[Hub VNet\n10.0.0.0/16]
  Frontend[Spoke Frontend\n10.1.0.0/16\nsubnet 10.1.0.0/24]
  Sync[Spoke Sync\n10.2.0.0/16\nsubnet 10.2.0.0/24]
  API[Spoke API\n10.3.0.0/16\nsubnet 10.3.0.0/24]
  Data[Spoke Data (PE only)\n10.4.0.0/16\nsubnet 10.4.0.0/24]

  Hub --- Frontend
  Hub --- Sync
  Hub --- API
  Hub --- Data
```

## Service interaction

```mermaid
flowchart LR
  Web[React app\napps/mywebnicek]
  Sync[Sync WS service]
  Docs[docs-api]
  ACL[acl]
  Att[attachments]
  SA1[(sa-sync-events blob)]
  SA2[(sa-docs table)]
  SA3[(sa-acl table + files)]
  SA4[(sa-attachments blob)]

  Web --> Sync
  Web --> Docs
  Web --> ACL
  Web --> Att
  Sync --> SA1
  Docs --> SA2
  ACL --> SA3
  Att --> SA4
```

## Identity flow

```mermaid
sequenceDiagram
  participant Browser
  participant MSAL
  participant Entra
  participant Service

  Browser->>MSAL: Sign in with Microsoft
  MSAL->>Entra: Authorization Code + PKCE
  Entra-->>MSAL: ID/Access token
  MSAL-->>Browser: access_token
  Browser->>Service: Authorization: Bearer token
  Service->>Entra: JWKS discovery/validation
  Service-->>Browser: Authorized response
```
