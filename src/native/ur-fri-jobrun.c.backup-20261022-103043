/*
 * ur-fri-jobrun.c — FRI R2-B Windows containment helper (V1.0-FRI-REMEDIATION-GATE).
 *
 * Usage:  ur-fri-jobrun.exe <backstopTimeoutMs> -- <program> [args...]
 *
 * Contract (PM R2 closure directive):
 *   CreateJobObject → KILL_ON_JOB_CLOSE → CreateProcess(CREATE_SUSPENDED)
 *   → AssignProcessToJobObject → verify (IsProcessInJob) → ResumeThread.
 *   Allowed limit flags ONLY: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
 *   JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION. No BREAKAWAY_OK, no
 *   SILENT_BREAKAWAY_OK - descendants cannot leave the job.
 *
 * Lifecycle:
 *   - root exits 0          → KILL_ON_JOB_CLOSE is cleared, then the job handle
 *                             is closed: leftover descendants SURVIVE (OPEN-3).
 *   - root exits non-zero   → TerminateJobObject: the whole tree dies.
 *   - backstop timeout      → TerminateJobObject (the Node supervisor normally
 *                             kills this helper first, at the real budget).
 *   - helper killed/crashes → its job handle closes → KILL_ON_JOB_CLOSE kills
 *                             the whole tree (W4).
 *   - containment cannot be established (job creation, limits, assignment,
 *     verification, resume) → the suspended process is terminated BEFORE it
 *     ever runs; stderr "UR_FRI_CONTAINMENT_FAILED:<step>:<win32 error>",
 *     exit code 125. The supervisor maps this to FRI_CONTAINMENT_UNAVAILABLE.
 *
 * Build (not performed by this Gate - no Windows toolchain available):
 *   MinGW-w64: x86_64-w64-mingw32-gcc -O2 -Wall -Wextra -municode -o bin/ur-fri-jobrun.exe ur-fri-jobrun.c
 *   MSVC     : cl /W4 /O2 /Fe:bin\ur-fri-jobrun.exe ur-fri-jobrun.c
 */
#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <io.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

#define EXIT_CONTAINMENT_FAILED 125
#define ALLOWED_FLAGS (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION)

/* Option B (FRI-FINDING-001): status pipe — write-end HANDLE received via --status-fd <crt-fd>.
 * The supervisor (Node.js) creates a pipe, passes the write end as CRT fd 3 in stdio.
 * The handle is made NON-INHERITABLE immediately after it is obtained, before CreateProcessW
 * (FRI-FINDING-003), so the foreign process never receives a copy of it.
 * Two-line protocol (FRI-FINDING-001 + FRI-FINDING-002 Option A):
 *   Line 1, before ResumeThread:
 *     "OK"                = helper completed containment enrollment and transferred execution to the
 *                           foreign command path (NOT a claim that the foreign code succeeded).
 *     "F:<step>:<winerr>" = failure before foreign code started (helper exits 125).
 *   Line 2, after the foreign root exits (only after "OK"):
 *     "R:ok"              = the helper's cleanup step succeeded
 *                           (success: KILL_ON_JOB_CLOSE cleared; failure/backstop: TerminateJobObject).
 *     "R:fail:<winerr>"   = the cleanup step failed.
 *   The helper then closes the handle. After "OK" the helper's exit code is the foreign root's exit code
 *   (backstop: 124); cleanup outcome is carried ONLY by line 2, never by an exit code.
 */
static HANDLE g_statusHandle = INVALID_HANDLE_VALUE;

static void status_write(const char *msg) {
    if (g_statusHandle == INVALID_HANDLE_VALUE) return;
    DWORD written;
    WriteFile(g_statusHandle, msg, (DWORD)strlen(msg), &written, NULL);
}

static void status_seal(void) {
    if (g_statusHandle == INVALID_HANDLE_VALUE) return;
    /* inheritance already removed at acquisition (FRI-FINDING-003) */
    CloseHandle(g_statusHandle);
    g_statusHandle = INVALID_HANDLE_VALUE;
}

