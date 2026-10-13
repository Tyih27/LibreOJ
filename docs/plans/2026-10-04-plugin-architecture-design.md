# LibreOJ 插件化架构设计

- 日期：2026-10-04
- 状态：已批准（进入 M1）
- 目标：把 LibreOJ 改造成"一切皆插件"的架构，开发体验对齐 DeepSeek Harness（dsh）

---

## 1. 背景与目标

LibreOJ 目前是一个 pnpm monorepo：NestJS 后端（`apps/backend`）、独立评测机（`apps/judge`）、Vite + React 前端
（`packages/frontend`）。后端与评测机的可扩展点（题目类型、代码语言、checker）都是**硬编码注册表**，新增能力必须改核心代码。

本次改造引入一套框架无关的插件内核，使 backend / judge / frontend 的能力都能以插件形式挂载、替换、卸载。

### dsh 参考模型

- 内核（对应 Cordis）只负责**加载 / 卸载**与**依赖关系**。
- 一切具体能力——模型、工具、会话、存储、UI——都是插件，通过 **service** 与 **event** 协作。
- **无特权内核**：扩展 = 把插件挂到别的插件旁边；注册都是副作用，随插件卸载撤销。
- **profile / bundle / patch**：启动时按序叠加各层，上层可覆盖下层；`dump-config` 打印真实生效的插件树。
- **能力 seam**：Service Definition + Service Provider + Consumer，换 Provider 即换能力。

## 2. 验收标准（"与 dsh 体验几乎一致"的定义）

1. **装插件不改核心**：在 profile 里列一个包 + 写配置即可启用，不碰核心代码、不重编核心。
2. **`dump-config` 可见**：打印完整插件树与生效配置，任意条目能被上层 patch 覆盖。
3. **注册即副作用**：卸载插件时，它登记的路由 / service / 事件 / checker 全部消失。
4. **换 Provider 换能力**：替换 `http` / `storage` / `checker` 的 Provider，产品行为随之改变，业务插件不动。
5. **多 profile**：`web` / `judge` / `dev` 等运行模式各加载不同插件集。
6. **无特权内核**：官方功能与第三方插件地位相同，不存在"必须打补丁的内核"。

## 3. 已确认决策

| 决策 | 结论 |
| --- | --- |
| 扩展范围 | 通用底座：backend + judge + frontend 都可作为插件挂载 |
| 信任模型 | 进程内、全权限、仅管理员安装（不做沙箱/能力门控） |
| 动态程度 | 遵循 dsh：启动期配置组装（profile/bundle/patch），不做运行时热插拔 |
| 后端形态 | 内核为唯一组合根；NestJS 降级为 `http` seam 的一个 Provider，终态移除 |
| 迁移策略 | 渐进：先立内核 + 示范插件，再逐域迁移，不一次性推翻 |
| 插件包位置 | 新建 `plugins/*` workspace（推荐默认，可改） |
| 前端 | **仅构建期**组装；不做运行时热插拔（runtime 前端插件需 module federation，超范围） |

## 4. 包与目录结构

```
packages/plugin-core     内核：Context / Service / Event / 生命周期 / 依赖 / 可撤销注册 / 配置分层 / dump-config
packages/plugin-api      seam 定义：Service Definition 接口（backend + judge 共享，**非** wire 类型）
plugins/*                官方插件包（bundle）：backend 功能、judge checker/language、前端模块
profiles/*.yaml          profile：base / web / judge / dev 等组装模板
```

- `packages/*`、`plugins/*` 由 `pnpm-workspace.yaml` 的 glob 自动纳入（`plugins/*` 需在首次创建时加入）。
- wire 类型仍只放 `packages/judge-protocol`，**不得**把运行时策略或 DB 实体挪进去，也不重复定义跨边界类型。
- 新增包后需同步根 `build` / `build:artifacts` 与 `.github/workflows/ci.yml` 的 native 路径列表（若涉及）。

## 5. 内核设计（`packages/plugin-core`）

框架无关、零运行时依赖（仅 `js-yaml` 用于 profile/dump-config），同时可被 CJS（backend/judge）与构建期前端使用。

### 5.1 插件定义

```ts
export interface PluginDefinition<TConfig = unknown> {
  name: string;                                   // 唯一 id，如 "@libreoj/http-nest"
  inject?: { required?: string[]; optional?: string[] };
  provide?: string[];                             // 本插件提供的 service 名
  config?: PluginConfigSchema<TConfig>;           // 可选：自身配置的校验/合并
  apply(ctx: Context, config: TConfig): void | Promise<void>;
  start?(ctx: Context, config: TConfig): void | Promise<void>; // 全部 load 完再跑
}
```

### 5.2 Context（插件运行时句柄）

```ts
export class Context {
  readonly parent: Context | null;
  readonly scope: string;                                  // 插件 id
  readonly config: Record<string, unknown>;                // 该插件生效配置
  plugin<T>(def: PluginDefinition<T>, config?: unknown): Scope;
  provide(name: string, value: unknown): void;             // 注册到根 ServiceScope（全局），撤销随本 Context
  get<T>(name: string): T;                                 // 从根 ServiceScope 解析；缺失则抛错
  tryGet<T>(name: string): T | undefined;
  has(name: string): boolean;
  inject(names: string[], cb: () => void | Disposable): void; // 依赖就绪时执行，变化时重跑
  on(event: string, listener: (...args: unknown[]) => void): Disposable;
  emit(event: string, ...args: unknown[]): void;           // 向父级冒泡
  effect(fn: () => void | Disposable): Disposable;         // 登记副作用
  registry<T>(namespace: string): ReversibleRegistry<T>;   // 可撤销键值注册表
  dispose(): Promise<void>;                                // LIFO 回滚全部登记
}
```

- **Service 为根作用域全局可见（对齐 Cordis）**：同一棵插件树共享一个 `ServiceScope`（由根 Context 拥有），
  任何插件 `provide` 的 service 同树内全局可解析，与树中位置/平级/顺序无关；`provide` 同名重复（同树内已有存活提供者）
  抛错。撤销登记在提供者 Context，提供者卸载即移除该 service 并触发依赖方重算。按子树隔离（Cordis 的 `isolate`）暂不实现。
  该语义由 Cordis 官方示例佐证：平级挂载的 `MyPlugin(inject:['database'])` 与 `DatabaseService` 可跨兄弟消费。
- **Event 总线分层**：`emit` 依次触发本 Context 及祖先的监听器；监听器随 Context 自动撤销。
- **可撤销注册**：`provide` / `on` / `effect` / `registry.set` / `plugin` 均返回或登记 disposer，`dispose` 时**逆序**执行。

### 5.3 生命周期与依赖

