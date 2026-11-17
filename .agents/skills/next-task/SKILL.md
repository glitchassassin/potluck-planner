---
name: next-task
description: Identify GitHub issues ready to implement and pull requests ready to review, and start an implementation or review thread when requested.
---

1. Check for open, unblocked issues, and draft or published pull requests.
2. Open, unblocked Feature issues are ready to be broken down into Tasks.
3. Open, unblocked Task or Bug issues that do not have a current thread or pull request are ready to implement.
4. My draft pull requests, or pull requests created by another user, need to be reviewed.

The normal workflow:

1. When the user requests an implementation thread for an issue, assign the issue to the user and start a thread in a new worktree with the issue link. Name the branch `nnn-short-slug` where `nnn` is the issue number. When the implementation is ready, create a draft PR with the changes.
2. When the user requests a review thread for a pull request, start a thread in a new worktree with the PR link. Conduct a read-only review, without updating or commenting on the PR.
