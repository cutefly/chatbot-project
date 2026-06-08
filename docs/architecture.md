# Application Architecture Diagram

> **현행화 규칙**: 소스코드 변경 시 이 파일도 함께 수정합니다.  
> 마지막 업데이트: 2026-06-05 | 기준 커밋: `46fc0ad` (feature/implement-menus)

Mermaid 다이어그램은 GitHub, GitLab, VSCode(Markdown Preview Mermaid Support 확장) 등에서 렌더링됩니다.

---

## 1. 시스템 전체 구조

```mermaid
graph TB
    TG["📱 Telegram App\n(사용자)"]
    FW["🌐 Fastify Server\n:3000"]
    BOT["🤖 grammy Bot"]
    OR["☁️ OpenRouter API\nhttps://openrouter.ai"]
    DB[("🗄️ PostgreSQL\n(Prisma)")]
    OME["☁️ Open-Meteo API\napi.open-meteo.com"]
    GEO["☁️ GeoNames API\napi.geonames.org"]
    INT["🔁 Internal API\nlocalhost:{PORT}"]

    TG -- "HTTPS POST /webhook" --> FW
    FW -- "webhook update" --> BOT
    BOT -- "LLM 응답 / 명령 결과" --> TG
    BOT -- "chat(model, messages)" --> OR
    BOT -- "prisma.*" --> DB
    INT -- "GET /api/get-time-by-region" --> FW
    OR -- "tool_calls" --> OME
    OR -- "tool_calls" --> GEO
    OR -- "tool_calls" --> INT
```

---

## 2. 서버 시작 순서 (main.ts)

```mermaid
sequenceDiagram
    participant M as main.ts
    participant TI as tools/index.ts
    participant L as tools/loader.ts
    participant R as tools/registry.ts
    participant DB as db/client.ts (Prisma)
    participant B as bot/index.ts
    participant S as server/index.ts
    participant TG as Telegram API

    M->>TI: import (1st — must be first)
    TI->>R: toolRegistry.register(echoTool)
    TI->>L: loadToolDefs(toolRegistry)
    L->>L: readdirSync("src/tools/defs/")
    loop 각 .yaml 파일
        L->>L: readFileSync + parseYaml()
        L->>L: frontmatterSchema.parse() [Zod]
        L->>L: buildToolFromSpec(spec, {allowlist, vars})
        alt optional: true이고 {VAR} 미정의
            L-->>M: console.warn + skip
        else 정상 또는 필수 파일 오류
            L->>R: toolRegistry.register(tool)
        end
    end
    M->>DB: prisma.$connect()
    M->>DB: seedDefaultMenus() — MenuItem 없으면 기본 메뉴 트리 생성
    M->>B: createBot()
    B->>B: new Bot(TELEGRAM_BOT_TOKEN)
    B->>B: bot.use(whitelistMiddleware)
    B->>B: bot.command('start'|'menu'|'reset'|'model'|'models'|'status', ...)
    B->>B: bot.on('message:text', messageHandler)
    B->>B: bot.on('callback_query:data', callbackQueryHandler)
    M->>S: createServer(bot)
    S->>S: Fastify() + GET /health
    S->>S: GET /api/get-time-by-region
    S->>S: POST /webhook
    M->>TG: bot.api.setWebhook(WEBHOOK_URL/webhook)
    M->>S: server.listen(:3000)
```

---

## 3. 메시지 처리 파이프라인 (핵심 흐름)

```mermaid
sequenceDiagram
    participant TG as Telegram
    participant S as server/index.ts
    participant WL as middleware/whitelist.ts
    participant MH as handlers/message.ts
    participant US as services/user.ts
    participant CS as services/conversation.ts
    participant LLM as services/llm.ts
    participant EX as tools/executor.ts
    participant TR as tools/registry.ts
    participant DB as PostgreSQL

    TG->>S: POST /webhook (x-telegram-bot-api-secret-token 검증)
    S->>WL: whitelistMiddleware(ctx, next)
    WL->>US: getOrCreateUser(telegramId)
    US->>DB: prisma.user.upsert()
    WL->>US: isUserAllowed(telegramId)
    US->>DB: prisma.user.findUnique()
    alt isAllowed = false
        WL-->>TG: "접근 권한이 없습니다."
    else isAllowed = true
        WL->>MH: next() → messageHandler(ctx)
        MH->>MH: processMessage(ctx, text)
        MH->>US: getOrCreateUser(telegramId)
        MH->>CS: getOrCreateActive(userId)
        CS->>DB: prisma.conversation.findFirst() / create()
        MH->>CS: getWindow(conversationId)
        CS->>DB: prisma.message.findMany(DESC LIMIT N).reverse()
        MH->>LLM: chat(model, messages)
        Note over LLM: LLM 호출 루프 (max 5회)
        LLM->>LLM: toolRegistry.toFunctionDefinitions()
        LLM->>LLM: callOpenRouter(model, messages, tools)
        alt finish_reason = "tool_calls"
            LLM->>EX: executeToolCalls(tool_calls)
            EX->>TR: toolRegistry.get(name)
            EX->>EX: tool.execute(args) [병렬 Promise.all]
            Note over EX: 아래 툴 실행 상세 참조
            EX-->>LLM: ToolResult[] (각각 isError 플래그 포함)
            LLM->>LLM: collectGuidance(isError=false인 calls만) → system 메시지 추가
            LLM->>LLM: 다음 반복 (callOpenRouter)
        else finish_reason = "stop"
            LLM-->>MH: finalResponse (string)
        end
        MH->>CS: saveMessages(conversationId, [user, assistant])
        CS->>DB: prisma.message.createMany()
        MH-->>TG: ctx.reply(response, MarkdownV2) or ctx.reply(response)
    end
```

