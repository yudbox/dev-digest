# Lesson 06 — Eval Pipeline & Skill Testing

---

## 0. Що побудовано в цьому уроці — карта фіч

```mermaid
mindmap
  root((Lesson 06\nEval Pipeline))
    DB Layer
      eval_cases table
        owner_kind agent|skill
        input_diff / input_files / input_meta
        expected_output jsonb
      eval_runs table
        pass boolean
        recall / precision / citation_accuracy
        batch_id UUID
        agent_version snapshot
    Server Module
      EvalsService
        createCase / listCases / updateCase / deleteCase
        runCase — agent OR skill dispatch
        runAll — batch with shared batch_id
        prefillFromFinding
        wrapSkillBodyIfUntrusted
      EvalsRepository
        Drizzle ORM only
        No LLM calls
      scoring.ts — pure engine
        scoreCase
        scoreRubricCase
        computePass
        computeSkillPass
        computeCitationAccuracy
        caseTypeOf
      SkillEvalStrategy Registry
        findingGroundedStrategy
          2 reviewPR calls with / without
        rubricStrategy
          1 completeStructured call
    API Routes
      POST /eval-cases
      PATCH / DELETE /eval-cases/:id
      POST /eval-cases/:id/run
      POST /agents/:id/eval-runs batch
      POST /skills/:id/eval-runs batch
      GET /eval-dashboard workspace
      GET /agents/:id/eval-dashboard
      POST /findings/:id/eval-case prefill
    Client UI
      EvalsTab shared component
        ownerKind agent|skill
        Metrics hidden for skills
      EvalCaseModal
        Code tab finding-grounded
        PR Meta tab
        Rubric — no Code tab
      EvalDashboard /eval
        Table of agents
        Run All button
      EvalDetail /eval/agentId
        LineChart trend
        RunsTable + batch groups
        CompareRunsModal
      FindingCard
        Turn into eval case button
        Disabled until Accept/Dismiss
```

---

## 1. Підходи до тестування скілів — огляд

```mermaid
mindmap
  root((Skill Testing))
    Example-based
      POSITIVE case
        Input with bug / bad code
        Expected finding
      NEGATIVE case
        Input with clean code
        Expected empty array
    Property-based
      Presence check
        dimension є у POSITIVE ✅
      Constraint check
        score ∈ 1-5 ❌ not supported
        reason not empty ❌ not supported
    Adversarial
      Misleading PR title
        chore: safe cleanup
        but code has breaking change
      Prompt injection
        IGNORE PREVIOUS INSTRUCTIONS
        expected output stays empty
    LLM-as-judge
      Judge model evaluates answer
      ❌ not via modal
      Needs separate infra
    Regression snapshots
      Compare with previous run
      ❌ not via modal
      Needs CI script
```

---

## 2. Що доступно через модалку

```mermaid
quadrantChart
    title Підходи тестування: складність vs доступність через модалку
    x-axis Легко писати --> Складно писати
    y-axis Недоступно в модалці --> Доступно в модалці
    quadrant-1 Пишемо першим
    quadrant-2 Потребує зусиль
    quadrant-3 Потребує інфраструктури
    quadrant-4 Пишемо після базових
    Example-based NEGATIVE: [0.15, 0.85]
    Example-based POSITIVE: [0.35, 0.75]
    Adversarial injection: [0.45, 0.65]
    Adversarial misleading title: [0.40, 0.70]
    Property-based presence: [0.50, 0.55]
    Property-based constraints: [0.60, 0.20]
    LLM-as-judge: [0.75, 0.10]
    Regression snapshots: [0.70, 0.15]
```

---

## 3. Як scoring визначає pass/fail

```mermaid
flowchart TD
    RUN["Run case"] --> TYPE{Skill type?}

    TYPE -->|rubric| R1["1 LLM call\n— no diff —\ntitle + body only"]
    TYPE -->|convention / security / custom| F1["2 LLM calls\nWITH skill\nWITHOUT skill"]

    R1 --> R2["scoreRubricCase\nexpected vs actual\nby dimension name"]
    F1 --> F2["scoreCase x2\nrangesOverlap\nfile + lines"]

    R2 --> R3["computePass\ncaseType + score"]
    F2 --> F3["computeSkillPass\nwithPasses AND NOT withoutPasses"]

    R3 --> RESULT{Pass?}
    F3 --> RESULT

    RESULT -->|✅ YES| GREEN["Last run passed\n1/1 passed"]
    RESULT -->|❌ NO| RED["Last run failed\n0/1 passed"]

    classDef rubric fill:#7c3aed,stroke:#5b21b6,color:#fff
    classDef finding fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef result fill:#059669,stroke:#047857,color:#fff
    classDef fail fill:#dc2626,stroke:#b91c1c,color:#fff

    class R1,R2,R3 rubric
    class F1,F2,F3 finding
    class GREEN result
    class RED fail
```

