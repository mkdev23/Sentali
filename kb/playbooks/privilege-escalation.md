---
title: Privilege escalation mitigation playbook
source: sentali
tags: [playbook, privilege-escalation, rbac, least-privilege]
lastReviewed: 2025-09-11
---

# Privilege escalation mitigation playbook

## Prevent
- **Strict RBAC/ABAC; SoD**
- **No wildcard permissions; scoped tokens**
- **Input validation on role-changing endpoints**
- **Service boundaries; no shared high-privilege identities**

## Detect
- **Role change/aad group change alerts**
- **Unusual admin API access patterns**
