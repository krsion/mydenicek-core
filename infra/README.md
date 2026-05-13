# Infrastructure RBAC matrix

| Principal                     | Scope          | Role                           |
| ----------------------------- | -------------- | ------------------------------ |
| sync VMSS managed identity    | `sa-acl`       | Storage Table Data Reader      |
| ACL service managed identity  | `sa-acl`       | Storage Table Data Contributor |
| Sync + ACL managed identities | `kv-mydenicek` | Key Vault Secrets User (RBAC)  |

The sync → acl table reader assignment is required for peer-key and ACL lookups.
