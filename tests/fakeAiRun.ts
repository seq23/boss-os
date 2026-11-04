/**
 * A fake `~/bin/ai-run` for the shell runners' tests (the real one lives in seq-bin). It keeps the
 * interface — `ai-run --role worker|brain [--cwd D] [--network] [--out F] -- "<prompt>"` — and hands
 * the prompt to the fake `codex` (worker) or `claude` (brain) on PATH, so each test's own fakes still
 * decide what happens. A worker whose codex prints a usage limit exits 75 with
 * `NAMED STOP [CODEX_LIMIT] resets <time>`, as the real ai-run does.
 */
export const FAKE_AI_RUN = `#!/bin/bash
role=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --role) role="$2"; shift 2;;
    --cwd) shift 2;;
    --out) out="$2"; shift 2;;
    --network) shift;;
    --) shift; break;;
    *) shift;;
  esac
done
prompt="$1"
if [ "$role" = worker ]; then
  command -v codex >/dev/null || { echo "NAMED STOP [CODEX_UNAVAILABLE]"; exit 69; }
  res="$(codex exec "$prompt" < /dev/null 2>&1)"; rc=$?
  printf '%s\\n' "$res"
  if printf '%s' "$res" | grep -qiE "usage limit"; then
    at="$(printf '%s' "$res" | grep -oE 'try again at [0-9:]+ *[AaPp][Mm]' | tail -1 | sed 's/try again at //')"
    echo "NAMED STOP [CODEX_LIMIT] resets \${at:-unknown (Codex gave no reset time: usage limit)} — the work waits for the reset; it is never handed to Claude."; exit 75
  fi
  exit $rc
fi
res="$(claude -p "$prompt" 2>&1)"; rc=$?
printf '%s\\n' "$res"
[ -n "$out" ] && printf '%s\\n' "$res" > "$out"
exit $rc
`;
