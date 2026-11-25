# shellcheck shell=bash
# NOELLE'S SANDBOXED RUN, WRITTEN FRESH EVERY RUN (redesign 24 Nov 2026: safety by taking access away). Sourced by
# scripts/ops/noelle.sh (and by the TEST run that proves it). Everything here lives in ~/.boss-os/noelle, which her
# sandbox neither writes nor (except the gitconfig) reads:
#   settings.json   scripts/ops/noelle-permissions.json with __HOME__, __REPO__ and __RUN__ filled in
#   gitconfig       her git's only config (GIT_CONFIG_GLOBAL; GIT_CONFIG_NOSYSTEM drops the system osxkeychain
#                   helper): no credential helper at all, so her git inside the sandbox is logged out
#   bin/noelle-tool her four vault tools and her two GitHub verbs (push-branch, open-pr: scripts/ops/noelle-github.mjs,
#                   on the Mac's gh login, never the vault); bin/land-after her one way to merge. Both run OUTSIDE the sandbox
#                   (excludedCommands), so each checks its arguments' shape and starts from an empty environment
#                   (env -i): nothing she sets, no PATH, NODE_OPTIONS or token of hers, reaches them.
#   guard/          her guard's state (PR count, reviewers, the compaction mark), out of her reach
#
#   noelle_prepare <repo> <noelle-home> <run-folder> <run-id>   prints the settings path; non-zero on any failure
#   noelle_her_repos <repo> [sep]   her business repos (the guard's HER_REPOS), joined by sep (default a space)

# The path goes in through the environment, never argv: `node -e 'import(argv[1])' <guard>` makes the guard its own main
# script, so it runs as a hook and prints GUARD_UNREAD instead of the list.
noelle_her_repos() {
  NOELLE_GUARD_FILE="$1/scripts/ops/noelle-guard.mjs" NOELLE_SEP="${2:- }" node -e 'import(process.env.NOELLE_GUARD_FILE).then((m) => console.log(m.HER_REPOS.join(process.env.NOELLE_SEP)))' </dev/null
}

noelle_prepare() {
  local repo="$1" nhome="$2" work="$3" run_id="$4"
  local lock="$HOME/.boss-os/noelle" runs="$HOME/.boss-os/noelle/runs" run
  [ "$nhome" = "$HOME/Work/noelle" ] || { echo "NAMED STOP [NOELLE_HOME_MOVED] her sandbox is written for ~/Work/noelle, not $nhome" >&2; return 6; }
  case "$work" in "$runs"/*) run="${work#"$runs"/}" ;; *) echo "NAMED STOP [RUN_FOLDER] $work is not under $runs" >&2; return 6 ;; esac
  [[ "$run" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "NAMED STOP [RUN_FOLDER] run folder name '$run'" >&2; return 6; }
  mkdir -p "$nhome/notes" "$nhome/tasks" "$nhome/plays" "$nhome/repos" "$nhome/wt" "$nhome/.config/gh" "$lock/bin" "$lock/guard" "$work" || return 6

  sed -e "s#__HOME__#$HOME#g" -e "s#__REPO__#$repo#g" -e "s#__RUN__#$run#g" "$repo/scripts/ops/noelle-permissions.json" > "$lock/settings.json.tmp" || return 6
  node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!s.sandbox||s.sandbox.enabled!==true) process.exit(1)' "$lock/settings.json.tmp" \
    || { echo "NAMED STOP [NO_SANDBOX] her settings carry no sandbox; she never runs without it" >&2; return 6; }
  mv "$lock/settings.json.tmp" "$lock/settings.json" && chmod 644 "$lock/settings.json" || return 6

  cat > "$lock/gitconfig" <<EOF || return 6
# Noelle's git config, written by scripts/ops/lib/noelle-sandbox.sh every run. No other config loads in her run.
[user]
	name = Noelle (growth)
	email = noelle@users.noreply.github.com
[credential]
	helper =
[init]
	defaultBranch = main
EOF

  cat > "$lock/bin/noelle-tool" <<EOF || return 6
#!/bin/bash -p
# Noelle's broker; written by scripts/ops/lib/noelle-sandbox.sh. Runs outside her sandbox, from an empty environment.
# bash -p: no BASH_ENV, no ENV and no exported function of hers is read before this line runs.
# brain|notice|ledger|backlinks go through the vault; push-branch|open-pr go to GitHub on the Mac's gh login and
# never see the vault. Nothing else: no merge, approve, api, secret, settings or delete verb.
case "\${1:-}" in
  brain|notice|ledger|backlinks) TOOL=(npm run --silent vault:run -- node scripts/ops/noelle.mjs) ;;
  push-branch|open-pr) TOOL=(node scripts/ops/noelle-github.mjs) ;;
  *) echo "usage: noelle-tool brain|notice|ledger|backlinks|push-branch|open-pr ..." >&2; exit 2 ;;
esac
CALLER_CWD="\$PWD"
cd $(printf %q "$repo") || exit 6
exec /usr/bin/env -i HOME=$(printf %q "$HOME") USER=$(printf %q "$USER") PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin TMPDIR=$(printf %q "${TMPDIR:-/tmp}") \\
  NOELLE_HOME=$(printf %q "$nhome") NOELLE_RUNS=$(printf %q "$runs") NOELLE_RUN_ID=$(printf %q "$run_id") NOELLE_GUARD_DIR=$(printf %q "$lock/guard") NOELLE_CALLER_CWD="\$CALLER_CWD" \\
  "\${TOOL[@]}" "\$@"
EOF

  cat > "$lock/bin/land-after" <<EOF || return 6
#!/bin/bash -p
# Noelle's one way to merge and deploy; written by scripts/ops/lib/noelle-sandbox.sh. Runs outside her sandbox.
# Only: land-after <pr> --task noelle-<job> --repo seq23/<one of her repos>  (no --then, no --owner).
usage() { echo "NAMED STOP [LAND_SHAPE] land-after <pr> --task noelle-<job> --repo seq23/<your repo>" >&2; exit 2; }
[ "\$#" -eq 5 ] && [[ "\$1" =~ ^[0-9]{1,6}\$ ]] && [ "\$2" = --task ] && [[ "\$3" =~ ^noelle-[a-z0-9-]{1,60}\$ ]] && [ "\$4" = --repo ] && [[ "\$5" =~ ^seq23/[A-Za-z0-9_.-]+\$ ]] || usage
/usr/bin/env -i HOME=$(printf %q "$HOME") USER=$(printf %q "$USER") PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin TMPDIR=$(printf %q "${TMPDIR:-/tmp}") \\
  NOELLE_GUARD_DIR=$(printf %q "$lock/guard") node $(printf %q "$repo/scripts/ops/noelle-github.mjs") check-land "\${5#seq23/}" "\$1" || exit \$?
cd $(printf %q "$HOME") || exit 6
exec /usr/bin/env -i HOME=$(printf %q "$HOME") USER=$(printf %q "$USER") PATH=$(printf %q "$HOME/bin"):/opt/homebrew/bin:/usr/bin:/bin TMPDIR=$(printf %q "${TMPDIR:-/tmp}") \\
  $(printf %q "$HOME/bin/land-after") "\$1" --task "\$3" --repo "\$5"
EOF
  chmod 755 "$lock/bin/noelle-tool" "$lock/bin/land-after" || return 6
  printf '{"prs":0,"reviewers":0,"run":"%s"}' "$run_id" > "$lock/guard/run.json" || return 6
  rm -f "$lock/guard/compacted" "$lock/guard/open-pr.lock"
  printf '%s' "$lock/settings.json"
}
