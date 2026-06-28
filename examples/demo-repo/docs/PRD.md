# Demo PRD: Project Name Validation

## User Goal

A user wants to create a project and needs immediate validation for the project name before any project record is created.

## Functional Requirements

- Provide `validateProjectName(name: string)`.
- Return a structured result with `valid` and `reason`.
- Reject an empty string.
- Reject a string containing only whitespace.
- Reject names longer than 80 characters.
- Accept normal project names.

## Non-Goals

- Do not implement UI.
- Do not implement database persistence.
- Do not implement authentication.
- Do not implement remote API calls.

## Validation

- Add tests for empty string, whitespace-only string, overly long names, and valid names.
- Run the demo test command:

```bash
npm test -- examples/demo-repo/tests/sample-feature.test.ts
```

## Risks

- Validation rules may drift if future UI or API layers duplicate project name validation instead of reusing this function.
