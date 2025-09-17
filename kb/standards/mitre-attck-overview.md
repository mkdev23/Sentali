---
title: MITRE ATT&CK overview and defender usage
source: mitre
tags: [mitre, attck, ttp, detection, mapping]
lastReviewed: 2025-09-11
---

# MITRE ATT&CK overview and defender usage

## Summary
A knowledge base of adversary tactics and techniques (TTPs) grounded in real-world observations for Enterprise, Mobile, and ICS.

## What to map
- **Tactics:** Recon → Resource Dev → Initial Access → Execution → Persistence → Priv Esc → Defense Evasion → Credential Access → Discovery → Lateral Movement → Collection → C2 → Exfiltration → Impact.
- **Techniques/Sub-techniques:** Specific methods under each tactic.

## Defender workflow
- **Map detections:** Align SIEM/EDR rules to techniques (e.g., T1059).
- **Gap analysis:** Identify uncovered techniques; add telemetry.
- **Mitigations:** Apply hardening per technique page; add controls to block common paths.
- **Testing:** Use ATT&CK Navigator + emulation to validate coverage.

## References
- MITRE ATT&CK
