# Boss OS AI Quant Fund Master Plan v5
Canonical Operating Manual + Day-by-Day 90-Day Implementation Plan
Owner: Sequoia Taylor
Status: Operational Draft v5
Scope: Personal Boss OS capital division only; completely separate from West Peek.
Capital Frame: $50,000 trading capital + up to $10,000 Year 1 operating budget.

> **Reality Notice:** This document is educational and organizational. It is not legal, tax, investment, or financial advice. AI can accelerate research, coding, testing, monitoring, and iteration. AI does not guarantee market edge. Live capital deployment requires explicit human approval and current review of exchange, tax, and security conditions.

---

# Document Compiler Record

## Phase 1 - Requirement Parse

| Requirement | Locked Interpretation |
| --- | --- |
| Target audience | Sequoia as owner/operator; future Boss OS agents; technical helpers who may execute setup under explicit approval. |
| Purpose | Create a full master plan with implementation embedded, replacing the prior strategic skeleton with hardware, accounts, cloud setup, trading engine setup, strategy desks, paper/live gates, and a day-by-day 90-day plan. |
| Deliverable format | DOCX and Markdown, suitable for Boss OS knowledge installation and future repo/build translation. |
| Operational scope | Personal AI-native quant fund only; no West Peek capital, investors, brand, LPs, or firm operations. |
| Constraints | $50K trading capital; up to $10K Year 1 ops; no assumption that $5K/month is guaranteed; no live capital before gates; no reckless leverage in Phase 1. |
| Source alignment | Use the original uploaded trading plan for operational setup DNA: MacBook, Termius, VS Code Remote SSH, AWS/DO server, Hummingbot, API key safety, testnet/paper/live staging. Replace the simplistic two-bot strategy with the v4 AI Quant Fund structure. |

## Phase 2 - Document Architecture

1. Part A - Institutional Master Plan
2. Part B - Beginner Implementation Manual
3. Part C - 90-Day Execution Roadmap
4. Part D - Hardware + Software Setup List
5. Part E - Cloud / Server Setup
6. Part F - Strategy Desk Setup
7. Part G - Paper -> Micro-Live -> Target Deployment Gates
8. Part H - Boss OS Integration Layer
9. Appendices - Prompts, SOPs, Checklists, References, Completeness Ledger

## Phase 3 - Outline Expansion

Every part contains purpose, operating rules, concrete setup actions, acceptance gates, and failure rules. The implementation plan is embedded inside the master plan, not separated into a vague companion memo.

## Phase 4 - Artifact Tracker

| Artifact | Status | Location |
| --- | --- | --- |
| Capital allocation model | Included | Part A |
| West Peek separation law | Included | Part A + Part H |
| Hardware shopping/setup list | Included | Part D |
| Account and security setup | Included | Part B + Part D |
| Local folder structure | Included | Part B |
| AWS Tokyo / server setup | Included | Part E |
| Termius setup | Included | Part B + Part E |
| VS Code Remote SSH setup | Included | Part B + Part E |
| Hummingbot engine setup | Included | Part B + Part G |
| Strategy desk design | Included | Part F |
| Paper trading protocol | Included | Part G |
| Micro-live protocol | Included | Part G |
| Target deployment gates | Included | Part G |
| Day-by-day 90-day operator plan | Included | Part C |
| Boss OS roadmap alignment | Included | Part H |
| Prompt library | Included | Appendix B |
| Checklists and SOPs | Included | Appendix C |
| Completeness ledger | Included | Appendix E |

# Part A - Institutional Master Plan

## A1. Executive Summary

The Boss OS AI Quant Fund is a personal AI-native trading organization designed to become an income-producing asset with a capped asymmetric upside sleeve. It is not a casual trading bot, not a public investment product, and not a West Peek initiative. It is a private Boss OS capital division governed by explicit approval gates, risk limits, strategy promotion rules, and no-guarantee reality laws.

The fund uses AI agents to research, copy candidate strategies, backtest, paper trade, code, monitor, evaluate, promote, demote, and retire strategies. The machine is the asset. Strategies are treated like portfolio companies: most will fail, some will survive, and a few may deserve real capital.

## A2. Non-Negotiable Separation from West Peek

- No West Peek capital funds this project.
- No West Peek brand or website is used.
- No LP, founder, portfolio company, or West Peek counterparty is involved.
- No West Peek data is used unless separately approved and legally appropriate.
- No investor-facing claims are made.
- No trading outcome is represented as a fund performance record for West Peek.
- This project is personal risk capital under Boss OS only.

## A3. Capital Commitment

| Bucket | Amount | Rule |
| --- | --- | --- |
| Trading capital | $50,000 | Deployed into strategy sleeves only. Not used for subscriptions or servers. |
| Year 1 operating budget | Up to $10,000 | AI tools, data, servers, monitoring, tax/accounting, security. Spent only when ROI is justified. |
| Total Phase 1 commitment | Up to $60,000 | Risk capital + operating budget; not a guaranteed income purchase. |

## A4. Return Reality Math

A $5,000 monthly income target from $50,000 requires approximately 10% monthly profit or 120% simple annual return before taxes and operational friction. That is possible but not a default expectation. The system therefore cannot be commanded to make $5,000 per month. It is commanded to discover and validate edge.

| Capital Base | $5K/month Requires | Interpretation |
| --- | --- | --- |
| $50,000 | 120% annual simple return | Aggressive / not reliable by assumption |
| $100,000 | 60% annual simple return | Strong but plausible if system proves edge |
| $150,000 | 40% annual simple return | More reasonable for a good operation |
| $250,000 | 24% annual simple return | Income objective becomes much more comfortable |

## A5. Portfolio Architecture

| Sleeve | Allocation | Mission |
| --- | --- | --- |
| Income-Producing Core | $25,000 | Build recurring return engine using the most durable available strategies. |
| Growth Alpha | $12,500 | Higher-return liquid strategies that can materially lift Year 1 outcomes. |
| Experimental Strategy Factory | $7,500 | Test many AI-generated or copied strategies in small controlled stages. |
| Moonshot / Convex Bets | $5,000 | Try for rare 10x-200x outcomes with capped downside. |

