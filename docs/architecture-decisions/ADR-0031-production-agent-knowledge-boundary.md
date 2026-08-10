# ADR-0031 — Production Agent Knowledge Boundary

## Status
Accepted — Phase 6 Step 6.11

## Problem
The controlled Atlas retrieval and context assembly pipeline is verified and ready for agent consumption. Introducing an agent runtime must not allow callers to choose arbitrary Atlas permissions, tasks, security classifications, or unbounded context sizes. Model/provider integration and autonomous external actions are not yet justified for the pilot.

## Decision
Use the Production Agent as the first agent knowledge-integration pilot and give it a narrow, read-only Atlas knowledge preparation service.

The Production Agent knowledge boundary must:

1. use the fixed agent identity `production_agent`;
2. use the fixed Atlas task `website_development`;
3. enforce an `internal` maximum security classification;
4. retrieve no more than eight ranked Atlas chunks per preparation request;
5. cap assembled Atlas context at 12,000 characters;
6. accept only a production objective and an optional smaller context budget from the caller;
7. preserve the full controlled context package, citations, provenance, checksums, and truncation state;
8. perform no LLM invocation, email, deployment, purchase, publishing, or other external side effect.

## Reason
Starting with a fixed agent-specific knowledge boundary proves that agents consume Atlas through policy rather than through unrestricted database access. The Production Agent is the best first pilot because website-development retrieval has already been evaluated successfully against the real Atlas corpus.

## Security impact
Agent identity, task scope, and knowledge security ceiling are application policy and cannot be elevated by request input. The integration remains read-only and inherits the verified retrieval and context controls.

## Cost impact
No new recurring cost. No LLM, embedding, vector database, or external agent platform is introduced in this slice.

## Deferred work
Model-provider selection, prompt execution, grounded response validation, tool/action permissions, human approval gates, deployment actions, and additional Lead/Sales agent integrations remain deferred until this boundary passes local and real-data verification.