---

## 4. 툴 실행 상세 (executor.ts + loader.ts)

```mermaid
sequenceDiagram
    participant EX as tools/executor.ts
    participant TR as tools/registry.ts
    participant LD as tools/loader.ts (execute fn)
    participant TF as tools/transforms/*
    participant OMAPI as Open-Meteo API
    participant GEOAPI as GeoNames API
    participant INTAPI as Internal API (Fastify)

    EX->>TR: toolRegistry.get("temp_by_region" | "cities_by_country" | "time_by_region")
    TR-->>EX: Tool { execute }
    EX->>LD: tool.execute({ latitude, longitude } | { country } | { region })

    Note over LD: [1] 인자 검증 + 기본값 + 타입 강제 변환(coerce)
    Note over LD: [2] URL 조립: path→encodeURIComponent, query→URLSearchParams
    Note over LD: [3] assertHostAllowed(finalUrl, allowlist) — SSRF 방어
    Note over LD: [4] fetch(url, { method, headers, signal: AbortController(timeout_ms) })

    alt temp_by_region
        LD->>OMAPI: GET /v1/forecast?current=temperature_2m&latitude=..&longitude=..
        OMAPI-->>LD: { current: { temperature_2m }, current_units: { temperature_2m } }
        LD->>TF: transforms/temperature.ts default(data)
        TF-->>LD: { temperature: 20.5, unit: "°C" }
    else cities_by_country
        LD->>GEOAPI: GET /searchJSON?featureClass=P&orderby=population&maxRows=10&username=..&country=KR
        GEOAPI-->>LD: { geonames: [{ name, population, countryName }] }
        LD->>TF: transforms/cities.ts default(data)
        TF-->>LD: { country: "South Korea", cities: ["Seoul", "Busan", ...] }
    else time_by_region
        LD->>INTAPI: GET /api/get-time-by-region?region=Asia/Seoul
        INTAPI->>INTAPI: isValidTimeZone(region)
        INTAPI->>INTAPI: buildZonedIso(region, new Date()) [Intl.DateTimeFormat]
        INTAPI-->>LD: { region, datetime: "2026-06-04T10:00:00+09:00", timezone }
        LD->>TF: transforms/time.ts default(data)
        TF-->>LD: { region, datetime: "2026-06-04 10:00:00", timezone }
    end

    alt 성공
        LD-->>EX: result (unknown)
        EX-->>EX: ToolCallResult { content:[{type:'text',text:JSON}], isError:false }
    else 실패 (throw)
        LD-->>EX: throws Error
        EX-->>EX: ToolCallResult { content:[{type:'text',text:message}], isError:true }
    end
    EX-->>EX: toToolResult() → ToolResult { content:JSON, isError, role:'tool', tool_call_id }
```

---

## 5. 콜백쿼리 처리 (버튼 탭 dispatch)

```mermaid
flowchart TD
    TG["Telegram callback_query:data"]
    CQ["handlers/callbackQuery.ts"]
    TG --> CQ

    CQ --> P1{"prefix?"}

    P1 -->|"menu:{id}"| M["handleMenuTap(id)"]
    P1 -->|"result:{subId}:{value}"| R["handleResultTap(subId, value)"]
    P1 -->|"action:{itemId}:{value}"| A["handleActionTap(itemId, value)"]
    P1 -->|"legacy_menu:{id}"| L["handleLegacyMenu(id)\n← menu.json 하위호환"]

    M --> MT{"actionType?"}
    MT -->|submenu| MS["getChildren(id)\n→ InlineKeyboard"]
    MT -->|tool| MT2["callToolPrompt(ctx, prompt)\n→ parseListFromLLMResponse()\n→ buildDynamicKeyboard(items, resultSubmenuId)\n→ reply with buttons"]
    MT -->|prompt| MP["processMessage(ctx, actionValue)"]

    R --> RS["getChildren(submenuId)\n→ buildActionKeyboard(children, value)\n→ reply '어떤 정보를 조회할까요?'"]

    A --> AS["getMenuItemById(itemId)\n→ actionValue.replace({value}, value)\n→ processMessage(ctx, prompt)"]
```

