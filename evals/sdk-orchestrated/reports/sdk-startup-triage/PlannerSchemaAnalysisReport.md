# Planner Schema Analysis

Date: 2026-06-20

planner-lite is lower complexity and should be used as SDK outputSchema; full TaskGraph validation remains in orchestrator post-processing.

## schema-output-minimal

Schema depth: 4
Property count: 2
Required count: 2
Enum count: 1
Array count: 0
Nested object count: 0
$ref count: 0
oneOf count: 0
anyOf count: 0
allOf count: 0
patternProperties count: 0
additionalProperties usage: 1
format usage: 0
default usage: 0
nullable usage: 0
Description total chars: 0
Largest property path: $.properties.message
High risk keywords: none
Complexity score: 26

## schema-output-planner

Schema depth: 8
Property count: 23
Required count: 20
Enum count: 0
Array count: 6
Nested object count: 4
$ref count: 9
oneOf count: 0
anyOf count: 0
allOf count: 0
patternProperties count: 0
additionalProperties usage: 5
format usage: 0
default usage: 0
nullable usage: 0
Description total chars: 180
Largest property path: $.properties.task_graph.properties.edges.items.properties.from_task_id
High risk keywords: $ref
Complexity score: 186

## schema-output-lite

Schema depth: 4
Property count: 5
Required count: 5
Enum count: 1
Array count: 2
Nested object count: 0
$ref count: 0
oneOf count: 0
anyOf count: 0
allOf count: 0
patternProperties count: 0
additionalProperties usage: 1
format usage: 0
default usage: 0
nullable usage: 0
Description total chars: 0
Largest property path: $.properties.acceptance_criteria
High risk keywords: none
Complexity score: 38

