# Lesson 06 — SDD Pipeline + Feature Delivery

---

## 1. Agent Registry (`feat/spec-driven-development`)

```mermaid
flowchart TD
    subgraph registry [.claude/agents/]
        SC["spec-creator.md<br/>model: opus<br/>6-section spec template<br/>EARS AC + [NEEDS CLARIFICATION]"]
        IP["implementation-planner.md<br/>consumes spec.md<br/>maps tasks to AC IDs<br/>NO spec writing"]
        PV["plan-verifier.md<br/>traceability matrix<br/>AC → task → test → commit"]
        QP["quick-planner.md<br/>(renamed from planner.md)<br/>lightweight, no spec phase"]
        IM["implementer.md"]
        TW["test-writer.md"]
        AR["architecture-reviewer.md"]
        DW["doc-writer.md"]
        RE["researcher.md"]
    end

    subgraph skills [.claude/skills/]
        RP["run-plan/SKILL.md<br/>executes plan.md step by step<br/>commit per phase"]
        WR["workflow-retro/SKILL.md<br/>tokens · cache-hit · tool-calls<br/>trend ledger → docs/retros/ledger.md"]
    end

    SC -->|produces spec.md| IP
    IP -->|produces plan.md| RP
    RP -->|runs phases| IM & TW & AR
    RP -->|final step| PV
    PV -->|verifies| SC

    classDef spec fill:#7c3aed,stroke:#5b21b6,color:#fff
    classDef plan fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef verify fill:#059669,stroke:#047857,color:#fff
    classDef quick fill:#6b7280,stroke:#4b5563,color:#fff
    classDef worker fill:#0891b2,stroke:#0e7490,color:#fff
    classDef skill fill:#d97706,stroke:#b45309,color:#fff

    class SC spec
    class IP plan
    class PV verify
    class QP quick
    class IM,TW,AR,DW,RE worker
    class RP,WR skill
```

---

## 2. SDD Cycle — Sequence

```mermaid
sequenceDiagram
    participant Dev as 👤 Dev
    participant SC as 🟣 spec-creator
    participant IP as 🔵 implementation-planner
    participant RP as 🟠 run-plan skill
    participant IM as 🩵 implementer
    participant PV as 🟢 plan-verifier
    participant WR as 🟡 workflow-retro

    Dev->>SC: describe feature intent
    SC->>SC: 6-section dialog<br/>EARS AC, clear [NEEDS CLARIFICATION]
    SC-->>Dev: specs/SPEC-*.md

    Dev->>IP: attach spec.md
    IP->>IP: cross-model review<br/>(staff engineer role)
    IP-->>Dev: plans/PLAN-*.md

    Dev->>RP: run plan.md
    loop per phase
        RP->>IM: implement task N
        IM-->>RP: code committed
    end
    RP->>PV: verify all AC closed

    PV-->>Dev: traceability matrix<br/>AC → task → test → commit

    Dev->>WR: retro this run
    WR-->>Dev: tokens · cost · ledger row
```

---

## 3. Project Context Folder

```mermaid
flowchart TD
    subgraph schema [DB schema]
        AG["agents.context_doc_paths<br/>text[] DEFAULT []"]
        SK["skills.context_doc_paths<br/>text[] DEFAULT []"]
    end

    subgraph svc [server/modules/context/]
        CS["ContextService<br/>listDocsForRepo()<br/>reindexForRepo()<br/>readDocsByPaths()"]
        RT["routes.ts<br/>GET /repos/:id/context<br/>POST .../context/reindex"]
    end

    subgraph exec [run-executor.ts]
        INJ["inject ## Project context slot<br/>&lt;untrusted source='spec:path'&gt;<br/>…content…<br/>&lt;/untrusted&gt;<br/>only when paths non-empty"]
    end

    subgraph ui [client]
        PC["project-context/page.tsx<br/>left: ContextDocList<br/>right: ContextDocPreview<br/>'Used by N agents' badge"]
        CT["ContextTab (AgentEditor)<br/>drag-and-drop · checkboxes<br/>token counter footer"]
        ST["SkillContextTab (SkillEditor)<br/>same pattern as ContextTab"]
    end

    schema --> svc
    RT --> CS
    CS -->|paths at run time| exec
    RT -->|GET| PC
    RT -->|GET| CT & ST

    classDef db fill:#4f46e5,stroke:#3730a3,color:#fff
    classDef server fill:#0284c7,stroke:#0369a1,color:#fff
    classDef guard fill:#dc2626,stroke:#b91c1c,color:#fff
    classDef frontend fill:#ea580c,stroke:#c2410c,color:#fff

    class AG,SK db
    class CS,RT server
    class INJ guard
    class PC,CT,ST frontend
```