## A6. Success Tiers

| Year 1 Outcome | Interpretation |
| --- | --- |
| Preserve capital | Operational win; machine survived and foundation exists. |
| $10K-$20K profit | Good Year 1. |
| $20K-$40K profit | Strong Year 1. |
| $50K-$60K profit | Excellent; approximates original break-even-on-total-investment dream. |
| $100K+ profit | Exceptional. |
| $500K-$1M moonshot hit | Rare venture-style outcome; not the base case. |

## A7. Master Operating Principle

> **Master Principle:** Copy candidate strategies, test brutally, paper trade, live small, scale winners, kill losers fast. AI builds the machine. The market proves the edge.

---

# Part B - Beginner Implementation Manual

## B1. Beginner Rule: The Laptop Is the Remote Control

The laptop does not run production bots. The cloud server runs the bot. The laptop is the command center used for AI, code editing, SSH access, reports, and approvals. Closing the laptop must not stop trading systems.

## B2. Hardware Requirements

| Item | Minimum | Recommended | Why |
| --- | --- | --- | --- |
| Laptop | Apple MacBook with Apple Silicon if purchasing new | MacBook Pro or strong MacBook Air with M-series chip | UNIX-like local environment aligns well with Linux servers. |
| RAM | 16GB | 32GB | AI tools, browser tabs, VS Code, terminals, dashboards. |
| Storage | 512GB | 1TB | Logs, exports, data samples, documents, encrypted backups. |
| Monitor | One screen | Dual monitor setup | AI on one screen; terminal/VS Code/dashboard on the other. |
| External backup | Encrypted external SSD | Two encrypted SSDs plus cloud backup for documents only | Continuity and disaster recovery. |

## B3. Accounts to Create

| Account | Purpose | Rule |
| --- | --- | --- |
| Dedicated quant email | Separates trading operations from personal and West Peek | Use MFA; no shared inbox. |
| Password manager vault | Stores keys, recovery codes, account notes | Never store secrets in plain notes. |
| AWS account | Cloud server infrastructure | MFA and billing alerts required. |
| Exchange testnet/paper accounts | No-money testing | Create before any live exchange key. |
| Exchange live account | Micro-live and later deployment | Use only after gates. |
| AI tools | Research, coding, review, monitoring | Each tool must have a role. |
| Tax/accounting tool | Trade export and cost basis support | Required before meaningful live trading. |

## B4. Software to Install on the Laptop

| Software | Purpose | Install Rule |
| --- | --- | --- |
| Termius | Beginner-friendly SSH access to server | Use saved host profiles; protect private keys. |
| Visual Studio Code | Code editor and remote server editor | Install Remote - SSH extension. |
| Browser password manager extension | Credential retrieval | Only from official store. |
| Spreadsheet tool | Strategy registry and ledger review | Google Sheets, Excel, or local equivalent. |
| PDF/DOCX reader | Review reports and export packets | Keep master docs accessible offline. |

## B5. Local Folder Structure

Create this exact folder tree locally before downloading keys, logs, reports, or exports:

Boss_OS_AI_Quant_Fund/
  00_governance/
  01_accounts_security/
  02_cloud_servers/
  03_strategy_registry/
  04_backtests/
  05_paper_trading/
  06_micro_live/
  07_reports/
  08_tax_ledger/
  09_incidents/
  10_prompts/
  11_exports_backups/

## B6. Security Baseline

- Every critical account uses MFA.
- Exchange API keys never have withdrawal permission.
- Use IP restrictions where supported.
- Store API keys only in password manager or encrypted secrets manager.
- If a key is pasted into chat, delete/revoke it immediately.
- No live capital account exists before Boss OS approval gates.
- No one-click automation can transfer funds or withdraw assets.
- Every server login and key location is documented.

## B7. Exchange Permission Model

| Permission | Testnet/Paper | Micro-Live | Target Deployment |
| --- | --- | --- | --- |
| Read balance | Allowed | Allowed | Allowed |
| Read orders/trades | Allowed | Allowed | Allowed |
| Place/cancel orders | Allowed in testnet | Allowed only for approved strategy | Allowed only for approved strategies |
| Withdraw funds | Never | Never | Never |
| Margin/leverage | No | No in Phase 1 | Requires separate future approval |

---

# Part C - 90-Day Execution Roadmap

This is the operational replacement for the vague 30/60/90 roadmap. Every day has a purpose, actions, artifact, acceptance gate, and failure rule. If a day fails, do not skip forward. Repair the failed gate and continue.

## C1. Phase Map

| Days | Phase | Primary Outcome |
| --- | --- | --- |
| 1-7 | Command Center and Security | Governed, separated, secured operating base. |
| 8-14 | Cloud Server and Remote Workstation | Remote server accessible from Termius and VS Code. |
| 15-21 | Hummingbot + Testnet Execution Engine | Execution engine installed and running without live capital. |
| 22-30 | Strategy Factory + Research Registry | First 25 strategy hypotheses and evidence rules. |
| 31-38 | Backtesting Harness and Evidence Rules | Backtests and hostile reviews for first candidates. |
| 39-45 | Paper Trading Portfolio Alpha | Paper strategies configured and monitored. |
| 46-53 | Paper Trading Portfolio Beta | Experimental and moonshot candidates screened. |
| 54-60 | Monitoring, Ledger, and Incident Drills | No-live safety stack ready. |
| 61-67 | Micro-Live Readiness Gate | First strategy approved or rejected for $250-$300 live. |
| 68-82 | $250-$300 Forward Test | Fourteen-day micro-live proof. |
| 83-90 | $500-$1,000 Forward Test + CEO Decision | Scale, hold, retire, or continue paper. |

## C2. Day-by-Day 90-Day Plan