状态机：`pending → loading → active → disposing → disposed`（异常 → `error`）。

- 声明了 `inject.required` 的插件在依赖 service 全部就绪前保持 `pending`，不就绪则**不调用 `apply`**。
- 依赖 service 消失时，依赖方 scope 被 dispose；依赖重新就绪后**重新 apply**（Cordis 语义）。
- `apply` 抛错：标记 `error`，回滚本次全部登记；按宿主 `failureMode: "skip" | "fatal"` 决定继续或终止。
- `start()` 在所有插件 load 完成后按装载顺序调用，用于"登记齐了再统一启动"（如构建 HTTP 应用）。

### 5.4 配置分层与 dump-config

- **bundle**：一个插件包 = `package.json` 的 `libreoj` manifest（默认配置 + inject/provide + 入口）及其编译产物。
- **profile**（YAML）：

```yaml
name: web
extends: base                  # 可选，先应用被继承 profile
bundles:                       # 按序叠加
  - "@libreoj/http-nest"
  - "@libreoj/backend-user"
plugins:                       # 树外插件（本地路径或包名）
  - "./plugins/example"
config:                        # 各插件默认配置
  "@libreoj/backend-user": { allowRegistration: true }
patch:                         # 本 profile 的 patch 层
  "@libreoj/http-nest": { port: 8080 }
  "@libreoj/legacy": { disabled: true }
```

- **叠加顺序**：`extends` 链（base 在前）→ 本 profile 的 bundles → 本 profile 的 patch → 站点 patch 文件
  （`LIBREOJ_PATCH_FILE`）→ CLI `--patch` overlay。上层覆盖下层；`disabled: true` 将该插件标记为禁用
  （条目保留在解析结果中，便于 dump-config 报告与上层用 `disabled: false` 重新启用）。
- **解析结果**：有序的 `ResolvedPlugin[]`（name / source / config / disabled）+ 最终配置树。
- **`dump-config`**：把解析结果序列化为 YAML 打印，作为可观测性契约。
- **模块解析解耦**：内核通过注入的 `ModuleResolver`（name → `PluginDefinition`）加载插件，测试中用内存 resolver，
  真实环境用 `require.resolve` + `import()` 的 Node resolver。内核本身不依赖具体加载方式。

## 6. 三端接入

### 6.1 backend

- 内核是组合根；`plugin-api` 定义 `config` / `logger` / `http` / `database` / `redis` / `storage` / `mail` /
  `websocket` / 各领域注册表等 **Service Definition**。
- `plugins/backend-nest` = `http` 的第一个 Provider：收集各插件登记的 controller，在 `start()` 阶段
  `NestFactory.create` 动态组装 Nest 应用。
- 之后可新增 `plugins/backend-fastify` 作为替代 Provider——用于验证"换 Provider 换能力"，并最终移除 NestJS。
- 每个业务域（user / problem / submission / discussion …）逐步变成注入 `http` + `database` 的插件 bundle；
  领域事件（`submission.created` 等）走事件总线供插件订阅。
- 现有 `ProblemTypeFactoryService`、`CodeLanguageService` 变成 `problemTypeRegistry`、`codeLanguageRegistry` seam。

### 6.2 judge

- `index.ts` 改为建内核 + 载 `profiles/judge.yaml`。
- seam：`checkerRegistry` / `languageRegistry` / `taskTypeRegistry` / `sandbox` / `binaryCache` / `taskQueue` / `rpc`。
- 现有 `checkers/custom/*`（domjudge、hustoj、lemon、qduoj、testlib）与 `languages/*` 变成插件。
- `rpc` Provider 就绪后，任务消费者插件才启动（替代当前 `rpc.connect().then(startTaskConsumerThread)`）。

### 6.3 frontend（仅构建期）

- Vite 插件读同一份 profile + manifest，生成虚拟模块（路由、导航、首页组件、设置面板、文案、主题 token），
  前端核心消费这些注册表。
- `dump-config` 的等价物是构建期生成的 `plugins.manifest.json`。
- 明确不做运行时热插拔。

## 7. 错误处理与卸载

- 卸载顺序 = 装载顺序的逆序；同一 scope 内 disposer LIFO。
- 单个插件失败不必然致命：`failureMode: "skip"` 跳过并记日志，`"fatal"` 终止启动。
- 所有跨插件交互只经 service / event，禁止直接 import 另一插件内部实现。

## 8. 测试策略

- **单元测试**：内核生命周期、依赖解析/重载、可撤销注册、配置分层、dump-config golden。
- **集成测试**：用测试 profile 启动，断言启用/禁用插件时路由与 checker 的增删；换 Provider 后行为随之改变。
- 仓库当前无测试框架；M1 起用 **Node 内置 `node:test` + 已有的 `tsx`**，不引入 Jest/Vitest 等新框架。
- 每个改动区域按 AGENTS.md 校验表执行；`pnpm check` 必须保持绿。

## 9. 迁移路线

| 里程碑 | 内容 | 出口条件 |
| --- | --- | --- |
| **M1** | `packages/plugin-core` 内核 + 单测 + `dump-config` CLI | `pnpm check` 绿；内核测试全过；demo profile 能 dump |
| M2 | backend 经内核启动；`http` seam + NestJS Provider；迁移 1 个低风险模块 | 后端可启动、功能等价；插件可启用/禁用 |
| M3 | judge 内核化，迁移 checker / language | 评测行为等价；第三方 checker 可作为插件 |
| M4 | frontend 构建期组装，迁移首页/导航 | 构建产物含插件注册表 |
| M5 | 逐域迁移 backend 其余模块，删除硬编码注册表 | 无残留硬编码；seam 全覆盖 |
| M6 | 分发格式与 profile 模板文档 | 第三方可按文档新增插件 |

## 10. M1 实施计划（子 Agent 逐任务执行）

**范围**：只新增 `packages/plugin-core`，**不改任何 app**；`pnpm check` 保持绿。
**约定**：仿照 `packages/judge-protocol`（`tsc` build、`tsc --noEmit` check-types、prettier check-format，
ESLint 仅在 `apps/*` 使用）；测试用 `node:test` + `tsx`；所有 pnpm 命令前缀 `PNPM_CONFIG_PM_ON_FAIL=ignore`。

### 任务 M1-1：包脚手架 + 配置分层 + dump-config 序列化

- 新增 `packages/plugin-core/{package.json,tsconfig.json,.gitignore?}`，name `@libreoj/plugin-core`，private。
- 脚本：`build` = `tsc -p tsconfig.json`；`check-types` = `tsc --noEmit`；`check-format` / `format` = prettier；
  `test` = node:test + tsx。devDeps：`typescript`、`prettier`（catalog）、`tsx`、`@types/node`（与仓库一致）。
