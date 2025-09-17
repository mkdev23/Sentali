---
title: "Azure security patterns: RBAC, Managed Identity, SAS, Private Endpoints"
source: microsoft
tags: [azure, rbac, managed-identity, sas, private-endpoint, network]
lastReviewed: 2025-09-11
---


# Azure security patterns: RBAC, Managed Identity, SAS, Private Endpoints

## RBAC
- **Least privilege:** Assign narrowly scoped roles; prefer Data Plane roles for data access.
- **Custom roles:** Grant only required actions; avoid *.

## Managed Identity (MI)
- **Use MI over keys:** Fetch tokens via MSI endpoint; rotate automatically.
- **Service-to-service:** MI + role assignment on Cosmos, Storage, Key Vault.

## SAS (user delegation)
- **Short-lived:** Minutes, not hours; restrict to required verbs/paths.
- **User delegation:** Prefer over account SAS; align with RBAC.

## Private Endpoints
- **Isolation:** Disable public access; use Private DNS Zones; VNet integration.
- **Egress control:** Outbound allowlists; deny metadata endpoints where applicable.

## Example: Storage with MI
```ts
const credential = new DefaultAzureCredential();
const client = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