---

## 6. 명령어 처리 일람

```mermaid
flowchart LR
    BOT["grammy Bot"]

    BOT --> S["/start\nstartCommand\n→ 안내 메시지"]
    BOT --> ME["/menu\nmenuCommand\n→ getRootMenuItems()\n→ InlineKeyboard (DB 기반)"]
    BOT --> RE["/reset\nresetCommand\n→ createConversation(userId)\n→ 새 Conversation 레코드"]
    BOT --> MO["/model model-id\nmodelCommand\n→ updateConversationModel(id, model)"]
    BOT --> MS["/models\nmodelsCommand\n→ CURATED_MODELS 목록 출력"]
    BOT --> ST["/status\nstatusCommand\n→ getWindow()\n→ 모델 + 메시지 수 출력"]
```

---

## 7. 데이터 모델 (PostgreSQL / Prisma)

```mermaid
erDiagram
    User {
        Int id PK
        BigInt telegramId UK
        String username
        String firstName
        Boolean isAllowed
        DateTime createdAt
        DateTime updatedAt
    }
    Conversation {
        Int id PK
        Int userId FK
        String model
        DateTime createdAt
        DateTime updatedAt
    }
    Message {
        Int id PK
        Int conversationId FK
        Role role
        String content
        DateTime createdAt
    }
    MenuItem {
        Int id PK
        String label
        Int parentId FK
        Int sortOrder
        Boolean isActive
        String actionType
        String actionValue
        Int resultSubmenuId FK
        DateTime createdAt
        DateTime updatedAt
    }

    User ||--o{ Conversation : "has many"
    Conversation ||--o{ Message : "has many"
    MenuItem ||--o{ MenuItem : "children (MenuTree)"
    MenuItem ||--o{ MenuItem : "resultSubmenuOf"
```

> `Role` enum: `user` | `assistant` | `system` | `tool`  
> Active conversation = `ORDER BY createdAt DESC LIMIT 1`  
> Sliding window = 최근 N개 메시지 (`CONVERSATION_WINDOW_SIZE`, 기본 20)

---

## 8. 선언형 툴 시스템 구조

```mermaid
flowchart TD
    subgraph "서버 시작 시 1회"
        YAML["src/tools/defs/*.yaml\n(time_by_region\ntemp_by_region\ncities_by_country)"]
        LDR["loader.ts\nloadToolDefs()"]
        PARSE["frontmatterSchema.parse()\nZod 검증"]
        BUILD["buildToolFromSpec()\n• {VAR} 치환\n• host allowlist 검증\n• JSON Schema 생성\n• execute() 클로저 생성"]
        REG["registry.ts\ntoolRegistry.register()"]

        YAML -->|readFileSync + parseYaml| LDR
        LDR --> PARSE
        PARSE --> BUILD
        BUILD --> REG
    end

    subgraph "런타임 (execute 호출 시)"
        ARGS["LLM args\n{latitude, longitude}\n{country}\n{region}"]
        VALIDATE["인자 검증\n+ 기본값 적용\n+ 타입 coerce"]
        URL["URL 조립\nURLSearchParams 병합\nassertHostAllowed()"]
        FETCH["fetch()\nAbortController\ntimeout_ms"]
        TRANSFORM["transforms/*.ts\ndefault(data)"]
        RESULT["{ temperature, unit }\n{ country, cities[] }\n{ region, datetime, timezone }"]

        ARGS --> VALIDATE --> URL --> FETCH --> TRANSFORM --> RESULT
    end

    subgraph "보안 레이어"
        AL["TOOL_ENDPOINT_ALLOWLIST\nlocalhost:{PORT}\napi.open-meteo.com\napi.geonames.org"]
        SV["getToolSubstitutionVars()\n{ PORT, ...TOOL_VARS }\n※ secrets 제외"]
    end

    BUILD -.->|검증| AL
    BUILD -.->|치환| SV
    URL -.->|런타임 재검증| AL
```

---

## 9. 파일 의존 관계

