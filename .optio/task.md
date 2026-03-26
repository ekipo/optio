# feat: Task dependencies and multi-step workflows

feat: Task dependencies and multi-step workflows

## Problem

Can't chain tasks together (run tests after refactor, deploy after tests pass). No conditional logic or approval gates.

## Features

### Task Dependencies
- `dependsOn: [taskId]` field — task stays queued until dependencies complete
- DAG validation (no circular dependencies)
- Cascade failure (if dependency fails, dependent tasks fail too)

### Workflow Templates
- Define multi-step workflows (sequence of tasks with conditions)
- Conditions: "if previous task opened PR", "if CI passes", "if cost < $X"
- Approval gates: task pauses until a user approves

### Web UI
- Visual workflow builder (drag-and-drop DAG)
- Workflow execution view showing progress through steps

## Acceptance Criteria
- [ ] Tasks can declare dependencies on other tasks
- [ ] Dependent tasks auto-start when dependencies complete
- [ ] Circular dependency detection
- [ ] Cascade failure on dependency failure
- [ ] Workflow template CRUD

---
*Optio Task ID: 9b6d80f5-5242-4633-9e2c-9f7f72aa2a2b*