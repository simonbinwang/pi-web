# Domain Docs

This repository uses a single-context domain documentation layout.

## Before exploring

Read:

- `CONTEXT.md` at the repository root
- Relevant ADRs under `docs/adr/`

If either is absent, proceed silently. Domain-modeling skills create them lazily when terminology or decisions are resolved.

## Use the glossary vocabulary

Use domain terms as defined in `CONTEXT.md` in issue titles, proposals, hypotheses, and test names. Avoid synonyms that the glossary explicitly rejects.

If a needed concept is absent, reconsider whether the project uses another term or record the gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, identify the conflict explicitly rather than silently overriding the decision.
