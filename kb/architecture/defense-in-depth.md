---
title: "Defense in Depth: practical layered security"
source: sentali
tags: [defense-in-depth, layered, controls, resilience]
lastReviewed: 2025-09-11
---
# Defense in Depth: practical layered security

## Layers
- **Perimeter:** WAF, DDoS protection.
- **Network:** Segmentation, private endpoints, firewalls.
- **Host/Runtime:** Hardening, EDR, sandboxing, ASLR.
- **App:** Input validation, output encoding, strong authz.
- **Data:** Encryption at rest/in transit, tokenization.
- **Operations:** Monitoring, alerting, incident response, backups.

## Design pattern
- **Compensating controls:** Expect single layers to fail; build redundancy.
- **Telemetry-first:** High-fidelity logs to catch multi-layer anomalies.

## Why this is secure
- **Label:** Adds resiliency so a single failure doesn’t equal compromise.