### Week 1 - Command Center and Security

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 1 | Confirm mandate and install Boss OS Quant Addendum | Create Quant Fund folder, write separation statement, paste Addendum into Boss OS Chat A. | Boss OS Quant Addendum installed | Chat A contains separation from West Peek and no-live-capital rule. | If governance is not installed, stop all trading setup. |
| 2 | Hardware decision and procurement | Confirm MacBook capability; if upgrading, select Apple M-series, 16GB minimum, 32GB recommended, dual monitor path. | Hardware decision log | You know whether current laptop is temporary or approved. | Do not start server/account work if command workstation is unstable. |
| 3 | Dedicated identity and privacy boundary | Create dedicated email alias/account for personal quant operations; add password manager vault category. | Dedicated quant identity record | Email exists; password manager entry created; no personal/West Peek commingling. | If email/security is messy, pause. |
| 4 | MFA and password manager hardening | Enable MFA for email, cloud, exchange candidates, AI tools, and password manager. | Security checklist v1 | Every critical account has MFA plan before exchange API work. | No API keys until MFA is active. |
| 5 | Local folder system | Create local folder tree and README files. | Folder structure created | All folders exist with naming rules. | If folders are not clean, do not download keys/files. |
| 6 | AI tool stack decision | Select ChatGPT, Claude, Gemini, coding agent, and cost ceiling for Month 1. | AI tool budget sheet | Month 1 spend capped; no subscription sprawl. | If a tool has no role, do not buy. |
| 7 | Week 1 review | Run security/governance review and confirm no live trading actions taken. | Week 1 readiness report | Governance, hardware, email, MFA, folders complete. | If any gate fails, repeat Week 1 items. |

---

### Week 2 - Cloud Server and Remote Workstation

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 8 | AWS account setup | Create or verify AWS account; set billing alerts; set IAM root security. | AWS account readiness card | Billing alert and MFA active. | No EC2 launch without billing/MFA. |
| 9 | AWS region choice | Select Tokyo ap-northeast-1 for Bot 1 paper/prod candidate; document why. | Cloud region decision | Region selected and recorded; no assumption of guaranteed latency edge. | If exchange/geography changes, revisit region. |
| 10 | Launch development EC2 | Launch Ubuntu t3.large or current equivalent; name Bot1-Tokyo-Dev; attach key pair; 30GB storage. | EC2 instance running | Instance reachable in AWS console. | If costs are uncomfortable, use smaller dev only; do not trade live. |
| 11 | Termius setup | Install Termius; add host with ubuntu username and .pem key. | Termius host profile | SSH connects successfully. | If SSH fails, fix before any trading setup. |
| 12 | VS Code Remote SSH setup | Install VS Code + Remote SSH; connect to server; create /quant directory. | VS Code remote workspace | Files can be edited on server from laptop. | If Remote SSH fails, use Termius only temporarily. |
| 13 | Base server hardening | Run OS updates, create working directories, install Docker prerequisites. | Server bootstrap log | Commands captured in logs; Docker can be installed. | If command errors occur, log them; do not improvise silently. |
| 14 | Week 2 review | Stop/start server; confirm costs, access, logs, and backups. | Week 2 infrastructure report | You can connect from Termius and VS Code. | If server access is flaky, do not install Hummingbot yet. |

---

### Week 3 - Hummingbot + Testnet Execution Engine

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 15 | Install Docker and Compose | Install Docker using official Ubuntu path; verify docker ps works. | Docker install log | Docker runs without sudo issues or documented workaround. | No Hummingbot until Docker works. |
| 16 | Install Hummingbot client | Install Hummingbot using current official Docker docs; save exact commands used. | Hummingbot install log | Hummingbot opens and exits cleanly. | If docs changed, follow current official docs, not stale commands. |
| 17 | Create Hummingbot config archive | Locate config/scripts/log folders; document paths. | Engine path map | You know where scripts, configs, logs live. | If paths are unknown, no strategy code. |
| 18 | Exchange testnet selection | Choose Binance/Kraken testnet/paper path based on availability; document account limits. | Testnet decision card | Paper environment selected; no live keys. | If testnet unavailable, use simulated paper mode. |
| 19 | Create testnet credentials | Create testnet API keys only; store in password manager; connect read/trade permissions for paper. | Testnet key record | Hummingbot can authenticate to test environment. | Delete leaked keys immediately. |
| 20 | First engine dry run | Start Hummingbot; connect; place no real orders; capture logs. | Dry run log | Engine runs, logs captured, no live capital. | If engine fails, fix before strategy work. |
| 21 | Week 3 review | Validate server + Hummingbot + testnet path. | Week 3 engine readiness report | Hummingbot can run on server and exit safely. | If not clean, do not start strategy code. |

---

### Week 4 - Strategy Factory + Research Registry

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 22 | Strategy registry build | Create strategy registry spreadsheet/database with required fields. | Strategy Registry v1 | Registry has fields for source, thesis, data, risks, stage, owner, status. | No strategy can exist outside registry. |
| 23 | Edge intelligence intake | Create source intake workflow for public strategies, papers, GitHub repos, forums, exchange docs. | Edge intake form | Every candidate strategy has source notes. | No black-box copying without source record. |
| 24 | Generate first 25 strategy hypotheses | AI generates hypotheses across core, growth, experimental, moonshot. | 25-strategy candidate list | Each candidate has why it may work and why it may fail. | No capital discussion yet. |
| 25 | Hostile screen of 25 strategies | CRO Agent rejects weak/illegal/overcomplex/unfit strategies. | Rejected/accepted strategy list | At least 50% rejected or parked. | If AI loves everything, CRO failed. |
| 26 | Select first 5 paper candidates | Pick candidate mix: core, trend, volatility, event, experimental. | First strategy slate | 5 candidates selected with paper rationale. | No live trading. |
| 27 | Define evidence standard | Set minimum data, fee, slippage, liquidity, drawdown, sample-size requirements. | Evidence Standard v1 | All strategies judged by same scorecard. | If evidence is missing, stage remains research. |
| 28 | Boss OS Investment Committee template | Create weekly IC packet template. | Weekly IC Template | Template includes P&L, evidence, risks, decisions, vetoes. | No weekly report, no live strategy. |
| 29 | Prompt pack installation | Install research, backtest review, risk review, promotion, retirement prompts. | Prompt Pack v1 | Prompts are saved in Boss OS Prompt Library. | Do not rely on memory. |
| 30 | Month 1 review | Compile complete Month 1 report. | Month 1 Foundation Report | Infra, registry, engine, paper plan ready. | If incomplete, extend foundation; no micro-live. |

