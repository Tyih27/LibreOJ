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
  provide(name: string, value: unknown): void;             // 注册 service，随 scope 撤销
  get<T>(name: string): T;                                 // 缺失则抛错
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

- **Service 容器分层**：子 Context 查找 service 时沿父链向上查找；`provide` 的作用域限于本 Context。
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
  （`LIBREOJ_PATCH_FILE`）→ CLI `--patch` overlay。上层覆盖下层；`disabled: true` 移除条目。
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