- 实现配置分层：`ConfigLayer` 合并、`extends` 链、bundle 顺序、`disabled`、深度 merge；产出 `ResolvedPlugin[]`。
- 实现 `dumpConfig(tree): string`（YAML）。
- **测试**：多层叠加、patch 覆盖、disabled 移除、extends 顺序、dump golden。
- **验收**：`pnpm --filter @libreoj/plugin-core test` 与 `build` 通过。

### 任务 M1-2：内核原语（Context / Service / Event / Registry / effect）

- 实现 `Context`：分层 service 容器、`provide/get/tryGet/has`、`on/emit` 冒泡、`effect`、`registry`、`dispose` LIFO。
- 实现 `ReversibleRegistry`（set 返回 disposer，支持 get/entries/onChange）。
- **测试**：service 继承与查找、emit 冒泡、dispose 逆序撤销、registry 撤销、重复 provide 行为。
- **验收**：测试通过、`check-types` 通过。

### 任务 M1-3：生命周期 + 依赖解析 + PluginHost + CLI

- 实现状态机与 `inject` 门控：required 依赖就绪才 `apply`；依赖消失则 dispose 依赖方，重就绪则重新 apply。
- 实现 `start()` 阶段、`failureMode`、错误回滚。
- 实现 `PluginHost`：接收 `ModuleResolver` + 分层配置，load / start / dispose / dumpConfig。
- 实现 Node `ModuleResolver`（`require.resolve` + `import()`，读 `package.json#libreoj` manifest）。
- 实现 `bin/dump-config` CLI：`dump-config <profile.yaml> [--patch <file>]` 打印 YAML。
- 提供 `fixtures/` 下的示例插件（内存或本地 manifest）驱动端到端 dump。
- **测试**：依赖顺序、缺失依赖挂起、依赖消失重载、失败回滚、端到端 dump-config。
- **验收**：全部测试通过；demo profile 能 dump 出预期树。

### 任务 M1-4：`packages/plugin-core/README.md`

- 说明内核概念、API、profile 格式、dump-config 用法；遵循 AGENTS.md 文档规则（描述现状，不写迁移史）。

**流程**：每个任务 = 实现子 Agent（TDD）→ 规格符合性审查子 Agent → 代码质量审查子 Agent；有问题由同一实现子 Agent
修复后复审，直至通过。所有子 Agent 必须使用 Realontext（`codebase-retrieval`）做代码检索。

## 11. 风险与开放项

- **工作量真实**：这是 backend + judge + 构建期前端的重构，故按里程碑渐进，每步可独立验证、可回退。
- **双概念并存期**（内核 vs NestJS）：靠"HTTP 是 seam"把 NestJS 圈在单个 Provider 内，避免长期双 DI。
- **构建流水线**：新增包后同步 `pnpm-workspace.yaml`、根构建脚本与 CI 路径列表。
- **开放项**：`plugins/*` 位置与"前端仅构建期"两项按推荐默认执行，如需调整请在 M2 前提出。

## 12. M1.5：与 dsh 对齐补强（P1–P4）

目标：在 M1 内核之上补齐 Cordis 的显性机制，使插件开发体验与结构更贴近 dsh。P5（`isolate`）延后。

### P1｜Cordis 风格 API 面
- 插件**两种形态**：函数 `type Plugin<C> = (ctx: Context, config: C) => void | Promise<void>`（可挂 `name`/`inject`/`provide`/`Config`/`start`）
  与现有对象 `PluginDefinition`；`normalizePlugin(input)` 统一为对象形态。
- `ctx.set(name, value)` 为注册服务主名（`provide` 保留为别名）；`ctx.get/tryGet/has` 不变。
- `ctx.plugin(input, config?)` → `Fiber`（含 `name`/`state`/`context`/`dispose()`），支持**运行期挂载/卸载**；装载子插件。
- `ctx.inject(deps, cb)`：deps 全部就绪时执行 `cb`，其登记的 effect 在 deps 变化时撤销并在重新就绪后重跑。
- `Service` 基类：`class Db extends Service { constructor(ctx){ super(ctx, "db") } }`，构造即 `ctx.set(name, this)`，随 ctx 撤销。

### P2｜依赖门控下沉内核（Fiber）
- 每个已挂载插件 = 一个 `Fiber`，状态 `pending → loading → active → disposing → disposed`（异常 `error`），由内核维护。
- 门控在内核：`inject.required` 未满足不 `apply`；满足后 active；依赖消失则 deactivate 回 pending；恢复后重新 apply。
- `PluginHost` 退化为 loader：`resolveConfig` → `ctx.plugin` 逐个挂载 → 等待 settle → 对 active 调 `start`；`failureMode` 与 dump-config 保留。
- 内核暴露 fiber 错误钩子，host 据此实现 `skip`/`fatal`。

### P3｜事件语义
- `ctx.on` 之外补 `ctx.once`、`ctx.before`、`ctx.after`；`emit` 支持 **bail**（监听器返回非 `undefined` 即中断并作为返回值）。
- 标准生命周期事件：`ready`（插件激活后）、`dispose`（卸载前）。

### P4｜配置层序完整化
- 层序与 dsh 一致：profile bundles → profile patch → **site/home patch（`LIBREOJ_PATCH_FILE`）** → CLI `--patch`（可多次叠加）。
- loader 与 CLI 走同一层序实现，避免两套。

### 验证
- 全量 156 项测试通过；已覆盖函数式插件、`ctx.plugin`/`ctx.inject`（含回调抛错经内核 error 钩子上报并在依赖
  变化后重试）、`Service`、Fiber 门控、运行期 service 变化触发 `start`（`FiberManager.onSettled`）与配置层序。
- 每个子任务仍走：实现（TDD）→ 规格审查 → 质量审查；子 Agent 必须使用 Realontext。

## 13. M1.6：补齐剩余差距（P5–P7、P9；P8 不做）

### P5｜`isolate` 隔离作用域（空间可组合性）
- `ctx.isolate(names: string | string[]): Context` 返回**新的隔离边界 Context**。
- 在 `iso` 及其后代内，对 `name ∈ names` 的 `set/get/has` 只作用于 `iso` 的隔离 scope：看不到外层同名注册，外层也看不到它；
  未列入 `names` 的名字仍走祖先（树级全局）。两个 isolate 即使平级也互不共享。
- 实现：`ServiceScope` 支持 **parent 链 + `isolated` 名字集**，`resolveScope(name)` 选择最近隔离该名字的作用域，否则回落到父/根。
- `onServiceChange` 的变更通知沿 scope 链**向上传播**（隔离内的变更能被祖先订阅者观察）。
- Fiber 门控按 fiber 所在 Context 的作用域解析（隔离内挂载的插件看到隔离服务）。
- `dispose` 隔离 Context 即移除其隔离服务与子树。