---

### Week 5 - Backtesting Harness and Evidence Rules

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 31 | Backtest framework decision | Choose tooling: Hummingbot backtesting where applicable, vectorbt/backtrader/custom Python as needed. | Backtest tooling decision | Tool selected by strategy type. | Do not force every strategy through one tool. |
| 32 | Market data source selection | Choose free/paid data sources for candles, funding, order books, on-chain. | Data Source Matrix | Data cost and quality recorded. | No backtest without data provenance. |
| 33 | Fee/slippage model | Build fee/slippage assumptions per exchange and asset liquidity tier. | Fee/Slippage Model v1 | Every backtest deducts realistic costs. | Backtests without costs are invalid. |
| 34 | Core strategy backtest 1 | Backtest funding/basis/carry candidate or define why unavailable. | Backtest Report Core-1 | Report includes return, drawdown, trade count, fees, flaws. | If unavailable, keep paper-only. |
| 35 | Trend strategy backtest 1 | Backtest liquid trend/momentum candidate. | Backtest Report Trend-1 | Walk-forward split included. | No single-period curve-fitting. |
| 36 | Volatility/event backtest 1 | Backtest volatility breakout or event-driven candidate. | Backtest Report Vol/Event-1 | Regime weakness identified. | If data insufficient, stage remains research. |
| 37 | Mean reversion/stat arb screen | Test basket concept or reject if fees/liquidity fail. | Backtest Report MR-1 | Not one-coin RSI toy without basket logic. | If edge vanishes after fees, reject. |
| 38 | Backtest review board | Hostile review all reports; rank candidates. | Backtest Review Packet | Only strategies with adequate evidence advance. | If everything passes, review was too weak. |

---

### Week 6 - Paper Trading Portfolio Alpha

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 39 | Paper trading config for top strategy | Configure top strategy in paper/test mode only. | Paper Config Strategy A | Strategy A can run without real money. | No live keys. |
| 40 | Paper trading config for second strategy | Configure Strategy B in paper/test mode. | Paper Config Strategy B | Strategy B has independent thesis from A. | Avoid correlated clones. |
| 41 | Paper trading config for third strategy | Configure Strategy C in paper/test mode. | Paper Config Strategy C | At least one non-trend/non-core idea tested. | If too complex, demote. |
| 42 | Paper monitoring dashboard | Build or configure dashboard for balances, P&L, logs, errors, open orders. | Paper Dashboard v1 | Status visible without SSH digging. | If dashboard absent, paper run may continue but no live gate. |
| 43 | Simulated kill switch | Create simulated kill-switch logic and incident trigger. | Kill Switch Simulation | System can detect max-loss condition and halt paper strategy. | No live strategy without kill-switch behavior. |
| 44 | Paper run observation | Let paper strategies run; do not optimize mid-run. | Paper Observation Log | At least 24 hours uninterrupted paper activity. | If it fails, log root cause. |
| 45 | Week 6 review | Assess paper behavior and stability. | Week 6 Paper Alpha Report | 3 strategies running/rejected with evidence. | No live progression if logs incomplete. |

---

### Week 7 - Paper Trading Portfolio Beta

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 46 | Beta strategy batch generation | Generate another 25 experimental ideas. | Beta Candidate Batch 1 | Each idea assigned category and data requirement. | No funding yet. |
| 47 | Moonshot research screen | Identify 10 moonshot candidates with capped-loss structure. | Moonshot Research Memo | Each has max loss and upside thesis. | No leverage, no blind meme buys. |
| 48 | On-chain data feasibility | Assess wallet-following/on-chain event data tools and cost. | On-chain Feasibility Report | Decision: build now, defer, or avoid. | Do not buy data without use case. |
| 49 | Listing/event strategy feasibility | Map exchanges/listing calendars/unlock data sources. | Event Data Matrix | Sources and latency limitations known. | If source is unreliable, no live strategy. |
| 50 | Experimental paper queue | Select 5 Beta ideas for paper-only tracking. | Beta Paper Queue | Beta ideas assigned stage and owner agent. | No live Beta funds. |
| 51 | Strategy Cemetery setup | Create retired/rejected strategy archive with resurrection triggers. | Strategy Cemetery v1 | Rejected ideas preserved with reason. | No silent deletion of lessons. |
| 52 | Second paper run | Run Alpha and Beta paper strategies; log behavior. | Paper Run Log 2 | Logs captured, errors classified. | If agent changes parameters mid-run, invalidate run. |
| 53 | Week 7 review | Rank Alpha and Beta candidates. | Week 7 Strategy Factory Report | Promotion candidates identified or none. | No pressure to promote. |

---

