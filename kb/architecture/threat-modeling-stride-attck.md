---
title: Threat modeling with STRIDE and MITRE ATT&CK
source: sentali
tags: [threat-modeling, stride, attck, mitigations, template]
lastReviewed: 2025-09-11
---

# Threat modeling with STRIDE and MITRE ATT&CK

## STRIDE reminders
- **S:** Spoofing → Strong auth, tokens, PKI.
- **T:** Tampering → Integrity checks, signed artifacts.
- **R:** Repudiation → Non-repudiation, audit logs.
- **I:** Info disclosure → Encryption, access controls.
- **D:** DoS → Rate limiting, quotas, autoscale.
- **E:** Elevation → Least privilege, boundary checks.

## Mapping to ATT&CK
- **Technique alignment:** Map likely techniques (e.g., T1078 Valid Accounts) to detections and mitigations.
- **Coverage:** Use Navigator to visualize gaps.

## Template
- **Assets/actors/entry points**
- **Trust boundaries/data flows**
- **STRIDE findings + ATT&CK links**
- **Controls + residual risk**

## Why this is secure
- **Label:** Systematically uncovers design risks and ties them to observable attacker behaviors.