/* Line 2 (FRI-FINDING-002, Option A), then close. */
static void status_result(BOOL ok, DWORD err) {
    char msg[64];
    if (ok) snprintf(msg, sizeof msg, "R:ok\r\n");
    else    snprintf(msg, sizeof msg, "R:fail:%lu\r\n", (unsigned long)err);
    status_write(msg);
    status_seal();
}

static int fail(const char *step, HANDLE suspendedProcess) {
    DWORD err = GetLastError();
    if (suspendedProcess) TerminateProcess(suspendedProcess, EXIT_CONTAINMENT_FAILED);
    char msg[128]; snprintf(msg, sizeof msg, "F:%s:%lu\r\n", step, (unsigned long)err);
    status_write(msg); status_seal();
    /* stderr kept for debugging (no longer used by the supervisor for classification) */
    fprintf(stderr, "UR_FRI_CONTAINMENT_FAILED_DEBUG:%s:%lu\n", step, (unsigned long)err);
    fflush(stderr);
    return EXIT_CONTAINMENT_FAILED;
}

/* Append one argument quoted per the CommandLineToArgvW / MSVCRT rules. */
static void append_arg(wchar_t **buf, size_t *len, size_t *cap, const wchar_t *arg) {
    size_t need = *len + wcslen(arg) * 2 + 4;
    if (need > *cap) {
        while (need > *cap) *cap *= 2;
        *buf = (wchar_t *)realloc(*buf, *cap * sizeof(wchar_t));
        if (!*buf) { fprintf(stderr, "UR_FRI_CONTAINMENT_FAILED:oom:0\n"); exit(EXIT_CONTAINMENT_FAILED); }
    }
    wchar_t *b = *buf;
    if (*len) b[(*len)++] = L' ';
    if (*arg && !wcspbrk(arg, L" \t\n\v\"")) { wcscpy(b + *len, arg); *len += wcslen(arg); return; }
    b[(*len)++] = L'"';
    for (const wchar_t *p = arg;; p++) {
        size_t bs = 0;
        while (*p == L'\\') { p++; bs++; }
        if (*p == L'\0') { for (size_t i = 0; i < bs * 2; i++) b[(*len)++] = L'\\'; break; }
        if (*p == L'"') { for (size_t i = 0; i < bs * 2 + 1; i++) b[(*len)++] = L'\\'; b[(*len)++] = L'"'; }
        else { for (size_t i = 0; i < bs; i++) b[(*len)++] = L'\\'; b[(*len)++] = *p; }
    }
    b[(*len)++] = L'"';
    b[*len] = L'\0';
}