### P6｜运行期装卸插件
- `PluginHost.install(name, config?)`：运行时经 `NodeResolver` 解析并 `root.plugin` 挂载 → settle → 对 active 调 `start`。
- `PluginHost.uninstall(name)`：定位 fiber → `fiber.dispose()` → 移除记录 → settle（依赖方自动重算）。
- `PluginHost.reload(name)`：uninstall + install；`NodeResolver` 提供 **fresh 解析**（清除模块缓存）以支撑热更新。
- 说明：不实现文件监听式 HMR；提供的是可编程的运行期装卸原语。

### P7｜`NodeResolver` 支持 ESM 入口
- 识别 `package.json#type === "module"` 或 `.mjs` → 用**真正的动态 `import()`**（经 `new Function("s", "return import(s)")` 规避 TS 在 CommonJS 下对 `import()` 的降级）；
  否则走 `require`。补 ESM fixture 与测试。

### P9｜`inject.optional` 真实语义
- optional 依赖**不门控激活**；其出现/消失应能被观察，并使插件内 `ctx.inject([...], cb)` 按服务变化重跑。
- Fiber 暴露 optional 依赖的当前可用状态（供诊断/dump）。

### P8｜Service 拦截 / trait：明确不做
- Cordis 的 Service trait/方法拦截对本项目无实际需要（我们的服务是普通对象，消费者直接调用即可）；
  明确标记为**不做**并在此说明理由，避免为对齐而引入无收益的复杂度。

### 出口条件
- 既有 156 项测试保持通过；新增覆盖 isolate 可见性/隔离/传播、运行期 install/uninstall/reload、ESM fixture、optional 语义。
- build / check-types / check-format 全绿；`dump-config` 端到端仍正确。

## 14. 后端数据格式导入 seam（D1 起）与明确不做项

### 14.1 数据格式导入 seam
- 背景：题目测试数据的"格式识别"原先硬编码在 `problem-type/common/auto-match-input-output.ts`（只认 `.in`↔`.out`/`.ans`），
  由三种题型的 `preprocessJudgeInfo` 在 `judgeInfo.subtasks` 未显式给出时调用。
- seam：`problemDataImporters`（backend 本地，契约复用 backend 类型），
  `ProblemDataImporter { name, priority?, detect(testData, ctx), import(testData, ctx) -> ProblemDataSubtask[] }`
  + `ProblemDataImporterRegistry { importers, resolve(testData, ctx) }`。
- Provider：`@libreoj/backend-problem-data-import` 注册内置 `libreoj-native`（逐字封装既有 auto-match 逻辑，最低优先级作为回退）。
- 消费者：三种题型的 `preprocessJudgeInfo` 改为经 `getProblemDataImporters().resolve(...).import(...)`。
- **子任务保持绑定**：subtasks 仍由导入器/题型产出并校验，不单独拆出评分 seam。
- 后续（逐个小步）：D2 起新增格式 importer（如 `subtasks.json` 配置格式、Lemon/HUSTOJ/domjudge 命名约定），每个一个插件。

#### D2b（已实现）：UOJ 风格数据配置 importer
- 配置文件：测试数据根下的 `subtasks.json`(JSON) 或 `data.yml`/`data.yaml`(UOJ 原 YAML)，按扩展名选解析器。
- 对齐 UOJ `data.yml` 并扩展：`subtasks[{ score, type: sum|mul|min, cases[] , testcases[]? }]`、`inputFile`/`outputFile`/`userOutput` 模板（`#`→caseId）、
  `specialJudge{ language, fileName, interface? }`（interface 默认 `testlib`）、`interactor{ language, fileName, interface? }`（默认 `stdio`）、
  `extraSourceFiles[{ language, files[{name,dest}] }]`；扩展支持显式 testcases、逐点/逐子任务 points 与 time/memory。
- importer 契约升级为返回**部分 judgeInfo**（`subtasks`/`checker`/`interactor`/`extraSourceFiles`）；`authoritative: true` 表示**结果覆盖** judgeInfo（P1），
  内置 `native` 为 `authoritative: false`（仅在 `judgeInfo.subtasks` 非数组时填充 subtasks，保持旧行为）。
- 语言名映射复用抽取出的 `getLanguageAndOptions`（原在迁移代码，现移入 `problem-data-import/legacy-language-options.ts`，迁移行为不变）。
- **内容来源**：配置文件内容在对象存储；`ProblemService.getProblemPreprocessedJudgeInfo`（async、带缓存）在调用同步的 `preprocessJudgeInfo` 前，
  经 `FileService.getFileContent(uuid)` 把配置内容载入 `ProblemFileEntity.content`（读取失败只告警 → 回退 native）。
- 坏配置**直接报错**（不回退），并在 importer 内校验被引用文件存在。judge 侧**无需改动**（产出的 judgeInfo 字段与现有契约一致）。
- 测试：`apps/backend/test/problem-data-import.test.ts`（`node:test` + `tsx`）。

#### A（已实现）：spj 接口按源文件内容自动识别
- 当配置未显式给出 `specialJudge.interface` 时，importer 读 spj **源文件**判定：C++ 且含 `testlib.h` → `testlib`，否则 `legacy`
  （与 `migration/migrations/problem.ts` 一致）；显式 `interface` 原样使用；源未加载 → 回退旧默认 `testlib`。
- `ProblemDataImporter` 新增**可选** `contentFilenames?(testData)`，让驱动按需加载源文件；`ProblemService.loadProblemDataContents`
  先读配置文件，再读各 importer 请求的文件。
- **不变量**：UOJ 配置的 schema/解析/校验/输出不变，无需改任何 UOJ 数据；唯一行为差异 = C++ 无 `testlib.h` 的 spj 标签由 `testlib` 纠正为 `legacy`。

#### D3（已实现）：Codeforces Polygon 命名约定 importer
- 约定：输入按序号、**无扩展名**（`1`、`2`、`10`…），答案为同名 + `.a`（`1.a`…）；与 native（`X.in`↔`X.out`/`X.ans`）不重叠。
- `@libreoj/backend-*` 注册：`@codeforces-polygon`（`priority: 50`、`authoritative: false`，仅 `traditional`）排在 `uoj-data-config`(100) 与 `libreoj-native`(-1000) 之间。
- 子目录类布局（DOMjudge/Polygon `tests/` 目录等）**不做**：测试数据文件名不能含 `/`。

