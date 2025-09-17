---
title: Remote Code Execution (RCE) mitigation playbook
source: sentali
tags: [playbook, rce, sandbox, deserialization]
lastReviewed: 2025-09-11
---

# Remote Code Execution (RCE) mitigation playbook

## Prevent
- **No eval/system with untrusted input**
- **Safe deserialization; avoid unsafe formats**
- **Library hygiene; signed updates**
- **Runtime sandboxing/AppArmor/SELinux; seccomp (where supported)**

## Detect
- **Child process anomalies; outbound C2 patterns**
- **Integrity checks on code and config**
