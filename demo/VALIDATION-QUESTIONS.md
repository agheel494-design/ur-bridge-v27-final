# UR Capability Runtime — External Validation

## What you just watched

An agent-generated code snippet ran under an explicit capability policy. What is actually claimed, precisely:

> **The tested filesystem/network capability boundary rejects the unauthorized operation before the external action occurs — within the scenarios exercised.**

This is deliberately **not** the claim "UR is secure" or "the filesystem is secure." Those are broader claims than the evidence supports, and we are not making them. What has been shown to hold, specifically:

- A capability check happens, and only *after* a decision is made does any real action occur (or not occur).
- Every check — granted or denied — is recorded in an audit log.
- A runaway snippet is stopped by a timeout, not left to run forever.
- Reaching outside the two specific capabilities entirely (arbitrary native code execution) is refused unconditionally.

What is **not** claimed: that every possible way of trying to reach the filesystem/network has been tested, that this has been reviewed by an independent security researcher, or that it is ready for production use with real secrets or real production systems.

---

## Please answer honestly — there are no "right" answers we're hoping to hear

### 1. What problem do you think this solves?

*(If you can't answer this without us explaining it first, that itself is useful information.)*

### 2. Why would you use this instead of WASM (or a container, or a sandboxing library you already use)?

*(If your honest answer is "I don't know" or "I wouldn't," please say so plainly. That is a valid and useful answer.)*

### 3. Can you picture a real situation where you'd actually reach for this?

*(A specific scenario, not a general "sure, maybe someday.")*

### 4. What would you need to see before you'd trust this with something real?

*(This is possibly the most important question. Your answer might point at something we haven't built yet — secrets handling, resource limits beyond time, observability, language ergonomics, or something else entirely.)*

---

Thank you for your time. Please reply with your four answers — however short or blunt.