#### D4（已实现）：归档导入（zip → testdata，整体替换）
- 后端端点 `POST /api/problem/importProblemTestDataArchive`：**复用 presigned 上传**（`uploadInfo.uuid` 为空拿签名 → 上传 zip → 再回调带 uuid）。
- **目录处理**：剥离**单一公共顶层目录**，其余嵌套路径**拍平**（`/`→`_`）；`..`/非法/空名/同名冲突 → 报错（纯规划器 `problem-data-import/archive.ts`，有单测）。
- **覆盖语义：整体替换（B）**——校验全部通过后**清空该题全部 TestData**，再落地归档文件；**校验先于清空**，空归档/仅目录归档 → `INVALID_ARCHIVE`（不破坏数据）。
- 限额：`resourceLimit.problemTestdataFiles`/`problemTestdataSize`（单条未解压 + 合计），特权用户 `noLimit`。**失败尽力清理**（非强事务）。
- **前端已实现**：`ProblemFilesPage` 的测试数据表页脚新增「导入数据包」按钮（`FileTable` 的 `onImportArchive`）：选 `.zip` → 破坏性确认（提示将替换全部测试数据）→ `callApiWithFileUpload` → 导入成功后重新拉取 testdata 刷新列表。API 客户端经 `generate-api` 从后端 Swagger 重新生成。

### 14.2 明确不做（后置）
- **problem-type 整体插件化**（把三种题型做成 `problemTypeRegistry` 的插件，加题型=加插件）：**暂不做**。
  原因：`ProblemTypeServiceInterface` 依赖 backend 实体（`ProblemFileEntity`/`FileEntity`）与领域接口
  （`ProblemJudgeInfo`/`SubmissionContent`/`SubmissionProgress`），且被 `problem`/`submission`/`migration` 广泛消费，
  属中等偏大改造；`problemType` 存库、前端认这几型，插件化后须保证内置三型默认启用。将来若需要再单独立项。
- **judge 侧 `subtaskScoring` 独立 seam**：**不做**。子任务评分/聚集保持随题型与导入器。

## 15. 上游 UOJ（problem.conf）判题与数据兼容（U1–U4）

### 15.0 背景与总决策
- **本机存在真实上游 UOJ 实例**：`~/HHHOJ`（基于 Universal Online Judge 的迁移版）。题目数据在
  `uoj_data/web/data/{pid}/problem.conf` + 数据文件（`input*`/`output*`、`ex_input*`、`std.cpp`/`val.cpp`）；
  judge 源码在 `judger/uoj_judger/`（C++；`main_judger` + `run_program` 沙箱，**ptrace + rlimit，不依赖 cgroup**）。
- **命名澄清**：LibreOJ 现有的 `uoj-config` importer 读的是**旧 LibreOJ 血统的 `data.yml`**
  （`subtasks[{score,type,cases}]` + `inputFile/outputFile` 的 `#` 模板），**不是**上游 UOJ 的 `problem.conf`。两者格式不同。
- **总决策（用户已拍板）**：**不引入第二套 judge**（不做协议级双 judge）。改为：
  1. **完善 LOJ 的 judgeInfo 字段**（补 UOJ 有、LOJ 无的项）；
  2. **新增 UOJ `problem.conf` 解析 importer 插件**（数据格式靠 importer registry **自动识别**）；
  3. **移植 UOJ 内建 checker**。
  判题仍走 LOJ 引擎；因为是"数据 → 现有 judgeInfo"，所以**题目无需存"判题后端"字段**，autodetect 即可。

### 15.1 `problem.conf` schema（本机 8 题实测）
逐行 `key value…`，出现的键：`n_tests`、`n_ex_tests`、`n_sample_tests`、`input_pre`、`input_suf`、
`output_pre`、`output_suf`、`time_limit`、`memory_limit`、`output_limit`、`use_builtin_judger`、
`use_builtin_checker`、`n_subtasks`、`subtask_end_i`、`subtask_score_i`。
- **文件名模板（逐字对齐 UOJ `uoj-judger-lib.php`）**：
  `input = ${input_pre|input}${num}.${input_suf|txt}`；`output = ${output_pre|output}${num}.${output_suf|txt}`；
  额外测试加前缀 `ex_`。
- **单位**：`time_limit` 为**秒**（UOJ judger `floor(sec*1000+0.5)` 转 ms）；LOJ `timeLimit` 是 **ms** → ×1000 四舍五入。
  `memory_limit`/`output_limit` 为 MB。

### 15.2 U1 — UOJ `problem.conf` importer（数据层，先做）
- **目标**：识别 `problem.conf`，映射为 LOJ judgeInfo（子任务、时间/内存、checker 名），纯加法、零核心改动。
- **归属**：backend，新增 `apps/backend/src/problem-data-import/uoj-problem-conf.ts`；`priority 200`（高于 `uoj-config` 100）、
  `authoritative: true`；`detect` = 有 `problem.conf`；`contentFilenames` = `["problem.conf"]`。
- **映射**：`n_tests`+模板 → `testcases`；`n_subtasks`+`subtask_end_i`+`subtask_score_i` → `subtasks`
  （`scoringType:"Sum"`、`points=score`；**无子任务 → 单个 Sum(100)**）；`time_limit`→`timeLimit`(ms)；
  `memory_limit`→`memoryLimit`；`use_builtin_checker`→`checker`（依赖 U2）；`output_limit`→`outputLimit`（U2 新字段）。
- **校验**：被引用文件必须存在；`problem.conf`、`ex_*` 不进入 testcases；`subtask_end_i` 递增且 ≤ `n_tests`；score 合计 ≤100。
- **验证**：纯函数单测 + 真机导入 `~/HHHOJ/uoj_data/web/data/*`。
  **已实现**：`uoj-problem-conf.ts`（`priority 200`、authoritative、`contentFilenames=["problem.conf"]`），注册在 `uoj-config` 之前；
  `ProblemDataImportResult` 增 `timeLimit/memoryLimit/outputLimit`，三题型 preprocess 按需 merge。**已用真实数据核对**：
  pid=1 → 单 Sum 子任务/10 点/`input1.txt`/1000ms/`ncmp`；pid=2 → 6 子任务 points `[10,10,20,20,10,30]`/`dream1.in`/2000ms；pid=5 → `death*.in`/`wcmp`。
  额外测试（`ex_*`）与样例（`n_sample_tests`）**U1 仅校验存在**，语义留 U3。

### 15.3 U2 — 判题补齐（`outputLimit` + 19 个 UOJ checker）
- **目标**：让 LOJ 判题语义覆盖 UOJ。
- **`outputLimit`**：judgeInfo 新增每题输出上限（UOJ `output_limit`，MiB），并在 judge 侧生效（LOJ 现仅有全局 `judge.limit.outputSize`）。
  **已实现（提交 7e597f06 起）**：traditional / submit-answer 改为"每题优先、回退全局"；**interaction 暂不生效**——
  LOJ 的交互沙箱对管道输出无字节上限，要实现需在 judge 内加中继（改动 用户→交互器 数据路径），风险高且本机无法真机验证，
  故维持原行为（未设时不限制）。未设 `outputLimit` 时**所有题型行为不变**。