---

## 4. POSITIVE кейс: чому base model важлива

```mermaid
flowchart LR
    subgraph POSITIVE ["POSITIVE case — must_find"]
        E["expected: [{finding}]"]
    end

    subgraph WITH ["WITH skill"]
        W1["findings: [{finding}]"]
        W2["precision=1, recall=1"]
        W3["withPasses = true ✅"]
    end

    subgraph WITHOUT ["WITHOUT skill"]
        WO1["findings: []"]
        WO2["precision=1, recall=0"]
        WO3["withoutPasses = false ✅"]
    end

    subgraph RESULT2 ["Result"]
        PASS["pass = true AND NOT false\n= TRUE ✅"]
    end

    subgraph FAIL_CASE ["❌ Якщо base model теж знаходить"]
        WO4["without findings: [{finding}]"]
        WO5["withoutPasses = true"]
        FAIL2["pass = true AND NOT true\n= FALSE ❌\nСкіл не додає цінності"]
    end

    E --> W1
    W1 --> W2 --> W3
    E --> WO1
    WO1 --> WO2 --> WO3
    W3 & WO3 --> PASS

    style PASS fill:#059669,color:#fff
    style FAIL2 fill:#dc2626,color:#fff
    style FAIL_CASE fill:#fef2f2,stroke:#fca5a5
```

---

## 5. Рецепт хорошого POSITIVE кейсу для convention/security скілів

```mermaid
flowchart TD
    Q1{"Base model\nзнаходить без скілу?"}
    Q1 -->|YES| BAD["❌ Поганий кейс\nbase model вже знає"]
    Q1 -->|NO| Q2{"Скіл\nзнаходить зі скілом?"}
    Q2 -->|NO| WEAK["❌ Слабкий скіл\nне допомагає"]
    Q2 -->|YES| GOOD["✅ Хороший кейс!\nСкіл додає цінність"]

    BAD --> FIX["Зробити input тонкішим:\n— misleading PR title\n— зміна виглядає як 'покращення'\n— потрібен domain knowledge"]

    style GOOD fill:#059669,color:#fff
    style BAD fill:#dc2626,color:#fff
    style WEAK fill:#d97706,color:#fff
```

---

## 6. End-to-end Eval Pipeline — архітектура

```mermaid
flowchart TD
    subgraph CLIENT ["Client (Next.js 15 + TanStack Query)"]
        FC["FindingCard\n— Accept / Dismiss\n— Turn into eval case ▶"]
        MODAL["EvalCaseModal\npre-filled form\nRun / Save / Cancel"]
        ET["EvalsTab\n(AgentEditor | SkillEditor)\nметрики + список кейсів"]
        DASH["EvalDashboard /eval\nтаблиця агентів\nRun All кнопка"]
        DETAIL["EvalDetail /eval/[agentId]\nLineChart + RunsTable\n+ CompareRunsModal"]
    end

    subgraph SERVER ["Server (Fastify 5 + Drizzle ORM)"]
        PF["prefillFromFinding\nacceptedAt→must_find\ndismissedAt→must_not_flag\nsliceDiff до файлу знахідки"]
        SVC["EvalsService\norchestrator"]
        REPO["EvalsRepository\nDrizzle — SQL only"]
        SCR["scoring.ts\npure, ZERO LLM calls\nrecall / precision / citation"]
        STRAT["SkillEvalStrategy\nRegistry dispatch"]
        LLM["reviewPullRequest\n(reviewer-core)\nABО completeStructured"]
    end

    subgraph DB ["PostgreSQL"]
        EC["eval_cases\n— owner_kind, owner_id\n— input_diff / input_meta\n— expected_output jsonb"]
        ER["eval_runs\n— pass, recall, precision\n— citation_accuracy\n— batch_id, agent_version"]
    end

    FC -->|"POST /findings/:id/eval-case"| PF
    PF --> MODAL
    MODAL -->|"POST /eval-cases"| SVC
    SVC --> REPO --> EC

    ET -->|"POST /eval-cases/:id/run\nабо /agents/:id/eval-runs"| SVC
    SVC --> STRAT
    STRAT --> LLM
    LLM --> SCR
    SCR --> REPO
    REPO --> ER

    DASH -->|"POST /eval-runs/all"| SVC
    DETAIL -->|"GET /agents/:id/eval-dashboard"| SVC

    ET -.->|"GET /eval-cases?owner_id=..."| REPO
    DASH -.->|"GET /eval-dashboard"| REPO
    DETAIL -.->|joined runs + batches| REPO

    classDef client fill:#1d4ed8,stroke:#1e40af,color:#fff
    classDef server fill:#7c3aed,stroke:#5b21b6,color:#fff
    classDef db fill:#059669,stroke:#047857,color:#fff

    class FC,MODAL,ET,DASH,DETAIL client
    class PF,SVC,REPO,SCR,STRAT,LLM server
    class EC,ER db
```

