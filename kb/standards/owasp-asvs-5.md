---
title: OWASP ASVS v5.0 essentials and usage
source: owasp
tags: [owasp, asvs, verification, requirements, sdlc]
lastReviewed: 2025-09-11
---

# OWASP ASVS v5.0 essentials and usage

## Summary
Requirement catalog for building and verifying web/app security controls. Use as acceptance criteria and test oracles.

## Levels and scope
- **Levels:** L1 (baseline), L2 (sensitive), L3 (critical).
- **Domains (examples):** V1 Arch/Design, V2 Auth, V3 Session, V4 Access Control, V5 Validation/Sanitization, V7 Cryptography, V9 Logging, V14 Config.

## How to apply
- **Plan:** Choose ASVS level per asset sensitivity; map to stories.
- **Build:** Treat ASVS items as Definition of Done; add lint/test gates.
- **Verify:** Link pentest and automated checks to ASVS IDs.
- **Track:** Maintain coverage matrix and exceptions with compensating controls.

## Practical tips
- **Automate where possible:** Map linter/DAST/IAST to ASVS IDs.
- **Evidence:** Keep config/code links for audits (e.g., V2.1.1 password length policy).

## References
- OWASP ASVS