- **19 个 UOJ 内建 checker（全部搬入，用户要求）**，均为 testlib 实现：
  `acmp bcmp caseicmp casencmp casewcmp dcmp fcmp hcmp icmp lcmp ncmp rcmp rcmp4 rcmp6 rcmp9 rncmp uncmp wcmp yesno`
  （语义见 UOJ `builtin/checker/*.cpp` 的 `setName`）。注意 **`ncmp` 与 LOJ `integers` 算法逐字相同**，`rcmp4/6/9`=浮点容差 1e-5/7/10 等。
- **表示法（已定 B）**：LOJ `Checker` 是**判别联合**且在 backend/judge/frontend/wire 各处镜像；19 个 checker 采用
  **B**：新增**一个**通用变体 `{ type: "testlib", name: <19 名之一> }`，由 judge/原生层**按名 dispatch**（改动小、易扩）。
  现有 4 个（`integers/floats/lines/binary`）保留不变。

### 15.4 U3 — 额外测试与样例（`n_ex_tests` / `n_sample_tests`）
- **目标**：建模 UOJ 的额外测试与样例：`ex_input1..M`（+ `ex_output1..M`），`M=n_ex_tests`；
  **前 `n_sample_tests` 个即样例**（约束 `n_sample_tests ≤ n_ex_tests`）。
- U1 仅**识别/校验**这些文件存在；**语义（是否参与评分/校验、样例如何展示）留 U3** 单独定。
  **已实现（U3）**：在**归档导入**时（仅当含 `problem.conf`）把前 `n_sample_tests` 个 `ex_*` 的内容写为**题面样例**（覆盖；`buildUojSamples` 纯函数，真实数据已核对），
  `ex_*` 文件仍作为 TestData 保留（= hack 数据）。非 UOJ 包不动样例；样例写入**非致命**（失败仅告警）。
  **更正**：U3 曾记“`ex_*` 不参与评分（UOJ 亦然）”**有误**——UOJ `ordinary_test()` 在 `n_tests` 全过后会跑 `ex_*` 作为**闸门**，任一失败则
  `tot_score = 100 - 3 = 97` 并立即结束（见 `uoj_judger/builtin/judger/judger.cpp`）。该闸门在 **U4-b** 补齐（见 15.5）。
  局限：样例仅在题面 section 引用时显示；题面导入不在本轮。

### 15.5 U4 — Hack（大功能，单独立项）
- **目标**：实现 UOJ 的 Hack（用户提交测试，检验目标提交/标准解）。
- **前置/依赖**：题目需 `hackable` 且数据含 **`std.cpp`** + **`val.cpp`**（实测 pid=1 有，其余没有）。
- **范围**：`hacks` 表 + `problem.hackable`；backend hack 流程/权限/可见性/审计；judge **hack 判题任务**（编译 std+val、校验输入、跑 std、判目标提交）；
  前端 hack 提交/列表/详情页。**实施前先派子 Agent 侦察 UOJ hack 判题流程/DB/权限，再出详细方案。**
  **U4-a 进度**：① 协议+backend **已完成**（`judge-protocol` 加 `JudgeTaskType.Hack` + `HackTaskExtraInfo`；backend 新增 `hack` 模块：
  `HackEntity`、`problem.hackable`（管理员端点 `problem/setProblemHackable`）、`HackService` 注册 hack 任务入 `judge-queue`、`hack/createHack|queryHacks|getHack`、
  权限=管理员或有该题 AC；输入复用 presigned 上传）；② judge `task/hack` **已完成**（下载 testdata+输入，编译 `val.cpp`/`std.cpp`/被 hack 提交，
  跑 val（非 0=无效输入）→ 跑 std 得答案 → 跑提交 → 用题目 checker 比对，`success = 分数!=100`；提交编译失败/RE/TLE/MLE/OLE 亦算成功；进度 `Running`/`Finished` 回写）。
  **U4-a 完成（提交 6f803beb + 本次）**。
  **U4-b 已完成（额外测试闸门 + 成功追加 + 重判，与 UOJ 对齐）**：
  ① 判题补齐**额外测试闸门**——judgeInfo 新增 `extraTests`，由 `uoj-problem-conf` 按 testdata 中**实际存在**的 `ex_*` 对枚举（故 hack 追加的文件自动生效，无需改写 `problem.conf`）；
  traditional 判题在子任务全过后逐条跑额外测试，任一失败 → 最终状态取其失败态、分数 **97**（UOJ `100-3`），否则不变；结果经 `SubmissionProgress.extraTests` 回传并在提交页**单独一栏**展示。
  ② **成功追加 + 重判**——judge 成功时向后端 `requestUploadUrl` 取预签名 PUT（`JudgeUploadRequest`，避免新增 form-data 依赖），把 `std.cpp` 输出直传对象存储，并在 `Finished` 进度带 `stdOutputUuid`；
  后端 `HackService.onTaskProgress` 成功后 `processJudgeUploadedFile` 登记文件 → `ProblemService.appendHackExtraTest` 以 `ex_input<n>`（复用 `hack.inputUuid`）/`ex_output<n>`（新上传）写入 TestData 并清预处理缓存 → `SubmissionService.rejudgeProblemAcceptedSubmissions` 重测该题所有 `score=100` 提交 → 审计 `hack.apply_extra_test`。仅含 `problem.conf` 的题可追加（余者仅告警），与 UOJ `dataAddExtraTest` 一致。
  语义：`hack.success=1` ⟺ 被 hack 提交在 hack 输入上判错（hack 成功）。**无法本机端到端验证**（编译 std/val 需编译器 rootfs）。
  **U4-c 已完成（前端 hack 界面）**：
  ① 后端补强——`HackEntity` 加 `ownerId`（被 hack 提交的提交者）；`queryHacks` 加 `ownerId` / `status` 过滤；`HackMetaDto` 扩充 `ownerId` + `hacker`/`owner`/`problem`/`problemTitle`（`getHackMetaWithRelations`）；`getHack` 暴露 `details`；提交详情加 `permissionHack`；修正 `hack-meta.dto.ts` 里**写反的 `success` 注释**。全局列出权限：按题需 View，否则限本人（hacker/owner）或有 `ManageProblem` 权限。
  ② **重新生成前端 API 客户端**（起 dev 容器 + 后端 → `generate-api`），新增 `api.hack.*`、`problem.setProblemHackable`、`problem.meta.hackable`、`permissionHack`。
  ③ 前端——提交页「Hack」按钮 + 上传输入对话框（复用 `callApiWithFileUpload`）、该提交的 Hack 列表；独立 **Hack 详情页 `/h/:id`**（含元信息、输入下载、判题进度轮询、判题详情）；**全局 `/hacks` 页**（problemId/submissionId/status 过滤 + 「我发起的」/「针对我的」+ 非管理员无过滤时回退到本人）；题目页 Hack 列表；题目文件页 **hackable 开关**。文案 en-US/zh-CN/ja-JP（新 `hack` 命名空间）。
  **已本机冒烟验证**：`hack/*` 与 `setProblemHackable` 路由可达、未登录返回 `PERMISSION_DENIED`/`NO_SUCH_HACK`；`getHack` 助手匿名（公开题）返回带 `hacker`/`owner`/`problem`/`problemTitle` 的富 meta；`ownerId` 列由 `synchronize` 建出。