---

## 7. DB Schema — eval_cases + eval_runs

```mermaid
erDiagram
    eval_cases {
        uuid id PK
        uuid workspace_id FK
        text owner_kind "agent | skill"
        uuid owner_id "agents.id OR skills.id"
        text name
        text input_diff "unified diff (nullable)"
        jsonb input_files "nullable"
        jsonb input_meta "prTitle, prBody, prNumber"
        jsonb expected_output "ExpectedFinding[] OR RubricAssessment[]"
        text notes
    }

    eval_runs {
        uuid id PK
        uuid case_id FK
        timestamp ran_at
        jsonb actual_output "findings or RubricAssessment[]"
        boolean pass
        double recall
        double precision
        double citation_accuracy "null for rubric"
        integer duration_ms
        double cost_usd
        uuid batch_id "shared per Run All"
        integer agent_version "snapshot, null for skills"
    }

    eval_cases ||--o{ eval_runs : "has many"
```

---

## 8. API Routes — повна карта

```mermaid
mindmap
  root((API Routes\nEvals Module))
    eval_cases CRUD
      POST /eval-cases
        create case
      GET /eval-cases
        list owner_kind + owner_id filter
      GET /eval-cases/:id
        one case
      PATCH /eval-cases/:id
        partial update
      DELETE /eval-cases/:id
        cascade eval_runs
    Run endpoints
      POST /eval-cases/:id/run
        run ONE case
        agent → 1 reviewPR call
        skill → strategy dispatch
      POST /agents/:id/eval-runs
        Run All for agent
        shared batch_id
        returns EvalBatchSummary
      POST /skills/:id/eval-runs
        Run All for skill
        no aggregate summary
      POST /eval-runs/all
        workspace-wide Run All
        тільки агенти з cases count > 0
    Dashboard reads
      GET /eval-dashboard
        workspace EvalDashboardOverview
      GET /agents/:id/eval-dashboard
        EvalDashboard per agent
      GET /skills/:id/eval-dashboard
        EvalDashboard per skill
    Cross-module
      POST /findings/:id/eval-case
        lives in reviews/routes.ts
        calls prefillFromFinding
```

---

## 9. SkillEvalStrategy — Registry Pattern

```mermaid
flowchart TD
    RUN["POST /eval-cases/:id/run\nабо POST /skills/:id/eval-runs"]
    OWN{owner_kind?}
    RUN --> OWN

    OWN -->|agent| AGENT["runOneAgentCase\n1× reviewPullRequest\nREFERENCE_PROMPT only"]
    OWN -->|skill| WRAP["wrapSkillBodyIfUntrusted\nsource=imported_url|community\n→ XML sandbox"]

    WRAP --> DISPATCH["SKILL_EVAL_STRATEGIES\n skill.type → strategy"]

    DISPATCH -->|convention\nsecurity\ncustom| FG["findingGroundedStrategy\nusesDiff: true\n2× reviewPullRequest\nWITH skill | WITHOUT skill"]
    DISPATCH -->|rubric| RUB["rubricStrategy\nusesDiff: false\n1× completeStructured\ntitle + body only\nno diff"]

    FG --> SCORE_FG["scoreCase x2\ncomputeSkillPass\nwithPasses AND NOT withoutPasses"]
    RUB --> SCORE_RUB["scoreRubricCase\ncomputePass\ndimension name match"]

    SCORE_FG --> INSERT["Insert eval_run\npass / recall / precision\ncitation_accuracy"]
    SCORE_RUB --> INSERT

    classDef agent fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef skill fill:#7c3aed,stroke:#5b21b6,color:#fff
    classDef scoring fill:#059669,stroke:#047857,color:#fff
    classDef security fill:#dc2626,stroke:#b91c1c,color:#fff

    class AGENT agent
    class DISPATCH,FG,RUB skill
    class SCORE_FG,SCORE_RUB,INSERT scoring
    class WRAP security
```