### Week 8 - Monitoring, Ledger, and Incident Drills

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 54 | Monitoring stack selection | Choose monitoring tools: server uptime, logs, process health, exchange API ping, alerts. | Monitoring Stack Decision | Cost and role documented. | No live trading without alerts. |
| 55 | Alert channels | Set email/SMS/app notification path; no Telegram unless desired. | Alert Channel Test | Critical test alert received. | If alerts fail, live trading blocked. |
| 56 | Tax/ledger workflow design | Select export method/tool for trades, fills, fees, cost basis support. | Ledger Workflow v1 | Every live trade will be exportable. | No tax workflow, no live trading. |
| 57 | Security incident drill | Simulate API key leak/lost server/unauthorized order response. | Security Drill Report | You know how to revoke keys and halt bots. | If response unclear, fix before live. |
| 58 | Market incident drill | Simulate flash crash/exchange outage/order stuck scenario. | Market Drill Report | Incident response steps are written. | If manual panic needed, automation insufficient. |
| 59 | Ops budget review | Review Year 1 ops spend vs budget and ROI. | Ops Spend Report | Subscriptions justified or canceled. | No subscription survives without role. |
| 60 | Month 2 review | Prepare Micro-Live Readiness Binder. | Month 2 Readiness Binder | Backtest, paper, monitoring, risk, ledger, incident docs complete. | If any missing, delay live. |

---

### Week 9 - Micro-Live Readiness Gate

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 61 | Micro-live candidate vote | IC votes on whether any strategy qualifies for $250-$300 live test. | Micro-Live Approval Card | One strategy approved or all rejected. | No shame in no-go. |
| 62 | Live exchange account prep | Create/verify exchange account; complete security; no large deposit yet. | Exchange Readiness Card | MFA, withdrawal whitelist, security settings active. | No API key until account secure. |
| 63 | Live API key creation | Create trading-only API key; withdrawals disabled; IP restrictions if supported. | Live API Key Record | Key stored securely; no withdrawal permission. | If leaked, revoke immediately. |
| 64 | Deposit micro-live capital | Deposit only $250-$300 for first test. | Deposit Confirmation | Only micro amount at risk. | If deposit process uncertain, stop. |
| 65 | Live dry run | Connect key, query balance, no trade or minimum safe test if required. | Live Connectivity Log | Balance query works; no unexpected permissions. | If permissions excessive, delete key. |
| 66 | Final go/no-go | CIO recommends; CRO approves/vetoes; human decides. | Go/No-Go Record | Explicit approval recorded. | No approval, no trade. |
| 67 | Micro-live launch | Start first micro-live strategy under monitoring. | Micro-Live Launch Log | Strategy live with max-loss and halt rules. | If logs are missing, stop strategy. |

---

### Week 10 - $250-$300 Forward Test

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 68 | Micro-live day 1 review | Review fills, fees, slippage, errors. | Micro-Live Daily Report 1 | Reality matches expected behavior or issue logged. | If unexplained behavior, pause. |
| 69 | Micro-live day 2 review | Continue monitoring; no parameter changes. | Micro-Live Daily Report 2 | Strategy stable. | If loss limit hit, halt. |
| 70 | Micro-live day 3 review | Check alert reliability and ledger export. | Micro-Live Daily Report 3 | Alerts and ledger work. | If ledger fails, no scale. |
| 71 | Micro-live day 4 review | Evaluate emotional/operational response. | Operator Psychology Note | No panic-driven intervention. | If emotional load high, reduce capital. |
| 72 | Micro-live day 5 review | Compare live vs paper assumptions. | Live/Paper Gap Note | Slippage/fees documented. | If gap invalidates edge, retire. |
| 73 | Micro-live day 6 review | Check server uptime and API stability. | Uptime/API Report | No critical outages. | If outage, pause and fix. |
| 74 | Micro-live day 7 review | Week 1 live report. | Micro-Live Week 1 Report | Continue, pause, or retire decision. | No scale before day 14 unless risk-reducing. |
| 75 | Micro-live days 8-14 plan | Set second-week observation plan. | Second Week Plan | No unnecessary tinkering. | If strategy unstable, stop. |

---

### Week 11 - $500-$1,000 Forward Test

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 76 | Micro-live day 8 review | Continue observation. | Daily Report 8 | Logs clean. | If issue, classify. |
| 77 | Micro-live day 9 review | Review open/closed orders. | Daily Report 9 | No stuck orders. | If stuck orders, manual cancel and root cause. |
| 78 | Micro-live day 10 review | Review P&L attribution. | Daily Report 10 | P&L drivers understood. | If unexplained P&L, halt. |
| 79 | Micro-live day 11 review | Test recovery restart procedure. | Restart Drill Report | Bot can restart cleanly. | If restart unreliable, no scale. |
| 80 | Micro-live day 12 review | Tax export sample. | Tax Export Sample | Trades export with IDs and fees. | If not, fix ledger. |
| 81 | Micro-live day 13 review | CRO hostile review. | CRO Live Review | Risk officer states reasons not to scale. | If reasons material, do not scale. |
| 82 | Micro-live day 14 review | Complete first live report. | 14-Day Micro-Live Report | Scale/hold/retire decision from evidence. | No vibes. |
| 83 | $500-$1,000 decision | If passed, approve next stage; otherwise retire/hold. | Stage 2 Approval Card | Explicit human approval. | No auto scale. |

---

### Week 12/13 - Deployment Decision and Target Allocation Prep

| Day | Objective | Actions | Artifact | Gate | Failure Rule |
| --- | --- | --- | --- | --- | --- |
| 84 | Deploy Stage 2 if approved | Fund approved $500-$1,000 only. | Stage 2 Launch Log | Same controls active. | If not approved, run more paper. |
| 85 | Stage 2 daily review 1 | Review behavior under larger size. | Stage 2 Report 1 | No slippage surprise. | If size changes edge, halt. |
| 86 | Stage 2 daily review 2 | Review infrastructure and alerts. | Stage 2 Report 2 | Monitoring stable. | If alerts fail, pause. |
| 87 | Stage 2 daily review 3 | Prepare target deployment criteria. | Target Criteria Draft | Clear metrics for $2.5K/$5K gates. | No vague scale plan. |
| 88 | Full sleeve deployment review | Assess whether any strategy qualifies for $2.5K, not full $50K. | Scale Review Packet | Conservative scale decision. | No full deployment without multiple evidence layers. |
| 89 | 90-day final IC | Produce 90-day investment committee report. | 90-Day IC Packet | All strategies ranked; capital status clear. | If not ready, keep micro-live only. |
| 90 | CEO decision day | Choose next: continue paper, continue micro-live, scale to $2.5K/$5K, or pause. | 90-Day CEO Decision Memo | Decision recorded in Boss OS. | No unrecorded capital move. |