---

## 4. Why + Risk Brief

```mermaid
flowchart LR
    subgraph contracts [shared contracts]
        BC["brief.ts<br/>Brief: what · why · risk_level<br/>risks[]: {kind, description, file_refs[]}<br/>review_focus[]: string[]"]
    end

    subgraph server [server/modules/brief/]
        BRT["routes.ts<br/>POST /pulls/:id/brief (?force)<br/>GET  /pulls/:id/brief → 404 if absent"]
        BSV["service.ts<br/>intent + blast-summary + diff-stats + specs<br/>ONE completeStructured call<br/>cache per PR by headSha"]
        BRR["repository.ts<br/>upsertBrief() · getCachedBrief()"]
    end

    subgraph client [client]
        BH["usePrBrief · useRegenerateBrief"]
        BCA["BriefCard<br/>risk_level color · Regenerate btn<br/>ReviewFocusList (clickable file chips)"]
        OTV["OverviewTab<br/>BriefCard + ReviewFocusList"]
    end

    BC --> BSV
    BRT --> BSV --> BRR
    BH --> BCA --> OTV

    classDef contract fill:#ca8a04,stroke:#a16207,color:#fff
    classDef route fill:#0284c7,stroke:#0369a1,color:#fff
    classDef service fill:#0891b2,stroke:#0e7490,color:#fff
    classDef repo fill:#4f46e5,stroke:#3730a3,color:#fff
    classDef hook fill:#d97706,stroke:#b45309,color:#fff
    classDef ui fill:#ea580c,stroke:#c2410c,color:#fff

    class BC contract
    class BRT route
    class BSV service
    class BRR repo
    class BH hook
    class BCA,OTV ui
```

---

## 5. Onboarding Generator

```mermaid
flowchart TD
    subgraph facts [facts-collector.ts — zero LLM]
        FC["detectPackageManager()<br/>parseDockerCompose()<br/>parseEnvExample()<br/>findOrchestrationScripts()"]
    end

    subgraph ranking [ranking — service.ts]
        RK["getTopFilesByRank() → candidates<br/>getFileRank() → percentile map<br/>getCommitActivity() → hotness map<br/>score = percentile × (1 + normalizedHotness)"]
    end

    subgraph llm [ONE structured LLM call]
        LLM["completeStructured(OnboardingSchema)<br/>5 sections in one shot<br/>system: IMPORTANT — English only<br/>SECURITY: &lt;untrusted&gt; injection guard"]
    end

    subgraph grounding [grounding.ts — pure fns]
        GR["criticalPaths: keep only known file paths<br/>readingPath: keep only known file paths<br/>firstTasks: suggestedPath must NOT be existing file<br/>architecture nodes: validate against known union<br/>enforceNodeCap(): &gt;8 nodes → overflow node"]
    end

    subgraph cache [repository.ts]
        CA["withAdvisoryLock() — pg_try_advisory_lock<br/>upsertOnboarding() — keyed by repoId + headSha<br/>getCachedOnboarding() — skip LLM if headSha unchanged"]
    end

    subgraph degraded [degraded fallback — no LLM]
        DF["indexState.status === 'degraded' | 'failed'<br/>→ buildDegradedSkeleton()<br/>narrativeUnavailable: true<br/>NOT written to cache"]
    end

    subgraph ui [client — onboarding/]
        PG["page.tsx<br/>useOnboarding() POST-as-query<br/>useRegenerateOnboarding() force=true"]
        NAV["ScrollSpyNav<br/>5 anchor links"]
        S1["ArchitectureSection<br/>MermaidDiagram + DrillDownModal"]
        S2["CriticalPathsSection<br/>file cards + GitHub links"]
        S3["HowToRunSection<br/>commands · env vars"]
        S4["ReadingPathSection<br/>ordered reading list"]
        S5["FirstTasksSection<br/>gap type · complexity badge"]
    end

    facts --> ranking --> llm --> grounding --> cache
    degraded -.->|bypasses LLM| cache
    cache --> ui
    PG --> NAV
    PG --> S1 & S2 & S3 & S4 & S5

    classDef collector fill:#0891b2,stroke:#0e7490,color:#fff
    classDef rank fill:#7c3aed,stroke:#5b21b6,color:#fff
    classDef llmCall fill:#059669,stroke:#047857,color:#fff
    classDef ground fill:#dc2626,stroke:#b91c1c,color:#fff
    classDef cacheNode fill:#4f46e5,stroke:#3730a3,color:#fff
    classDef fallback fill:#9ca3af,stroke:#6b7280,color:#fff
    classDef page fill:#ea580c,stroke:#c2410c,color:#fff
    classDef section fill:#d97706,stroke:#b45309,color:#fff
    classDef nav fill:#ca8a04,stroke:#a16207,color:#fff

    class FC collector
    class RK rank
    class LLM llmCall
    class GR ground
    class CA cacheNode
    class DF fallback
    class PG page
    class S1,S2,S3,S4,S5 section
    class NAV nav
```