```mermaid
graph LR
    main["main.ts"]
    ti["tools/index.ts"]
    tl["tools/loader.ts"]
    tr["tools/registry.ts"]
    te["tools/executor.ts"]
    tt["tools/types.ts"]
    echo["tools/echo.ts"]
    bi["bot/index.ts"]
    wl["bot/middleware/whitelist.ts"]
    cmd["bot/commands/*"]
    mh["bot/handlers/message.ts"]
    cq["bot/handlers/callbackQuery.ts"]
    si["server/index.ts"]
    st["server/time.ts"]
    us["services/user.ts"]
    cs["services/conversation.ts"]
    ls["services/llm.ts"]
    db["db/client.ts"]
    cfg["config/index.ts"]

    main --> ti
    main --> db
    main --> cfg
    main --> bi
    main --> si

    ti --> tr
    ti --> echo
    ti --> tl
    tl --> tr
    tl --> tt
    tl --> cfg

    bi --> wl
    bi --> cmd
    bi --> mh
    bi --> cq
    bi --> cfg

    wl --> us
    cmd --> us
    cmd --> cs
    cmd --> cfg
    mh --> us
    mh --> cs
    mh --> ls
    cq --> mh
    cq --> cfg

    si --> st
    si --> cfg

    ls --> tr
    ls --> te
    ls --> cfg

    te --> tr
    te --> tt

    us --> db
    cs --> db
    cs --> cfg
    db --> cfg
    ms["services/menu.ts"] --> db
    cq --> ms
    cq --> mh2["handlers/menuHelpers.ts"]
    mh2 --> ls
    mh2 --> us
    mh2 --> cs
```

---

## 10. 동적 계층형 메뉴 시스템 (feature/implement-menus)

```mermaid
sequenceDiagram
    participant TG as Telegram
    participant CQ as handlers/callbackQuery.ts
    participant MS as services/menu.ts
    participant MH as handlers/menuHelpers.ts
    participant LLM as services/llm.ts
    participant DB as PostgreSQL (MenuItem)

    Note over TG,DB: /menu 명령어
    TG->>CQ: /menu
    CQ->>MS: getRootMenuItems()
    MS->>DB: findMany(parentId=null, isActive=true)
    DB-->>MS: MenuItem[]
    CQ-->>TG: InlineKeyboard (menu:{id} per item)

    Note over TG,DB: 정적 서브메뉴 탭 (menu:{id}, actionType=submenu)
    TG->>CQ: callback menu:1
    CQ->>MS: getMenuItemById(1)
    CQ->>MS: getChildren(1)
    MS->>DB: findMany(parentId=1)
    CQ-->>TG: InlineKeyboard (자식 항목 버튼)

    Note over TG,DB: Tool 항목 탭 (menu:{id}, actionType=tool)
    TG->>CQ: callback menu:2  (한국, cities_by_country:KR)
    CQ->>MS: getMenuItemById(2)
    CQ->>MH: callToolPrompt(ctx, "cities_by_country 도구로 KR 조회해줘")
    MH->>LLM: chat(model, messages)
    LLM-->>MH: "한국의 주요 도시 목록입니다:\n- 서울\n- 부산..."
    CQ->>MH: parseListFromLLMResponse(response)
    MH-->>CQ: ["서울", "부산", "인천", ...]
    CQ->>MH: buildDynamicKeyboard(items, resultSubmenuId)
    CQ-->>TG: LLM 응답 텍스트 + 동적 버튼 (result:{submenuId}:{city})

    Note over TG,DB: 동적 결과 버튼 탭 (result:{submenuId}:{value})
    TG->>CQ: callback result:5:서울
    CQ->>MS: getChildren(5)  [조회 유형 선택 서브메뉴]
    MS->>DB: findMany(parentId=5)
    CQ->>MH: buildActionKeyboard(children, "서울")
    CQ-->>TG: "서울 — 어떤 정보를 조회할까요?" + 버튼 (action:{id}:서울)

    Note over TG,DB: 액션 버튼 탭 (action:{menuItemId}:{value})
    TG->>CQ: callback action:6:서울  (기온 조회)
    CQ->>MS: getMenuItemById(6)
    MS-->>CQ: actionValue = "{value}의 현재 기온을 알려줘"
    CQ->>CQ: substitute {value} → "서울의 현재 기온을 알려줘"
    CQ->>MH: processMessage(ctx, "서울의 현재 기온을 알려줘")
    MH->>LLM: chat() → temp_by_region tool 호출
    LLM-->>TG: "현재 서울의 기온은 20.5도 입니다."
```

## 11. MenuItem 데이터 모델

```mermaid
erDiagram
    MenuItem {
        Int id PK
        String label
        Int parentId FK
        Int sortOrder
        Boolean isActive
        String actionType
        String actionValue
        Int resultSubmenuId FK
        DateTime createdAt
        DateTime updatedAt
    }

    MenuItem ||--o{ MenuItem : "children (MenuTree)"
    MenuItem ||--o{ MenuItem : "resultSubmenuOf (ResultSubmenu)"
```

> `actionType` 값:
> - `submenu` — 자식 MenuItem을 키보드로 표시
> - `tool` — `actionValue` 파싱 후 LLM+툴 호출, 결과를 동적 버튼으로 표시
> - `prompt` — `actionValue`를 직접 processMessage에 전달
> - `action` — `{value}` 치환 후 processMessage에 전달 (동적 결과 탭 후 사용)
