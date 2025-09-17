---
title: OWASP Top 10 (2021) overview and mitigations
source: owasp
tags: [owasp, web, top10, mitigations, checklist]
lastReviewed: 2025-09-11
---

# OWASP Top 10 (2021) overview and mitigations

## Summary
High-impact web application risk categories with practical mitigations for modern stacks.

## Key risks and quick mitigations
- **A01: Broken Access Control:** 
  - Enforce server-side authorization checks; deny by default; use ABAC/RBAC; test horizontal/vertical escalation.
- **A02: Cryptographic Failures:** 
  - Use TLS 1.2+; modern AEAD ciphers; never roll your own crypto; rotate keys; don’t log secrets.
- **A03: Injection:** 
  - Parameterized queries/ORM prepared statements; strict input validation & encoding; avoid string concatenation.
- **A04: Insecure Design:** 
  - Threat model early; security requirements (ASVS); abuse-case tests; secure defaults.
- **A05: Security Misconfiguration:** 
  - IaC baselines; disable directory listing/debug; least-privileged service accounts; consistent hardening.
- **A06: Vulnerable and Outdated Components:** 
  - SBOM; pin & scan dependencies; renovate/bot updates; verify signatures.
- **A07: Identification and Authentication Failures:** 
  - MFA; lockouts; secure password storage (bcrypt/argon2); short session lifetimes; refresh token hygiene.
- **A08: Software and Data Integrity Failures:** 
  - Signed updates; checksum verification; supply-chain trust policies; CI/CD provenance.
- **A09: Security Logging and Monitoring Failures:** 
  - Centralized logs; tamper-evident storage; alert on authz/authn anomalies; retain per policy.
- **A10: Server-Side Request Forgery (SSRF):** 
  - Block metadata endpoints; egress allowlists; validate URLs by scheme/host/IP; VNet isolation.

## Implementation checklist
- **Design:** Threat model; ASVS scoping; deny-by-default.
- **Code:** Param queries; output encoding; secure crypto libs only.
- **Config:** Harden frameworks; remove defaults; IaC baselines.
- **Ops:** SBOM + dependency scanning; centralized logging + alerts.

## References
- OWASP Top 10
