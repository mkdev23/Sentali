---
title: NIST SP 800-53 & 800-63 concise summaries
source: nist
tags: [nist, 800-53, 800-63, controls, identity]
lastReviewed: 2025-09-11
---

# NIST SP 800-53 & 800-63 concise summaries

## SP 800-53 (Rev 5) control families (selected)
- **AC (Access Control):** RBAC/ABAC, least privilege, SoD, session mgmt.
- **AU (Audit):** Log content, protection, retention, analysis, alerts.
- **CM (Config Mgmt):** Baselines, change control, integrity checks.
- **IA (Identification & Auth):** MFA, secrets storage, reauth policies.
- **SC (System & Comm):** Boundary protection, crypto, isolation, fail-safe defaults.
- **SI (System & Info Integrity):** Flaw remediation, malware defense, monitoring.

## SP 800-63 Digital Identity
- **IAL (Identity Assurance Level):** Identity proofing strength.
- **AAL (Authenticator Assurance Level):** Authenticator strength (AAL2 MFA minimum for most).
- **FAL (Federation Assurance Level):** Assertion protection strength.

## Using in practice
- **Baseline:** Choose Low/Moderate/High; tailor controls.
- **Map to cloud:** Use provider shared responsibility, managed identity, and network isolation to satisfy AC/SC/SI.

## References
- NIST SP 800-53, NIST SP 800-63
