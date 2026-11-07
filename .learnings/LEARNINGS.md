# Learnings

## [LRN-20261004-001] correction

**Logged**: 2026-10-04T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: architecture

### Summary
Matter's requested local sandbox is a VM boundary, not a controlled host Bash tool.

### Details
The user explicitly wants the Matter desktop client to provide an isolated local VM environment for CLI workloads such as OCR and media conversion. Host Bash must not be treated as the sandbox. Bash may be used only as a command interface inside the VM.

### Suggested Action
Evaluate WebVM/CheerpX or a native local VM integration. Keep host filesystem exchange and process control behind explicit, validated bridges.

### Metadata
- Source: user_feedback
- Related Files: docs/wiki/modules/local-agent-gateway.md
- Tags: vm, sandbox, architecture

---

## [LRN-20261105-qa-inline] correction

**Status**: resolved
**Area**: frontend

User feedback clarified that reusing QA capabilities does not mean copying the full client composer/collapse shell. In compact desktop-pet cards, render free input in the card and preserve the original next/send/submit/explicit-skip decisions in one footer. The bottom editor is a separate new Matter platform chat, never a send into the currently open project or conversation. Verify visible interaction through the entire shadow/ancestor chain, not programmatic clicks alone.
