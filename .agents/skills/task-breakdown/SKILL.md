---
name: task-breakdown
description: Break a GitHub issue into implementation tasks with acceptance criteria and test cases. Use when asked to plan or slice work for a GitHub issue.
---

1. User must specify a GitHub issue; if you're not sure, ask.
2. Look up the issue's text, comments, and related issues for context. Review the codebase for relevant connection points.
3. Ask questions, one at a time, to clarify uncertain or ambiguous requirements. Stop when the requirements are clear or the user is satisfied with the current level of detail.
4. Once requirements have been clarified, break the work into implementation slices:
   1. Each task should leave main in a stable state, no broken/incomplete features.
   2. Tasks should not depend on work planned in future features.
   3. Prefer tasks that can be worked in parallel.
   4. Each task should include tests for its functionality
   5. The final task should implement end-to-end tests covering the user stories in the GitHub issue
5. Present the draft to the user. Do not create or update tasks in GitHub until the user has approved the draft.
6. Once the user has approved the draft, create sub-issues in GitHub, linking dependencies between the implementation tasks as blocking relationships.

Template for implementation tasks:

```shell
## Description

{{ one paragraph describing the task }}

## Related Systems

{{ bulleted list of related modules/pages/connection points at a high level }}

## Acceptance Criteria

{{ bulleted list with the definition of done }}

## Test Cases

{{ bulleted list of other important test cases not covered by the acceptance criteria }}
```