---

## 10. EvalCaseModal — структура табів

```mermaid
flowchart TD
    OPEN["Відкрити EvalCaseModal\n(New / Edit / prefill)"]
    OPEN --> TYPE{skill.type?}

    TYPE -->|rubric| RUBRIC_TABS["Тільки PR Meta\n(prTitle, prBody)\nБЕЗ Code таба\nusesDiff: false"]
    TYPE -->|convention\nsecurity\ncustom| FG_TABS["Два таби:\n① Code  ② PR Meta"]

    FG_TABS --> CODE_TAB["Code tab\nSub-tabs:\n— New file (After only)\n— Modified file (Before + After)"]
    FG_TABS --> META_TAB["PR Meta tab\nprTitle, prBody\nprNumber, prUrl"]

    RUBRIC_TABS --> RUBRIC_OUT["expected_output:\nRubricAssessment[]\n{dimension, score, reason}"]
    CODE_TAB --> FG_OUT["expected_output:\nExpectedFinding[]\n{file, start_line, end_line, body}"]
    META_TAB --> FG_OUT

    RUBRIC_OUT --> BUTTONS["Run / Save / Cancel\nstatus: X/Y passed"]
    FG_OUT --> BUTTONS

    classDef rubric fill:#7c3aed,stroke:#5b21b6,color:#fff
    classDef finding fill:#2563eb,stroke:#1d4ed8,color:#fff

    class RUBRIC_TABS,RUBRIC_OUT rubric
    class FG_TABS,CODE_TAB,META_TAB,FG_OUT finding
```

---

## 11. prefillFromFinding — звідки беруться дані

```mermaid
flowchart LR
    FIND["FindingCard\n— Accept кнопка натиснута\nабо Dismiss"]

    FIND -->|"POST /findings/:id/eval-case"| PF["prefillFromFinding(findingId)"]

    PF --> CTX["findingContext(findingId)\nfinding + review + pull"]
    CTX --> BRANCH{finding.acceptedAt?}

    BRANCH -->|not null = accepted| MUST["expected_output =\n[{file, start_line, end_line, body}]\ncaseType: must_find ✅"]
    BRANCH -->|null = dismissed| NOT["expected_output = []\ncaseType: must_not_flag 🚫"]

    MUST --> DIFF["inputDiff =\nsliceDiff(diff, finding.file)\nтільки файл знахідки"]
    NOT --> DIFF_EMPTY["inputDiff = ''\n(файл не у diff\nабо dismissed)"]

    DIFF --> META["inputMeta = { prTitle, prBody, prNumber }"]
    DIFF_EMPTY --> META

    META --> PREFILLED["EvalCaseModal\nname, diff, meta — вже заповнені\nUser: підтверджує або редагує"]

    style MUST fill:#059669,color:#fff
    style NOT fill:#dc2626,color:#fff
```

---

## 12. Три метрики — що вони означають

```mermaid
flowchart TD
    subgraph SCORING ["scoring.ts — три числа на вихід"]
        RECALL["Recall\ntp / tp + fn\nЧи знайшов ВСЕ очікуване?\n1.0 = нічого не пропустив"]
        PRECISION["Precision\ntp / tp + fp\nЧи немає зайвого шуму?\n1.0 = жодного false positive"]
        CITATION["Citation Accuracy\nkept / kept + dropped\nЧи посилається на реальні рядки?\n(з groundFindings, не окремий LLM call)"]
    end

    subgraph PASS ["computePass — logic"]
        MF["must_find:\nrecall === 1 AND precision === 1\nзнайшов і без шуму"]
        MNF["must_not_flag:\nprecision === 1\nнічого не сфлагував"]
    end

    subgraph SKILL_PASS ["computeSkillPass — extra gate"]
        SP["must_find:\nwithPasses AND NOT withoutPasses\nСкіл РОБИТЬ РІЗНИЦЮ"]
        SP2["must_not_flag:\nwithScore.precision === 1\nСкіл не додає false positive"]
    end

    RECALL --> MF
    PRECISION --> MF & MNF
    CITATION -.->|"тільки для finding-grounded\nnull для rubric"| SP

    MF --> SP
    MNF --> SP2

    classDef metric fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef pass fill:#059669,stroke:#047857,color:#fff
    classDef skill fill:#7c3aed,stroke:#5b21b6,color:#fff

    class RECALL,PRECISION,CITATION metric
    class MF,MNF pass
    class SP,SP2 skill
```

