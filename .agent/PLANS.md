# Codex Loop ExecPlan Standard

An ExecPlan is a self-contained living implementation document.

It must allow Codex to resume work without relying on prior chat history.

## When to Use

Use an ExecPlan for:

- complex features
- multi-module implementation
- refactors
- plugin development
- MCP server development
- orchestration logic
- long-running work that spans multiple Codex turns

## Required Sections

Every ExecPlan must contain:

1. Purpose
2. User-visible outcome
3. Current repository state
4. Module map
5. Milestones
6. Progress
7. Decision log
8. Data models
9. Public interfaces
10. Validation strategy
11. Risks
12. Recovery notes

## Module Entry Format

Each module must be written as:

### Mx: Module Name

Goal:

Inputs:

Outputs:

Files to inspect:

Files to modify:

Acceptance criteria:

Validation commands:

Risks:

Done status:

## Progress Format

Use checkboxes only in the Progress section.

Example:

- [x] M0 scaffold created
- [ ] M1 schemas implemented
- [ ] M2 plugin manifest implemented

## Decision Log Format

Record each decision as:

- Date:
- Decision:
- Reason:
- Alternatives considered:
- Impact:

## Recovery Notes

At the end of every module, write enough context for a new Codex thread to continue.

Recovery notes must include:

- current module
- completed modules
- open issues
- next exact action
- validation status
- known risks
