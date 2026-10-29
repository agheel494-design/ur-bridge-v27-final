# ARCHITECTURAL_DEBT.md

Backlog of deferred architectural issues. Not a governance document -
just a tracker. Items here are consciously deferred, not forgotten
and not bugs requiring immediate action.

---

## Architectural Issue (Deferred)

Reporter Diagnostic model cannot represent related.span; reconsider
only if the Reporter contract itself is redesigned.

Context: found during Diagnostics Adapter v1.0 (frozen -
src/compiler/diagnostics/adapter.ts). Not fixed there, per explicit
decision - see DIAGNOSTICS_ADAPTER_AUDIT.md in that same directory
for the full analysis.