### 15.6 明确不做 / 后置（本轮）
- **第二套 judge**（UOJ 原版 judge / 协议级双 judge）：**不做**（用户已改选"补字段+解析"路线）。
- `use_builtin_judger off`（自定义 judger 程序）：U1 不支持（本机 8 题均为 `on`），需要时再立项。
- UOJ 交互题（`interaction_mode` + `interactor.cpp`）：本机数据无，暂不做。
- **子目录类布局 / AdditionalFile 归档导入**：沿用 §14 的结论（文件名不能含 `/`；归档导入仅 TestData）。
- Hack 全局列表**无分页**（最多 `MAX_QUERY_HACKS=100` 条）与**无按用户名筛选**（仅按 id/status）——需要时再补。

### 15.7 决策登记
- **已定**：走"补字段 + UOJ importer + 移植 checker"（不做双 judge）；**19 个 checker 全部搬入**；`output_limit` 与 U2 一起做；**要做 hack**；**checker 表示法选 B**（`{type:"testlib", name}`）。
- **待定**：`use_builtin_judger off` 是否支持。
- **已定（U4-b）**：额外测试作为**闸门**参与判题，失败分数 **97**（UOJ 原样）；额外测试结果在提交页**单独一栏**展示；judge 成功后**向后端索取**上传地址再直传 std 输出。
- **已定（U4-c）**：范围含**全局 `/hacks` 页**与题目页列表；Hack 详情页**展示判题详情**（故后端 `getHack` 暴露 `details`）；`hackable` 开关放在**题目文件页**。
- **实施顺序**：U2 的 checker 契约（变体 B）是 U1 importer 的前置（importer 要产出 `{type:"testlib",name}`），故**先落 U2 的 checker 契约+19 个实现**，再做 U1 importer。

## 16. M5 逐域迁移（后端插件化）

- 日期：2026-10-13 立项
- 对应 §9 路线表 **M5**（"逐域迁移 backend 其余模块，删除硬编码注册表"）。

### 16.0 目标与决策登记（已拍板）
- **目标**：把 `apps/backend` 的业务域逐个变成内核插件，`AppModule.imports` 的硬编码逐域消失；达成验收标准 §2 的 1/2/3/5/6
  （装插件不改核心 / `dump-config` 可见 / 卸载即撤销 / 多 profile / 无特权内核）。
- **迁移形态 = 组合级插件化**：每个域由一个插件把它的 **Nest 模块**（及其拥有的注册表 seam）登记到内核；域的实现代码**暂留** `apps/backend/src/<域>`
  （跨域 TypeORM 实体关系与循环依赖过多，实现级搬家不在本轮）。
- **Nest 终态 = 移除**：本轮**不做**，单列为后续里程碑 **M7**（见 16.7）；M5 的 seam 契约与域边界必须**不阻碍**它。
- **M5.1 试点 = `homepage`**（真实域：1 controller、无 entity、依赖 5 个域）。
- **M5.0 = http seam 支持"插件贡献模块" + 后端 profile 化**。

### 16.1 硬约束（每一步都必须保持）
1. **Swagger 不破**：`/docs-json` 是前端 `scripts/generate-api.js` 的**唯一来源**；迁移后路由与 OpenAPI 必须等价。
2. **请求管线不变**：全局 `ValidationPipe(transform, whitelist, forbidNonWhitelisted)`、`ErrorFilter`/`RecaptchaFilter`、
   `AuthMiddleware`、`MetricsMiddleware`、限流、`setGlobalPrefix("api")`。
3. **TypeORM 不变**：实体注册与 `synchronize: true` 行为不变（组合级不迁移实体）。
4. **环依赖共存**：域间存在环（`user↔auth`、`problem↔submission`、`user→submission→problem→user`），故无纯拓扑序；
   迁移期"已迁移插件"与"残留 Nest 代码"必须**共享同一批 Nest 单例**（infra seam 已把 config/db/redis/lock/storage/mail 登记进内核，正是为此）。

### 16.2 现状（侦察摘要）
- 组合根已是内核，但 **Nest 模块图静态**：`main.ts` 用 `InlineResolver` 硬编码 4 个 bundle（http-nest/infra/problemDataImporters/code-language）
  并以 `rootModule: AppModule` 交给 http provider；`AppModule.imports` 硬编码 21 个域模块；后端**没有 profile 文件、不走 dump-config**。
- `HttpNestServer` 只支持 `route(method,path,handler)` + `use(middleware)`，**不支持插件贡献 Nest 模块/controller**。→ 直接改裸 handler 会丢
  DI/校验/鉴权/Swagger，因此必须扩展 seam。
- 后端内部插件位置既定：`apps/backend/src/plugin/`（依赖后端类型的，如 `problemDataImporters`）；`plugins/*` 只放无后端依赖的能力插件（如 `code-language`）。
- **M2 样板只迁移过"能力注册表"**（`code-language`：无依赖自包含能力 → `plugins/*`，后端留 `@Inject(SEAM)` 薄适配器）；**从未迁移带 controller 的业务域**。

### 16.3 M5.0 地基（已实现，2026-10-13）
- **M5.0-a｜后端 profile 化**（已实现，对齐 judge 的 `apps/judge/src/index.ts` 写法）：
  新增 `profiles/backend.yaml` 列出 bundle 与顺序（`backend-domain-modules` 居首）；`main.ts` 改走
  `composeLayers({ profile, homePatchFile: process.env.LIBREOJ_PATCH_FILE })`，profile 路径可用 `LIBREOJ_BACKEND_PROFILE` 覆盖。
  bundle **定义**仍在 `main.ts` 的 `InlineResolver`（http-nest 需要运行时 options：Nest runtime、configureApp、listen 门控），profile 只决定**顺序与启停**。