---

# Part D - Hardware + Software Setup List

## D1. Shopping List

| Priority | Item | Buy/Use | Decision Rule |
| --- | --- | --- | --- |
| 1 | MacBook command workstation | Use existing only if stable; buy M-series if upgrading | Must comfortably run AI tools + browser + VS Code. |
| 2 | Second monitor | Buy inexpensive monitor if needed | Reduces mistakes during server work. |
| 3 | Encrypted external SSD | Buy at least 1TB | Back up governance, reports, exports, not active API secrets in plaintext. |
| 4 | Password manager | Use paid if needed | Key safety is not optional. |
| 5 | Hardware security key | Optional but recommended | Use for email/cloud/exchange if supported. |

## D2. Operating Budget Governance

| Category | Year 1 Budget Range | Approval Rule |
| --- | --- | --- |
| AI tools | $1,500-$3,000 | Must map to research, coding, review, or monitoring role. |
| Cloud servers | $1,000-$2,000 | Start with one development/paper instance; scale only if needed. |
| Market data | $2,000-$4,000 | Buy only when a strategy needs it and free data is inadequate. |
| Monitoring/logging | $500-$1,000 | Required before live capital. |
| Tax/accounting | $500-$1,500 | Required before meaningful live trading. |
| Reserve | Remainder | Used for unplanned but justified tools. |

## D3. Software Verification Rule

Always install from official websites or package repositories. Never download trading tools from random links, Discord uploads, Telegram files, or unverified GitHub forks. Official Hummingbot documentation states that official code is maintained in the Hummingbot Foundation repositories and DockerHub organization; use official sources only.

---

# Part E - Cloud / Server Setup

## E1. Server Philosophy

The server is the always-on machine. The laptop is the remote control. For the first 90 days, the server is primarily a paper/testnet and micro-live environment, not a full-capital production engine.

## E2. Server Tiers

| Tier | Use | Server | Location | Rule |
| --- | --- | --- | --- | --- |
| Proof / learning | No-money setup and practice | DigitalOcean basic or small AWS instance | US or closest stable region | Acceptable for learning; not assumed optimal for execution. |
| Institutional-style Bot 1 candidate | Paper, micro-live, later production | AWS EC2 t3.large or current equivalent | Tokyo ap-northeast-1 for Binance-focused routing candidate | Use only with billing alerts and cost awareness. |
| On-chain / future Bot 2 candidate | Later experimental on-chain strategies | Separate small instance | US-East or provider-appropriate region | Not Phase 1 live priority. |

## E3. AWS Tokyo Click-by-Click Setup

1. Log into AWS.
2. Set region to Asia Pacific (Tokyo) ap-northeast-1.
3. Open EC2.
4. Click Launch Instance.
5. Name instance Bot1-Tokyo-Dev.
6. Choose Ubuntu LTS.
7. Choose t3.large or current equivalent only if cost is approved; otherwise use a smaller development instance with lower expectations.
8. Create a new key pair named tokyo-key and download the .pem file.
9. Store the .pem file in the secure local folder and password manager notes; do not upload to chat.
10. Set storage to 30GB.
11. Restrict SSH to your IP if you know how; otherwise use temporary broader SSH only until hardened.
12. Launch instance.
13. Copy public IPv4 address into the server inventory.

## E4. Termius Setup

1. Open Termius.
2. Create New Host.
3. Paste AWS public IPv4 address.
4. Set username to ubuntu.
5. Attach tokyo-key.pem as the key.
6. Save host as Bot1-Tokyo-Dev.
7. Connect.
8. Run sudo apt update.
9. Record connection success in the server log.

## E5. VS Code Remote SSH Setup

1. Install VS Code.
2. Install Remote - SSH extension.
3. Add SSH host using the same IP, username, and key.
4. Open remote window.
5. Create /home/ubuntu/quant_fund directory.
6. Create subfolders logs, configs, scripts, data, reports, backups.
7. Create README.md on the server explaining the environment purpose.

## E6. Base Server Commands

Run commands one at a time and capture logs. Example base bootstrap commands:

sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git unzip htop tmux
mkdir -p ~/quant_fund/{logs,configs,scripts,data,reports,backups}
cd ~/quant_fund

> **Command Freshness Rule:** Package and Docker installation commands change. Use the official Docker and Hummingbot installation docs at execution time and paste the exact commands used into the server bootstrap log.

---

# Part F - Strategy Desk Setup

## F1. Desk Structure

| Desk | Capital Source | Strategy Families | What Success Looks Like |
| --- | --- | --- | --- |
| Income-Producing Core | $25K sleeve | Funding/basis/carry, liquid trend, volatility breakout, market spreads, mean reversion basket | Stabilizes portfolio and generates recurring return potential. |
| Growth Alpha | $12.5K sleeve | Momentum, relative strength, high-volatility trend, event-driven liquid trades | Lifts returns without relying on moonshot luck. |
| Experimental Strategy Factory | $7.5K sleeve | AI-generated, copied, forum/GitHub/paper-derived candidates | Produces future Alpha candidates. |
| Moonshot / Convex Bets | $5K sleeve | Listings, launches, small-cap momentum, wallet-following, liquidation rebounds | Can lose sleeve; can produce rare major upside. |

## F2. Strategy Intake Form

| Field | Required Answer |
| --- | --- |
| Strategy name | Clear internal name. |
| Source | Where idea came from: paper, GitHub, trader, forum, AI synthesis, exchange documentation. |
| Market/asset universe | Exact assets and venues. |
| Expected edge | Why this should make money. |
| Persistence thesis | Why the edge might continue. |
| Failure thesis | Why it might stop working. |
| Data required | Candles, order book, funding, on-chain, news, unlocks, etc. |
| Fee/slippage exposure | Estimated impact. |
| Automation suitability | High/medium/low with explanation. |
| Risk limit | Max loss and halt rule. |
| Stage | Research, backtest, paper, micro-live, production, retired. |

