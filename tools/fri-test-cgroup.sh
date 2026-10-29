#!/usr/bin/env bash
# tools/fri-test-cgroup.sh — run a command (typically the test suite) as an unprivileged user INSIDE A FULLY DELEGATED
# cgroup v2 subtree, so that UR's FRI containment (src/interpreter/interpret.ts friPrepareContainment + launcher) can do its
# real work: create one child cgroup per FRI step, move the launcher into it, verify membership, kill/clean up.
#
# Why: on hosts where the test user's own cgroup is not delegated (e.g. a GitHub Codespace as user `codespace`), every FRI call
# is - correctly - refused with FRI_CONTAINMENT_UNAVAILABLE (exit 101). Creating a directory is not enough: moving a process into a
# cgroup also needs write access to cgroup.procs of the common ancestor (cgroup v2 migration rule). This script performs the
# standard cgroup v2 delegation (kernel Documentation/admin-guide/cgroup-v2.rst, "Delegation"): the delegated directory and its
# cgroup.procs, cgroup.subtree_control and cgroup.threads are owned by the user, and the user's command starts inside it.
# It does NOT weaken, bypass or replace UR's containment - UR still refuses if containment cannot be established.
#
# Usage (needs root once, for the delegation itself):
#   sudo env "PATH=$PATH" bash tools/fri-test-cgroup.sh --user "$USER" -- npx vitest run
# Exit: the command's exit code; 3 = environment cannot provide delegated containment (nothing was run); 2 = usage error.
set -u
USER_NAME=""; NAME="ur-delegated-tests"
while [ $# -gt 0 ]; do
  case "$1" in
    --user) USER_NAME="${2:-}"; shift 2;;
    --name) NAME="${2:-}"; shift 2;;
    --) shift; break;;
    *) echo "usage: sudo bash $0 --user <name> [--name <cgroup-name>] -- <command...>" >&2; exit 2;;
  esac
done
[ -n "$USER_NAME" ] && [ $# -gt 0 ] || { echo "usage: sudo bash $0 --user <name> -- <command...>" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "fri-test-cgroup: must run as root (delegation needs it once)" >&2; exit 3; }
id "$USER_NAME" >/dev/null 2>&1 || { echo "fri-test-cgroup: unknown user $USER_NAME" >&2; exit 2; }
RUNUSER=$(PATH="$PATH:/usr/sbin:/sbin" command -v runuser) || { echo "fri-test-cgroup: runuser not found" >&2; exit 3; }

MP=$(awk '$3=="cgroup2"{print $2; exit}' /proc/mounts)
REL=$(sed -n 's/^0:://p' /proc/self/cgroup | head -1)
[ -n "$MP" ] || { echo "fri-test-cgroup: no cgroup v2 mount - FRI containment is impossible on this host" >&2; exit 3; }
[ -n "$REL" ] || { echo "fri-test-cgroup: this process has no cgroup v2 membership" >&2; exit 3; }
BASE="$MP${REL%/}"; [ "$REL" = "/" ] && BASE="$MP"
D="$BASE/$NAME-$$"
echo "fri-test-cgroup: cgroup2 mount=$MP own=$REL delegated=$D user=$USER_NAME"

if ! mkdir "$D" 2>/tmp/fri-test-cgroup.$$; then
  echo "fri-test-cgroup: cannot create $D: $(cat /tmp/fri-test-cgroup.$$) (cgroupfs read-only or not permitted in this container)" >&2
  rm -f /tmp/fri-test-cgroup.$$; exit 3
fi
rm -f /tmp/fri-test-cgroup.$$
cleanup() {
  for i in $(seq 1 50); do [ -z "$(cat "$D/cgroup.procs" 2>/dev/null)" ] && break; sleep 0.1; done
  for c in "$D"/*/; do [ -d "$c" ] && rmdir "$c" 2>/dev/null; done
  if rmdir "$D" 2>/dev/null; then echo "fri-test-cgroup: removed $D"; else echo "fri-test-cgroup: WARNING could not remove $D (members: $(cat "$D/cgroup.procs" 2>/dev/null | tr '\n' ' '))" >&2; fi
}
chown "$USER_NAME" "$D" "$D/cgroup.procs" "$D/cgroup.subtree_control" "$D/cgroup.threads" || { echo "fri-test-cgroup: chown failed" >&2; cleanup; exit 3; }

# Self-check as the user, inside the delegated cgroup, exactly the steps UR performs (P4 mkdir, P5 cgroup.kill, P6 procs writable,
# P7 join, P8 verify, P9 cleanup). If any fails, nothing is run.
check=$(sh -c 'echo $$ > "$1/cgroup.procs" && exec "$3" -u "$2" -- sh -c '"'"'
  C="$1/probe-$$"; R=$(sed -n "s/^0:://p" /proc/self/cgroup)
  mkdir "$C" || { echo "P4"; exit 1; }
  [ -e "$C/cgroup.kill" ] || { rmdir "$C"; echo "P5"; exit 1; }
  [ -w "$C/cgroup.procs" ] || { rmdir "$C"; echo "P6"; exit 1; }
  sh -c "echo \$\$ > \"$C/cgroup.procs\" && grep -qx \"0::${R%/}/probe-$$\" /proc/self/cgroup" || { sleep 0.2; rmdir "$C"; echo "P7/P8"; exit 1; }
  for i in 1 2 3 4 5 6 7 8 9 10; do [ -z "$(cat "$C/cgroup.procs")" ] && break; sleep 0.1; done
  rmdir "$C" || { echo "P9"; exit 1; }
  echo OK'"'"' probe "$1"' outer "$D" "$USER_NAME" "$RUNUSER" 2>&1 | tail -1)
if [ "$check" != "OK" ]; then echo "fri-test-cgroup: delegated containment self-check FAILED at $check - nothing was run" >&2; cleanup; exit 3; fi
echo "fri-test-cgroup: self-check P4-P9 OK as $USER_NAME"

# Run the command as the user inside the delegated cgroup (the root shell joins first; runuser inherits the cgroup).
sh -c 'echo $$ > "$1/cgroup.procs" && R="$2" && shift 2 && exec "$R" -u "$@"' outer "$D" "$RUNUSER" "$USER_NAME" -- "$@"
rc=$?
cleanup
echo "fri-test-cgroup: command exit $rc"
exit $rc
