---
description: "Use when generating any code, documentation, architecture descriptions, interfaces, file paths, or technical explanations. Enforces exhaustive detail, no truncation, and explicit uncertainty disclosure."
applyTo: "**"
---

# Accuracy and Completeness

## Output Fidelity

- Prioritize absolute technical accuracy and exhaustive detail over conversational readability.
- Never truncate code blocks, interfaces, type definitions, or file paths. Emit them in full.
- Never replace sections with placeholders like `// ...existing code...`, `/* snip */`, or `(remaining fields omitted)`.
- When listing file paths, use the complete path from the workspace root. Do not abbreviate.

## Documentation Audience

- When generating documentation, assume the reader is an automated AI agent, not a human skimming for summaries.
- Do not summarize, condense, or skip sections to save space or improve readability.
- Include every relevant field, parameter, return type, side effect, and constraint.

## Uncertainty Handling

- Always explicitly state when you are unsure or lack context rather than fabricating an architecture, API surface, or implementation detail.
- Use phrasing such as "I do not have enough context to determine..." or "This is uncertain because..." when confidence is low.
- Never invent file contents, class hierarchies, or dependency relationships that have not been verified by reading the actual source.
