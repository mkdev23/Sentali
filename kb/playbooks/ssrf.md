---
title: Server-Side Request Forgery (SSRF) mitigation playbook
source: sentali
tags: [playbook, ssrf, egress, allowlist]
lastReviewed: 2025-09-11
---

# Server-Side Request Forgery (SSRF) mitigation playbook

## Prevent
- **URL allowlists; block IPs/metadata (169.254.169.254)**
- **No redirects to internal addresses**
- **Network egress controls; VNet isolation**
- **Fetch with scheme/host/IP validation and DNS pinning where possible**