## F3. Promotion Scorecard

| Dimension | Pass Standard |
| --- | --- |
| Edge clarity | Human can explain why it might work in plain English. |
| Backtest quality | Fees/slippage included; no obvious overfit; multiple regimes considered. |
| Paper performance | Behavior matches expected mechanics. |
| Operational reliability | Logs, alerts, restart, and ledger work. |
| Risk behavior | Drawdown and loss rules obeyed. |
| Capital capacity | Can absorb next allocation without destroying edge. |
| CRO review | Risk officer has no unresolved hard veto. |

---

# Part G - Paper -> Micro-Live -> Target Deployment Gates

## G1. Trading Engine Setup

Hummingbot is the first execution engine candidate because it is open-source and designed for exchange-connected automated strategies. It is not the whole fund. It is one execution layer beneath Boss OS governance, research, risk, monitoring, and allocation.

- Install only from official Hummingbot sources.
- Document exact version and install commands.
- Run first on testnet/paper only.
- Never paste live keys into strategy files or chat.
- Keep scripts, configs, and logs organized by strategy.
- Use Docker where possible for reproducibility.

## G2. Paper Gate

| Gate Item | Required Before Passing |
| --- | --- |
| Strategy registry | Strategy exists with complete intake form. |
| Backtest | Backtest or documented reason why backtest is not possible. |
| Paper config | Runs without real capital. |
| Logs | Orders, errors, balances, and events captured. |
| Risk simulation | Kill switch and max loss logic tested in simulation. |
| Report | Weekly IC report produced. |

## G3. Micro-Live Gate

| Gate Item | Required Before First $250-$300 Live |
| --- | --- |
| Human approval | Explicit approval recorded in Boss OS. |
| Exchange security | MFA active, withdrawal protections active. |
| API key | Trading-only; withdrawals disabled; IP restriction if possible. |
| Monitoring | Critical alert received successfully before launch. |
| Ledger | Trade export path tested. |
| Incident runbook | API leak, stuck order, outage, flash crash response written. |
| Capital limit | Only $250-$300 deposited for first live test. |

## G4. Scale Ladder

| Stage | Capital | Minimum Evidence |
| --- | --- | --- |
| Research | $0 | Complete strategy intake. |
| Backtest | $0 | Backtest or data feasibility report. |
| Paper | $0 | Stable paper behavior and logs. |
| Micro-live 1 | $250-$300 | Explicit approval, security, monitoring, ledger active. |
| Micro-live 2 | $500-$1,000 | 14-day live report with acceptable behavior. |
| Small live | $2,500 | CRO review and live/paper gap acceptable. |
| Production candidate | $5,000 | Multiple reports, stable ops, clear risk limit. |
| Portfolio Alpha | $5,000+ | Only after repeated evidence and human approval. |

## G5. Target Deployment Rule

The system does not deploy the full $50,000 on Day 1 or Day 90 by default. The $50,000 is available capital, not an obligation to force deployment. Capital is deployed only to strategies that earned it.

---

# Part H - Boss OS Integration Layer

## H1. Roadmap Authority Alignment

The Boss OS Implementation Roadmap places live trading late in the build order: Trading Firm OS Planning Layer, Trading Paper Infrastructure, Trading Live Micro-Test, then Trading Target Deployment. This plan follows that sequence. Trading is included, but gated.

| Boss OS Roadmap Phase | AI Quant Fund Implementation |
| --- | --- |
| Phase 14 - Trading Firm OS Planning Layer | Install risk constitution, approval envelope, strategy registry, bot lifecycle framework, tax/ledger design, security rules, incident runbooks. |
| Phase 15 - Trading Paper Infrastructure | Install Hummingbot testnet/paper setup, logs, backtest vault, monitoring plan, simulated risk engine. |
| Phase 16 - Trading Live Micro-Test | Deploy $250-$1,000 micro-capital with withdrawal-disabled keys, monitoring, ledger capture, kill switch. |
| Phase 17 - Trading Target Deployment | Deploy larger sleeve allocations only after backtest, paper, micro-live, risk, security, tax, and incident gates pass. |

## H2. Boss OS Objects to Create

| Object | Purpose |
| --- | --- |
| Capital Division: AI Quant Fund | Top-level Boss OS domain. |
| Approval Envelope: Trading | Defines what AI can recommend vs execute. |
| Risk Constitution | Drawdown, API, security, leverage, moonshot rules. |
| Strategy Registry | Canonical record of all strategy candidates. |
| Investment Committee Packet | Weekly decision document. |
| Incident Ledger | Every outage, bug, API issue, and abnormal trade. |
| Tax/Ledger Vault | Trade exports and cost basis support. |
| Strategy Cemetery | Rejected and retired strategies with reasons. |

## H3. Boss OS Approval Categories

| Action | AI Authority | Human Approval Required |
| --- | --- | --- |
| Research a strategy | Allowed | No |
| Write paper trading code | Allowed | No, unless paid services or credentials needed |
| Create cloud server | Recommend only | Yes if paid or material recurring cost |
| Create exchange API key | Guide only | Yes |
| Deploy paper strategy | Allowed with no capital | No if no credentials risk |
| Deploy live strategy | Recommend only | Yes |
| Increase allocation | Recommend only | Yes |
| Enable leverage | Forbidden in Phase 1 | Separate future governance required |
| Withdraw funds | Forbidden | Manual human-only action |

## H4. Daily / Weekly / Monthly Cadence

| Cadence | Output |
| --- | --- |
| Daily | NAV, P&L, open positions, strategy status, alerts, incidents, decisions required. |
| Weekly | Investment Committee packet with strategy leaderboard, promotions/demotions, risk review, new ideas. |
| Monthly | CEO report with NAV, P&L, attribution, ops spend, tax exports, capital allocation. |
| Quarterly | Strategy cemetery review, data/tool ROI review, capital policy update. |
| Annual | Year-end performance, tax package, reinvest/distribute decision, Year 2 plan. |