int wmain(int argc, wchar_t **argv) {
    /* Parse --status-fd <n> first; it occupies argv[1] and argv[2]. */
    int argoff = 0;
    if (argc >= 3 && wcscmp(argv[1], L"--status-fd") == 0) {
        int crtfd = (int)wcstol(argv[2], NULL, 10);
        HANDLE h = (HANDLE)_get_osfhandle(crtfd);
        if (h == INVALID_HANDLE_VALUE) {
            fprintf(stderr, "UR_FRI_CONTAINMENT_FAILED_DEBUG:status-fd:invalid:%d\n", crtfd);
        } else {
            g_statusHandle = h;
            /* FRI-FINDING-003: make the status handle NON-INHERITABLE before CreateProcessW
             * (bInheritHandles=TRUE copies every handle that is inheritable at creation time).
             * Failure is fail-closed: no CreateProcess, containment failure reported. */
            if (!SetHandleInformation(g_statusHandle, HANDLE_FLAG_INHERIT, 0)) {
                return fail("status_noinherit", NULL);
            }
        }
        argoff = 2;
    }
    if (argc - argoff < 4 || wcscmp(argv[argoff + 2], L"--") != 0) {
        status_write("F:usage:0\r\n"); status_seal();
        fprintf(stderr, "UR_FRI_CONTAINMENT_FAILED_DEBUG:usage:0\n");
        return EXIT_CONTAINMENT_FAILED;
    }
    DWORD backstopMs = (DWORD)wcstoul(argv[argoff + 1], NULL, 10);

    size_t cap = 1024, len = 0;
    wchar_t *cmdline = (wchar_t *)calloc(cap, sizeof(wchar_t));
    if (!cmdline) return fail("oom", NULL);
    for (int i = argoff + 3; i < argc; i++) append_arg(&cmdline, &len, &cap, argv[i]);

    HANDLE job = CreateJobObjectW(NULL, NULL);                    /* non-inheritable handle */
    if (!job) return fail("create_job", NULL);

    JOBOBJECT_EXTENDED_LIMIT_INFORMATION lim;
    ZeroMemory(&lim, sizeof lim);
    lim.BasicLimitInformation.LimitFlags = ALLOWED_FLAGS;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &lim, sizeof lim)) return fail("set_limits", NULL);

    JOBOBJECT_EXTENDED_LIMIT_INFORMATION check;
    ZeroMemory(&check, sizeof check);
    if (!QueryInformationJobObject(job, JobObjectExtendedLimitInformation, &check, sizeof check, NULL)) return fail("query_limits", NULL);
    if ((check.BasicLimitInformation.LimitFlags & (JOB_OBJECT_LIMIT_BREAKAWAY_OK | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK)) != 0 ||
        (check.BasicLimitInformation.LimitFlags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) == 0) {
        SetLastError(ERROR_INVALID_PARAMETER);
        return fail("verify_limits", NULL);
    }

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof si);
    ZeroMemory(&pi, sizeof pi);
    si.cb = sizeof si;
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    if (!CreateProcessW(NULL, cmdline, NULL, NULL, TRUE, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, NULL, NULL, &si, &pi))
        return fail("create_process", NULL);

    if (!AssignProcessToJobObject(job, pi.hProcess)) return fail("assign", pi.hProcess);   /* W8: clean rejection */

    BOOL inJob = FALSE;
    if (!IsProcessInJob(pi.hProcess, job, &inJob) || !inJob) {
        if (inJob == FALSE) SetLastError(ERROR_ACCESS_DENIED);
        return fail("verify_membership", pi.hProcess);
    }

    /* Line 1: "OK". The handle stays open (non-inheritable since acquisition) for line 2. */
    status_write("OK\r\n");
    if (ResumeThread(pi.hThread) == (DWORD)-1) {
        DWORD rerr = GetLastError();
        BOOL t = TerminateJobObject(job, EXIT_CONTAINMENT_FAILED);
        status_result(t, t ? 0 : GetLastError());
        fprintf(stderr, "UR_FRI_RESUME_FAILED_DEBUG:%lu\n", (unsigned long)rerr); fflush(stderr);
        return EXIT_CONTAINMENT_FAILED;
    }
    CloseHandle(pi.hThread);

    DWORD w = WaitForSingleObject(pi.hProcess, backstopMs ? backstopMs : INFINITE);
    if (w == WAIT_TIMEOUT) {
        BOOL t = TerminateJobObject(job, 124);
        status_result(t, t ? 0 : GetLastError());
        fprintf(stderr, "UR_FRI_HELPER_BACKSTOP_TIMEOUT\n");
        return 124;
    }
    DWORD code = 1;
    if (!GetExitCodeProcess(pi.hProcess, &code)) code = 1;
    CloseHandle(pi.hProcess);

    if (code == 0) {
        /* OPEN-3: success kills nothing. Clear KILL_ON_JOB_CLOSE so closing the job leaves descendants alive. */
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION keep;
        ZeroMemory(&keep, sizeof keep);
        keep.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &keep, sizeof keep)) {
            DWORD clerr = GetLastError();
            status_result(FALSE, clerr);   /* line 2: R:fail:<err> -> supervisor: FRI_CLEANUP_FAILED */
            fprintf(stderr, "UR_FRI_RELEASE_FAILED_DEBUG:%lu\n", (unsigned long)clerr); fflush(stderr);
            CloseHandle(job);              /* KILL_ON_JOB_CLOSE still set: descendants die (reported via line 2) */
            return 0;                      /* root's exit code; cleanup outcome travels only on the status channel */
        }
        status_result(TRUE, 0);           /* line 2: R:ok */
        CloseHandle(job);
        return 0;
    }
    {
        BOOL t = TerminateJobObject(job, code);     /* failure: the whole tree dies */
        status_result(t, t ? 0 : GetLastError());
    }
    CloseHandle(job);
    return (int)code;
}
