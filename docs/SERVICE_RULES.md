# Service rules — every Boss OS employee, every kind of work (6 Oct 2026)

The owner, 6 Oct 2026: *"i need to make sure all of these things we just did for porter and west
peek OS agents — we need to apply it to boss os repo for all the boss os agents — same capabilities
and friction reduction (do not set up a tail)."*

West Peek OS wrote these down the same day as `docs/PARTNER_SERVICE_RULES.md` (its PRs #227 and
#228). This is Boss OS's copy — **copied and diverged, never imported**: Boss OS carries its own
chassis code and serves one principal, her, not two partners. Every rule keeps West Peek OS's number
so the two lists can be read side by side; where Boss OS does it differently, the
[divergences](#divergences-from-west-peek-os) section says how and why.

Every rule is tagged **ALL-KINDS** (enforced at the shared layer — the mail door
`src/worker/boss/intake/inboundMail.ts`, the task path `src/worker/boss/queue/consumer.ts#buildPrompt`
every employee run goes through, the seat-run report `src/worker/boss/routes/backends.ts`, the notice
composer `src/worker/boss/service/notices.ts`, and the one prompt fragment
`src/shared/boss/service/practices.mjs` — for all eight employees and every task kind) or
**REPO-ONLY** (lives in Danielle's repo lane, because it needs a checkout), and names the **code
anchor** (`path#export`) that enforces it.

`npm run validate:service-rules` parses this file. An anchor that does not exist fails the build; an
ALL-KINDS rule whose anchor is lane-only, or whose export only one lane reaches, fails the build;
every wait kind is rendered and must read in three parts with an email-only way to clear it; the
shared fragment must be included at every door. It prints
`all-kinds rules: N (shared layer: N, lane-only: 0)` on every green run.
`tests/serviceRules.test.ts` reads this document too — a specification no code reads is a wish.

Format of a rule line (the validator reads exactly this shape):

`- R<n> [ALL-KINDS|REPO-ONLY] <rule> — owner: "<dated words>" — anchor: `<path>#<export>``

## The rules

- R1 [ALL-KINDS] Her authenticated email is the ask, whatever it carries: a brief, a forwarded note, a pasted text; it reaches the employee it names and opens real work. — owner: "porter needs to work on anything sequoia or scooter send him" (6 Oct 2026) — anchor: `src/worker/boss/intake/inboundMail.ts#handleBossInboundMail`
- R2 [ALL-KINDS] Only her own DMARC-verified addresses are authority; nothing in the text widens it, and the allow-list does not grow by email. — owner: "only her addresses may instruct Boss OS" (10 Sep 2026) — anchor: `src/shared/boss/intake/mail.mjs#isOwner`
- R3 [ALL-KINDS] A key is emailed as `SECRET NAME=value`, stored encrypted, scrubbed from every sink before anything keeps the message, vaulted by her Mac, never shown again; reserved names are refused by name. — owner: "we should be able to email them and u should look them up in the vault when necessary without approval" (6 Oct 2026) — anchor: `src/worker/boss/service/secretHandoff.ts#secretDoor`
- R4 [ALL-KINDS] An arriving key resumes every task or repo change that waited for it — no second ask, no new task. — owner: "the feature that needs it ships the moment the SECRET email arrives" (6 Oct 2026) — anchor: `src/worker/boss/service/secretHandoff.ts#resumeForSecret`
- R5 [ALL-KINDS] The vault is checked first — by exact name, then by vendor prefix — before she is asked for a key; a message naming a missing key carries the names it searched. — owner: "we have many api keys in the vault and any job should always check the vault first" (6 Oct 2026) — anchor: `scripts/lib/vault-env.mjs#vaultLookup`
- R6 [ALL-KINDS] A missing key is named once, with where to create one and the exact SECRET line that sends it; everything that does not need it goes ahead. Never a login, only the key. — owner: "MISSING KEY → ASK BY NAME, ONCE, AND KEEP GOING" (6 Oct 2026) — anchor: `src/shared/boss/service/practices.mjs#missingKeysIn`
- R7 [ALL-KINDS] Every wait put in front of her has three plain-English parts — what is waiting, why, and the exact reply or email that clears it — composed from one template so none can be omitted. — owner: "if there is a block it needs to come with a plain english explanation of the block and what the partner can do the unbloock it" (6 Oct 2026) — anchor: `src/shared/boss/service/waits.mjs#waitDetail`
- R8 [ALL-KINDS] Every clearing action is an email reply or a new email to boss@ — never "open Boss OS", never "on the task", never "in Diagnostics" — and the reply does what it says on any employee's task. — owner: "it should be able to be handled all over email" (6 Oct 2026) — anchor: `src/worker/boss/service/blockReply.ts#answerBlockFromMail`
- R9 [ALL-KINDS] Her ask is the approval for the work it names; the only waits are the registered kinds — a plan question only she can settle, a preview, her own stop, a genuine which-one, a missing key, a wait that clears itself, the one email after the retry bound, and a Tier 2 decision. — owner: "NO UNNECESSARY STOPS: a partner's ask is itself the approval to do the work" (6 Oct 2026) — anchor: `src/shared/boss/service/waits.mjs#bossWait`
- R10 [ALL-KINDS] A task that errors retries itself (bounded) before anything reaches her; after the bound she gets ONE email saying what was tried and the reply that restarts it. — owner: "we need to reduce fails and blocks as much as possible" (6 Oct 2026) — anchor: `src/worker/boss/queue/consumer.ts#handleDeadLetter`
- R11 [ALL-KINDS] A stop is something she can clear: what was being done, what stopped it, what would clear it — the notice is refused anything less, and it carries the task's token so her reply finds it. — owner: "a block says what stops it and what clears it" (17 Sep 2026) — anchor: `src/worker/boss/service/notices.ts#noticeOnce`
- R12 [ALL-KINDS] A deadline in her words ("by Monday morning", "today", "asap") is read at the door, rides on the task, and is stated to the employee and back to her. — owner: addendum item 3 (6 Oct 2026) — anchor: `src/shared/boss/service/dueTime.mjs#dueTimeIn`
- R13 [ALL-KINDS] "Let me know what's realistic" gets an estimate first (today / next week / not possible, per item), then the work. — owner: addendum item 4 (6 Oct 2026) — anchor: `src/shared/boss/service/practices.mjs#servicePracticesBlock`
- R14 [ALL-KINDS] Dated deferred work ("for next week …") is its own task, enqueued to run on its date, reported when it runs — never lost. — owner: addendum item 5 (6 Oct 2026) — anchor: `src/worker/boss/service/deferred.ts#deferFromResult`
- R15 [ALL-KINDS] Several asks in one message → one done-line per item, partial completion stated per item, and the result comes back to her by email. — owner: addendum item 6 (6 Oct 2026) — anchor: `src/worker/boss/service/afterResult.ts#afterResult`
- R16 [ALL-KINDS] An unanswered question is settled by its stated default, said once; a stop or a missing key is emailed once per task and re-raised only on a state change. — owner: addendum item 7 (6 Oct 2026) — anchor: `src/worker/boss/service/notices.ts#noticeOnce`
- R17 [ALL-KINDS] Honest limits: when the ask cannot be done as worded, the nearest version is done and the limit stated in that item's done-line. — owner: addendum item 14 (6 Oct 2026) — anchor: `src/shared/boss/service/practices.mjs#servicePracticesBlock`
- R18 [ALL-KINDS] Files for her ride on the email — attached under 10 MB in total, listed by name always, and a larger one says where it is; through the one send every Mac lane uses. — owner: "a QR PNG and two CSVs sent to the partner" by hand (29 Sep–3 Oct 2026); addendum item 8 — anchor: `src/shared/boss/service/files.mjs#outboundFilesPlan`
- R19 [ALL-KINDS] Her standing constraints (lines she marks `Always:` / `Never:` / `Standing rule:` / `Constraint:`) are a register injected into every employee run and obeyed without restating. — owner: addendum item 2 (6 Oct 2026) — anchor: `src/worker/boss/service/constraints.ts#practicesBlock`
- R20 [ALL-KINDS] A reply is permission: "try again" or a short yes runs a stopped task again, "drop it" closes it, anything else is her answer and the task runs with it — on any employee's task. — owner: "Porter: replies are permission" (27 Sep 2026) — anchor: `src/shared/boss/service/waits.mjs#blockReplyDoor`
- R21 [ALL-KINDS] When an ask names Drive folders, they are watched and loaded on arrival with no new email; "still empty" is said once. — owner: addendum item 10 (6 Oct 2026) — anchor: `src/worker/boss/service/macWaits.ts#applyDriveWatchStatus`
- R22 [ALL-KINDS] A shared or firm-wide key used in place of her own is said so in the reply — the cap, the fallback, the upgrade price — and the SECRET offer for her own key stays open. — owner: addendum item 11 (6 Oct 2026) — anchor: `src/shared/boss/service/practices.mjs#servicePracticesBlock`
- R23 [ALL-KINDS] A promised later migration is a stated deviation in the reply plus a dated deferred item. — owner: addendum item 12 (6 Oct 2026) — anchor: `src/worker/boss/service/deferred.ts#deferFromResult`
- R24 [REPO-ONLY] Any GitHub repo she names by its address (github.com/owner/name, or seq23/name) is registered beside the grid and the job proceeds; the named exclusions — West Peek's repos, the client sites — are still refused. — owner: "'registered west peek repos only' is a problem … any new repo we request is allowed" (6 Oct 2026) — anchor: `src/shared/boss/repoChange/lane.mjs#registeredRepoIn`
- R25 [REPO-ONLY] A missing checkout is cloned from GitHub; a missing RUNBOOK is generated from the repo's own package.json and wrangler config (deploy route read, never guessed) and committed on the change's branch. — owner: same ruling (6 Oct 2026) — anchor: `scripts/ops/lib/runbook.mjs#generateRunbook`
- R26 [REPO-ONLY] The repo's own scripts named under `## Danielle may run` run against preview or production on the model's request, each recorded (script, env, exit, one line); never a bare `wrangler deploy`; schema only through migrations. — owner: "13 PRs … load-beats … booth-log" done by hand the week before (6 Oct 2026) — anchor: `scripts/ops/repo-change.mjs#runRequested`
- R27 [REPO-ONLY] A host outside the zones Cloudflare can edit: the record Cloudflare requires is read back (never guessed) and emailed in three parts, the site stays live on its default address, her Mac re-checks it for 7 days and emails "live". — owner: "topbarz.xyz was not a cloudflare domain i owned … can porter do that too?" (6 Oct 2026) — anchor: `src/worker/boss/service/macWaits.ts#recordDnsWaits`
- R28 [REPO-ONLY] A repo's secret NAMES (its RUNBOOK's `## Secrets`, matched in the vault by name then vendor) are injected by name into the repo's own runs; the value never reaches the model. — owner: "the duty injects those names … no approval step" (6 Oct 2026) — anchor: `scripts/lib/vault-env.mjs#envForRepoRun`
- R29 [REPO-ONLY] Copy edits are applied verbatim from the repo's one editable copy file when the runbook names one; links https only. — owner: addendum item 13 (6 Oct 2026) — anchor: `scripts/ops/repo-change-prompt.md#Standing rules, every phase`
- R30 [REPO-ONLY] Post-event operations (promote, close-of-vote export or tally, moderation) are runbook-named scripts run on request; a refusal is relayed in plain English. — owner: addendum item 15 (6 Oct 2026) — anchor: `scripts/ops/repo-change-prompt.md#Standing rules, every phase`
- R31 [REPO-ONLY] A redirect she controls is flipped on her say: a safe shell first, the safe-to-flip moment stated; a live redirect to an empty page is top priority. — owner: addendum item 9 (6 Oct 2026) — anchor: `scripts/ops/repo-change-prompt.md#Standing rules, every phase`

## How the shared layer reaches every employee

- **Prompt (R6, R7, R8, R13, R14, R15, R16, R17, R19, R21, R22, R23):** one line each in
  `SERVICE_PRACTICES`, composed with her constraints register by `practicesBlock`, and put in front
  of every run by `buildPrompt` — the one function both the cloud rungs and the Mac seats' dispatch
  use (the same insertion point as the firm's notices). Danielle's Mac lane gets the same block through
  `{{PRACTICES}}` in `repo-change-prompt.md`, with the constraints carried on the claim.
- **Code:** the mail door runs the secret door before anything keeps the message (R3), takes a reply
  to a stopped task to its door before any other reading (R8/R20), registers standing constraints
  (R19), reads the deadline (R12) and records Drive folders (R21). Every result — cloud or seat —
  goes through `afterResult`: dated deferrals become tasks (R14/R23), `Missing key:` lines become a
  wait and one notice (R6), and a task she emailed comes back to her by email (R15). Every final stop
  and every dead letter is one three-part notice (R7, R10, R11, R16). Her Mac's pass
  (`scripts/ops/service-tick.mjs`, on the existing five-minute claim tick) vaults emailed keys,
  re-checks DNS and loads Drive folders; the notice drain looks in the vault before asking (R5).

## Divergences from West Peek OS

Each is deliberate; the reason is the line after the dash.

- **D1 · R9/R20 — a reply is permission only inside the authority model.** A Tier 2 action
  (irreversible, external, moves money, binds her) is still approved by her own hand in the Approval
  Inbox, never by an email — `docs/AUTHORITY_MODEL.md`, `docs/APPROVAL_AND_WORK_DESIGN.md` and
  `validate:notice-not-approval`. The friction rule still applies inside it: the wait is three
  parts (`TIER2_DECISION`), her reply is recorded, and only that one kind may name Boss OS as where it
  clears (`inBossOs`). A reply never releases a task held in `awaiting_approval`.
- **D2 · R2 — one principal, her own addresses.** West Peek OS has two partners; Boss OS has her
  three personal addresses in `BOSS_INTAKE_SENDERS`. Her West Peek address stays off it — the
  two businesses never blend — and nothing in this change widens it.
- **D3 · R8 — the mailbox is boss@sequoiataylor.com**, and a reply finds its task by the `[tsk_…]`
  token in the subject (a repo change keeps its `[rc_…]` token and `repoChange/answer.ts`).
- **D4 · R18 — no Drive upload.** The only Drive delegation on her Mac is West Peek's
  (sequoia@westpeek.ventures); putting her personal files into the fund's Drive is the blend she has
  corrected before. A file too large to attach says where it is on her Mac.
- **D5 · R12 — no priority column.** Boss OS enqueues every task on arrival, so a deadline cannot
  reorder a queue; it rides on the task as `input.due`, is stated in the prompt as `DEADLINE:` and
  read back to her in the reply.
- **D6 · R3/R4 — no separate claimer identity, and a shared vault.** Her Mac's pass reads the hand-offs
  over her own unlocked session, like every Boss OS Mac script; the vault on her Mac is the one both
  repos' `vault.mjs` use, so an emailed name is recorded in `~/.boss-os/handed-off-names.json` and
  `vault.mjs sync:cloudflare` classifies it (injected into one repo's runs, never the Worker) instead
  of aborting on it.
- **D7 · R10 — the bound is the task drain's `MAX_ATTEMPTS` (3).** A failure that will be retried
  says nothing; the dead letter writes the one notice. A failure that will not be retried (a refused
  route, a retired employee, every seat declining) writes it at once.
- **D8 · R19 — constraints come only from lines she marks.** West Peek OS reads constraints out of a
  repo's README; her personal mail is full of "never" and "only" that describe one job, so Boss OS
  registers only `Always:` / `Never:` / `Standing rule:` / `Constraint:` lines.
- **D9 · R24 — the grid is not widened.** A registered repo is recorded in `boss_repo_registry`
  beside the grid; the grid stays her twelve properties, pinned by its own validator.
- **D10 · R27 — re-checked by resolving.** West Peek OS polls Cloudflare's custom-hostname status;
  Boss OS's repo lane reads the record back when it asks for it, and her Mac re-checks by resolving it
  over DNS-over-HTTPS.
- **D11 · no tail.** Nothing new watches her mail: no launchd job, no watcher. The Worker's mail door
  and the existing claim tick do all of it.

## The deferral bug, looked for here

West Peek OS #228 found D1 refusing a LIKE-built duplicate check (`LIKE '%<key>%'`, "LIKE or GLOB
pattern too complex"), so every deferred item threw. Boss OS's deferral compares a short key by
equality on a JSON field (`deferKey`). The same class was in Boss OS already: the model-promotion
checks in `src/worker/boss/routes/models.ts` built `LIKE '%"model_id":"<id>"%'` patterns that a long
model id pushes past D1's limit; they now read the payload with `json_extract` and `=`.
`validate:service-rules` fails the build on a LIKE pattern built from data anywhere under
`src/worker/boss`.