---

# Appendix A - Prompt Pack

## Boss OS Chat A Addendum

Install the AI Quant Fund Capital Division Addendum. This is a personal Boss OS capital project only. It is separate from West Peek. Phase 1 capital ceiling is $50,000 trading capital and up to $10,000 Year 1 operating budget. The system may research, plan, paper trade, and monitor strategies, but no live capital may be deployed without explicit human approval. The mandate is to build an income-producing AI trading asset with a capped $5,000 moonshot sleeve. AI may recommend; risk controls may veto; the market must prove edge.

## Daily Status Prompt

Print AI Quant Fund daily status: NAV, P&L, open positions, live strategy status, paper strategy status, incidents, risk alerts, decisions required, and recommended next action. Do not suggest new trades unless a strategy already has approval authority.

## Strategy Intake Prompt

Evaluate this strategy idea for the Boss OS AI Quant Fund. Complete the strategy intake form: source, market, asset universe, expected edge, persistence thesis, failure thesis, data required, fee/slippage risks, automation suitability, backtest requirements, paper trading requirements, risk limits, and recommended stage.

## Hostile Backtest Review Prompt

Review this backtest like a hostile quant risk officer. Identify overfitting, missing fees, missing slippage, regime weakness, insufficient sample size, hidden leverage, liquidity assumptions, and reasons not to fund this strategy.

## Promotion Committee Prompt

Decide whether this strategy earns more capital. Use only evidence: backtest, paper performance, live performance, operational reliability, risk behavior, drawdown, fees, slippage, and capacity. Recommend promote, hold, demote, retire, or retest.

## Incident Review Prompt

Analyze this trading incident. Classify root cause: strategy defect, execution defect, exchange/API issue, infrastructure issue, monitoring failure, human process failure, or market regime issue. Recommend immediate containment, repair, prevention, and whether the strategy may resume.

# Appendix B - Operational Checklists

## B1. Pre-Live Security Checklist

- Dedicated email secured with MFA
- Exchange MFA active
- Withdrawal whitelist active where supported
- API key has no withdrawal permission
- API key stored securely
- IP restriction enabled if supported
- Billing alerts active for cloud
- Server access documented
- Incident runbook written
- Key revocation process tested

## B2. Strategy Promotion Checklist

- Complete intake form
- Data source documented
- Fees/slippage modeled
- Backtest reviewed
- Paper run completed
- Logs captured
- Risk limit defined
- CRO review completed
- Human approval recorded
- Capital stage assigned

## B3. Weekly IC Checklist

- NAV and P&L
- Open positions
- Strategy leaderboard
- Rejected strategies
- Promotion candidates
- Demotion/retirement candidates
- Incidents
- Ops spend
- Data/tool issues
- Decisions required

# Appendix C - Incident Runbooks

| Incident | Immediate Action | Follow-Up |
| --- | --- | --- |
| API key leak | Revoke key immediately; halt all bots; verify no unauthorized orders/withdrawals. | Create new key only after root cause and storage correction. |
| Exchange outage | Halt affected strategy if order state is unclear; avoid duplicate orders. | Reconcile balances/orders after service resumes. |
| Server unreachable | Do not assume bot stopped; check exchange directly; use cloud console if needed. | Repair SSH, review process manager, improve monitoring. |
| Unexpected order | Cancel open orders if safe; halt strategy; export logs. | Classify cause before restart. |
| Drawdown breach | Halt strategy or portfolio per limit. | CRO review and human decision required before resume. |
| Tax export failure | Pause scale-up; preserve raw exchange history. | Fix export workflow before additional deployment. |

# Appendix D - References and Current Verification Notes

Use current official sources at execution time. The following source categories were used to anchor the plan: original uploaded trading master plan for operational setup structure; Boss OS Implementation Roadmap for trading gate sequence; official Hummingbot documentation for installation/source rules; AWS documentation/pricing pages for EC2/cloud references; Binance and Kraken official API documentation for API key/testnet/security orientation. Do not treat any hardcoded platform instruction as permanent if the official platform documentation has changed.

| Reference Area | Source Type | Operational Use |
| --- | --- | --- |
| Original trading master plan | Uploaded source document | Hardware, server, Termius, VS Code, Hummingbot, API staging inspiration. |
| Boss OS Implementation Roadmap v1 | Uploaded source document | Trading planning layer -> paper infrastructure -> micro-live -> target deployment gates. |
| Hummingbot documentation | Official website/docs | Installation and official source guidance. |
| AWS | Official AWS docs/pricing console | EC2 account/region/server setup. |
| Binance/Kraken | Official API docs/support | Testnet/API key/security permission guidance. |

# Appendix E - Completeness Ledger

| Compiler Check | Result |
| --- | --- |
| Requirement parse included | PASS |
| Architecture included | PASS |
| Outline expansion included | PASS |
| Artifact tracker included | PASS |
| Part A through Part H included | PASS |
| Implementation embedded inside master plan | PASS |
| Hardware setup included | PASS |
| Software setup included | PASS |
| AWS/server setup included | PASS |
| Termius setup included | PASS |
| VS Code Remote SSH setup included | PASS |
| Hummingbot setup path included | PASS |
| Strategy desk setup included | PASS |
| Paper/micro-live/target gates included | PASS |
| Day-by-day 90-day plan included | PASS |
| Boss OS roadmap integration included | PASS |
| Prompts included | PASS |
| Checklists included | PASS |
| Incident runbooks included | PASS |
| No guaranteed return language | PASS |
| No West Peek contamination | PASS |

Final status: COMPLETE - operational draft suitable for Boss OS installation and future implementation planning. Live trading remains gated and unvalidated until the operator completes paper, micro-live, risk, security, tax, and approval steps.
