---
title: Cross-Site Scripting (XSS) mitigation playbook
source: sentali
tags: [playbook, xss, encoding, csp]
lastReviewed: 2025-09-11
---

# Cross-Site Scripting (XSS) mitigation playbook

## Prevent
- **Contextual output encoding (HTML/Attr/URL/JS)**
- **CSP with nonces; avoid unsafe-inline**
- **Template engines that auto-escape**
- **Sanitize rich-text with allowlists**

## Detect
- **CSP violation reports**
- **Anomalous DOM sinks usage**

## Example (Express headers)
```ts
res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self' 'nonce-{{nonce}}'");