---

## 13. Eval Dashboard UI — три сторінки

```mermaid
flowchart TD
    subgraph EVALS_TAB ["EvalsTab (AgentEditor / SkillEditor)"]
        ET_M["Eval metrics\n(тільки для agent)\nrecall / precision / citation\n∆ відносно попереднього батчу"]
        ET_C["Eval cases список\nкожен кейс: Run / Edit / Delete\n+ Run all + New case"]
        ET_NAV["View full dashboard → /eval/:id\n(тільки для agent)"]
        ET_M --> ET_C --> ET_NAV
    end

    subgraph DASH ["EvalDashboard /eval"]
        D_T["EvalDashboardTable\nодин рядок = один агент\nrecall / precision / citation\nkases count / last run"]
        D_RUN["Run All Evals\nPOST /eval-runs/all\nзапускає ВСІ агенти"]
        D_CLICK["Click row\n→ router.push('/eval/:id')"]
        D_T --> D_RUN
        D_T --> D_CLICK
    end

    subgraph DETAIL ["EvalDetail /eval/[agentId]"]
        DT_M["MetricCard × 3\nrecall / precision / citation\n∆ тільки коли ≥ 2 батчі"]
        DT_CHART["LineChart\nтренд метрик по батчах"]
        DT_RUNS["RunsTable\ngroupRunsByBatch\ncheckboxes для порівняння"]
        DT_CMP["CompareRunsModal\nprompt diff + metric diff\n2 вибрані батчі side-by-side"]
        DT_M --> DT_CHART --> DT_RUNS --> DT_CMP
    end

    EVALS_TAB -->|"навігація"| DETAIL
    DASH -->|"click row"| DETAIL

    classDef agent fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef skill fill:#7c3aed,stroke:#5b21b6,color:#fff

    class ET_M,ET_NAV,D_T,D_RUN,D_CLICK,DT_M,DT_CHART,DT_RUNS,DT_CMP agent
    class ET_C skill
```

---

## 14. batch_id — концепція групування запусків

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client
    participant S as EvalsService
    participant DB as eval_runs

    U->>C: Click "Run all evals" (agent)
    C->>S: POST /agents/:id/eval-runs
    S->>S: batchId = randomUUID()
    S->>S: ranAt = new Date()

    loop for each eval_case
        S->>S: runOneAgentCase(case, batchId, ranAt)
        S->>DB: INSERT eval_run {batchId, agentVersion=agent.version}
    end

    S->>S: macroAverage(allRunRows)
    S-->>C: EvalBatchSummary {recall, precision, citation, pass_count}

    Note over DB: Всі рядки цього батчу\nмають однаковий batch_id\n→ RunsTable може їх групувати\n→ CompareRunsModal порівнює 2 батчі

    U->>C: Click "Run" (одиночний кейс)
    C->>S: POST /eval-cases/:id/run
    S->>S: batchId = randomUUID() (теж є, але один run)
    S->>DB: INSERT eval_run {batchId = single-run UUID}
```

---

## 15. Security — wrapSkillBodyIfUntrusted

```mermaid
flowchart LR
    SKILL["skill.source"]
    SKILL --> SRC{source?}

    SRC -->|"'user' / 'template'"\nнадійне джерело| SAFE["skill.body\nвикористовується як є\nу systemPrompt"]
    SRC -->|"'imported_url'"\n'community'"| WRAP["XML sandbox:\n&lt;untrusted source='skill:...'&gt;\n  skill.body\n&lt;/untrusted&gt;"]

    WRAP --> ESCAPE["replaceAll('&lt;/untrusted&gt;', '&lt;\\/untrusted&gt;')\nзаповзяння injection через закриваючий тег"]

    SAFE --> SYS["systemPrompt =\nREFERENCE_PROMPT\n+ wrappedBody"]
    WRAP --> SYS
    ESCAPE --> SYS

    SYS --> LLM["reviewPullRequest()\nабо completeStructured()"]

    style WRAP fill:#dc2626,color:#fff
    style ESCAPE fill:#d97706,color:#fff
    style SAFE fill:#059669,color:#fff
```

---

## 1. Підходи до тестування скілів — огляд