- **M5.0-b｜http seam 支持"插件贡献 Nest 模块"**（已实现）：
  - 后端内部新增 seam **`BACKEND_DOMAIN_MODULES`**（`apps/backend/src/plugin/domain-modules.plugin.ts` 的 `provide`，实现为插入有序的 `Set`）；
    域插件在 `apply` 时登记 `ctx.effect(() => modules.add(SomeModule))`（`add` 返回的 remover 即 effect 的 disposer）。类型访问器 `getBackendDomainModules()`。
  - `HttpNestOptions` 用**两个显式字段**而非"值或工厂"的联合类型——Nest 模块本身是 class（＝函数），联合类型在不借助启发式的前提下无法与工厂区分：
    `rootModule?: unknown`（静态值）与 `rootModuleFactory?: () => unknown | Promise<unknown>`（在 `start` 阶段求值，优先）；二者皆缺则 `createApplication` 报错。
    `main.ts` 传 `rootModuleFactory: () => ({ module: AppModule, imports: getBackendDomainModules().list() })`。
  - **已核实（读 `@nestjs/core` 源码，2026-10-13）**：`DependenciesScanner.scanForModules` 对 DynamicModule 取
    `reflectMetadata(IMPORTS, dyn.module) ++ (dyn.imports ?? [])`（`@nestjs/core/scanner.js:43-47`），且 `container.addModule`
    以 `dyn.module`（类）为 token → **`imports` 是叠加（merge），且 AppModule 单例身份保留**。故
    `NestFactory.create({ module: AppModule, imports: [...域模块] })` 可直接用，未迁移域行为不变。
- **出口（已验证）**：`plugin-http-nest`（build / check-types / test 15/15 / check-format）与 backend（check-types / lint / check-format / test 68/68）全绿；
  真机启动成功——证明 profile 路径解析正确、生产路径走的就是 `rootModuleFactory`，且空贡献下模块图与 OpenAPI 与改动前一致（21 个模块、93 条路径）。
  `apps/backend/test/backend-profile.test.ts` 断言 profile 的 bundle 顺序且 `resolveConfig` 无警告。
- **已知限制**：通用 `dump-config` CLI 用 `NodeResolver` 按包名解析，**解析不了后端内部 bundle**（`@libreoj/backend-domain-modules` 等非包名）与
  `createHttpNestPlugin(options)` 工厂，故 `dump-config profiles/backend.yaml` 目前报 "Cannot resolve plugin …"。后端可 dump 需一个复用同一 `InlineResolver` 的后端专用入口，**留到后续**；本轮以 profile 解析测试替代。

### 16.4 M5.1 试点（`homepage`，已实现，2026-10-13）
- 新增 `apps/backend/src/plugin/domains/homepage.plugin.ts`（`@libreoj/backend-domain-homepage`，`inject.required=[BACKEND_DOMAIN_MODULES]`，
  `apply` 里 `ctx.effect(() => modules.add(HomepageModule))`）；从 `AppModule.imports` 移除 `HomepageModule`；
  加入 `profiles/backend.yaml`（列在基础设施 bundle 之后）与 `main.ts` 的 `InlineResolver` 映射。**未改动 `src/homepage/` 任何代码**（组合级插件化）。
  这也验证了 `app.get(HomepageService)`（`migration/migrations/discussion.ts`）在同根模块图下仍可用。
- **出口（已验证）**：
  - 正常启动：OpenAPI **93 条路径**（与 M5.0 基线一致），`/api/homepage/*` 3 条齐全，`GET /api/homepage/getHomepage` 返回 **400**（缺参数，非 404 → 路由已注册）。
  - `backend-profile.test.ts` 断言新顺序且无警告；backend `check-types`/`lint`/`check-format`/`test` 68/68 全绿。
  - **禁用即卸载（端到端）**：以 `LIBREOJ_PATCH_FILE` 传 `patch: {"@libreoj/backend-domain-homepage": {disabled: true}}` 重启后，
    OpenAPI 降为 **90 条**（正好少 3 条 homepage）、`/api/homepage/*` 全部 **404**，而 `POST /api/problem/getProblem` 仍 **201**——证明"域的可变性"名副其实。

### 16.5 M5.2…n 逐域迁移（分层顺序）
- **叶**（无域依赖）：`audit` `file` `mail` `metrics` `settings` `cluster` `config` `cors` `event-report` `localized-content` `permission`
- **中**：`group` `problem-type`（注册表 seam）`user`/`auth` `discussion`
- **重**：`problem` `submission` `judge` `hack`（`homepage` 已在 M5.1）`migration`
- 每域一个插件；每步都要求功能等价（`pnpm check` + `test` + Swagger 等价 + 真机冒烟）。

**统一范式（M5.2 起）**：`apps/backend/src/plugin/domains/define-domain-plugin.ts` 的
`defineDomainPlugin(name, module)` 承载"require 注册表 + `ctx.effect` 登记模块"的样板；每个域插件退化为一行
`export const xPlugin = defineDomainPlugin("@libreoj/backend-domain-x", XModule)`。homepage 已回收到该范式。

**进度**：
- ✅ `homepage`（M5.1）、`audit`、`file`（M5.2，2026-10-13）。`audit` 原来并不在 `AppModule.imports`（仅经其它模块间接可达），本次将其显式纳入插件图；`file` 从 `AppModule.imports` 移除。
- **注意（与 M5.1 的差别）**：`audit`/`file` 被 `user`/`problem`/`submission`/`hack`/`judge`/`group`/`migration`/`auth`/`discussion` 等大量模块直接 `import`，
  因此**禁用它们的 bundle 不会让它们从图中消失**（仍被别的模块带入）——对这类共享叶域，"插件化"是**注册点归一**（`AppModule.imports` 变小），
  而非 M5.1 那种"可从 profile 真正卸载"。真正可卸载的前提是**没有别的模块直接 import 它**；`homepage` 满足，故能验证禁用。
- 验证（M5.2）：真机启动成功（`failureMode: fatal` 下 = 模块图全解析），OpenAPI 仍 **93 条**（`audit`/`file` 本就无路由），
  `POST /api/user/queryAuditLogs`（用 `AuditService`）与 `POST /api/problem/downloadProblemFiles`（用 `FileService`）均返回 **400**（参数校验，非 500 ⇒ 服务已解析）。

### 16.6 M5.final 收口
- `AppModule.imports` 清空（仅剩 core：`AppController`/`AppService`/filter/中间件）；`AppModule` 退役为 core 模块；残留硬编码注册表清零。

### 16.7 后续（不在 M5 内）
- **M7｜终态移除 Nest**（§3 已定终态）：新增非 Nest 的 `http` provider，把域插件的端点在 **provider 无关**的形式下重述，
  OpenAPI 改由 provider 无关的路由元数据生成（或另立 OpenAPI seam）。M5 **只保证不阻碍**它，不执行。