---

## 6. Feature Models — resolveFeatureModelStrict

```mermaid
flowchart TD
    CALL["resolveFeatureModelStrict(container, workspaceId, id)"]

    CALL --> OVR{"workspace override<br/>in settings.feature_models?"}
    OVR -->|yes| RET1["✅ return {provider, model}"]
    OVR -->|no| DEF{"FEATURE_MODELS[id]<br/>has defaultProvider + defaultModel?"}
    DEF -->|yes| RET2["✅ return default<br/>e.g. openrouter / deepseek-v4-flash"]
    DEF -->|no| ERR["❌ throw ValidationError 422<br/>'No model selected — choose in Settings'"]

    subgraph callers [callers]
        B["brief/service.ts"]
        C["conventions/service.ts"]
        O["onboarding/service.ts"]
        BL["blast/service.ts"]
        ID["intent-deriver.ts<br/>(try/catch → degrade, not 422)"]
        RE["run-executor.ts<br/>(try/catch → degrade, not 422)"]
    end

    callers --> CALL

    classDef entry fill:#7c3aed,stroke:#5b21b6,color:#fff
    classDef decision fill:#ca8a04,stroke:#a16207,color:#fff
    classDef ok fill:#059669,stroke:#047857,color:#fff
    classDef fail fill:#dc2626,stroke:#b91c1c,color:#fff
    classDef caller fill:#0284c7,stroke:#0369a1,color:#fff
    classDef callerSoft fill:#0891b2,stroke:#0e7490,color:#fff

    class CALL entry
    class OVR,DEF decision
    class RET1,RET2 ok
    class ERR fail
    class B,C,O,BL caller
    class ID,RE callerSoft
```

---

## 7. Shared Onboarding Contract

```mermaid
flowchart LR
    subgraph schema [Onboarding schema — @devdigest/shared]
        ON["Onboarding<br/>repoName · filesIndexed<br/>generatedAt · headSha<br/>narrativeUnavailable?"]
        ON --> SEC["sections: OnboardingSections"]
        SEC --> A["architecture: ArchitectureSection<br/>overview · style · nodes[] · edges[]"]
        SEC --> CP["criticalPaths: CriticalPathItem[]<br/>file · whyItMatters · openUrl"]
        SEC --> HTR["howToRun: HowToRunSection<br/>packageManager · commands[] · envVars[] · entrypoint"]
        SEC --> RP["readingPath: ReadingPathItem[]<br/>order · file · reason · openUrl"]
        SEC --> FT["firstTasks: FirstTask[]<br/>title · suggestedPath · gapType<br/>complexity · rationale · verificationHint"]
    end

    classDef root fill:#7c3aed,stroke:#5b21b6,color:#fff
    classDef sections fill:#4f46e5,stroke:#3730a3,color:#fff
    classDef arch fill:#0891b2,stroke:#0e7490,color:#fff
    classDef crit fill:#dc2626,stroke:#b91c1c,color:#fff
    classDef run fill:#059669,stroke:#047857,color:#fff
    classDef read fill:#ca8a04,stroke:#a16207,color:#fff
    classDef tasks fill:#ea580c,stroke:#c2410c,color:#fff

    class ON root
    class SEC sections
    class A arch
    class CP crit
    class HTR run
    class RP read
    class FT tasks
```
