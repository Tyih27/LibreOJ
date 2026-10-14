# 插件作者指南

本文从零讲清怎么给 LibreOJ 加一个插件：写什么、接在哪、怎么验证。分发格式的字段细节见
[distribution-format.md](distribution-format.md)；profile 怎么组织见 [profiles.md](profiles.md)。

## 前置

- Node.js 24 + pnpm 11.13.0（与仓库一致）。
- 一个可作为 workspace 成员的包目录，或在 `node_modules` 里可解析的包。
- 建议构建为 CommonJS（能被 `require` 同步加载，且支持 `fresh` 重载）。

仓库内的完整示例：[`examples/plugin-example`](../../examples/plugin-example)。

## 从零到跑起来

### 1. 建包

在 `plugins/`（官方）或 `examples/`（示例/第三方风格）下建目录，包名不要占用 `@libreoj/*`：

```
examples/plugin-example/
  package.json
  tsconfig.json
  tsconfig.build.json
  src/index.ts
  src/index.test.ts
  profile.example.yaml
  README.md
```

### 2. 写 `package.json`

声明入口与默认配置，并把 `@libreoj/plugin-core` 列为依赖：

```jsonc
{
  "name": "libreoj-plugin-example",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "libreoj": {
    "entry": "dist/index.js",
    "config": { "greeting": "hello from libreoj-plugin-example" }
  },
  "scripts": {
    "build": "rm -rf dist && tsc -p tsconfig.build.json",
    "check-types": "tsc --noEmit -p tsconfig.json",
    "test": "pnpm build && tsx --test src/*.test.ts"
  },
  "dependencies": { "@libreoj/plugin-core": "workspace:*" }
}
```

### 3. 写插件定义

`src/index.ts` 导出一个 `PluginDefinition`：

```ts
import type { PluginDefinition } from "@libreoj/plugin-core";

export interface ExampleConfig {
  greeting?: string;
}

export const plugin: PluginDefinition<ExampleConfig> = {
  name: "libreoj-plugin-example",
  // 声明本插件读写的 service 名（诊断用；真正注册在 apply 内）
  provide: ["exampleGreeting"],
  config: {
    // 低于 profile 的 config / patch，高于 manifest 的 libreoj.config
    defaults: { greeting: "hello from libreoj-plugin-example" }
  },
  apply(ctx, config) {
    ctx.provide("exampleGreeting", String(config.greeting));
  }
};
```

- `apply` 里登记的一切都会在插件卸载时自动撤销（`ctx.provide` / `ctx.on` / `ctx.effect` / `ctx.registry`）。
- 需要"等依赖齐了再干活"用 `inject.required`；只要在 `apply` 里 `ctx.get(name)`，若没写 `inject` 会在 service
  缺失时抛错。
- 想在所有插件都 load 完后再统一启动（如构建 HTTP 应用），把逻辑放 `start`。

### 4. 构建

```bash
PNPM_CONFIG_PM_ON_FAIL=ignore pnpm --filter libreoj-plugin-example build
```

### 5. 挂进 profile

在 profile 的 `plugins:`（或 `bundles:`）里列出来：

```yaml
active: web
profiles:
  web:
    plugins:
      - "libreoj-plugin-example"
    config:
      libreoj-plugin-example: { greeting: "hello from the profile" }
```

`bundles:` 与 `plugins:` 都会加载；区别只是来源标签（`bundles` / `plugins`），以及 `bundles` 惯例上用于官方
bundle。被 `config` / `patch` 覆盖的键按 profile 的层序深合并。

### 6. 验证

```bash
libreoj-plugin-validate libreoj-plugin-example   # 格式自查，退出码 0 = 通过
libreoj-dump-config profiles/backend.yaml        # 打印实际生效的插件树与配置
```

`dump-config` 会列出每个条目的 `name` / `source` / `state` / `disabled` / `config`，其中 `state` 为 `active`
说明插件已成功激活。后端用 `LIBREOJ_BACKEND_PROFILE` / `LIBREOJ_PATCH_FILE` 指向自定义 profile / 站点覆盖层。

### 7. 写测试

插件包应带自己的测试。常见做法是直接 import 自己的定义断言行为，或（更接近真实加载）用 `PluginHost` +
`NodeResolver` 加载内置 profile 断言结果——见示例包的 `src/index.test.ts`。

## 接在哪：seam 目录

"seam" 是插件之间交互的 Service Definition。你要扩展 LibreOJ，就是**消费/提供某个 seam**。分两类。

### 跨 Backend–Judge seam（`@libreoj/plugin-api`）

契约在 leaf 包 `@libreoj/plugin-api` 里，backend、judge 及构建期前端可共享，外部插件可安全依赖：

| Service 名（常量） | 接口 | 谁提供 | 典型消费方 |
| --- | --- | --- | --- |
| `codeLanguageRegistry`（`CODE_LANGUAGE_REGISTRY`） | `CodeLanguageRegistry` | `@libreoj/plugin-code-language` | backend |
| `languageRegistry`（`LANGUAGE_REGISTRY`） | `LanguageRegistry` | judge 的 `judge-languages` | judge |
| `checkerRegistry`（`CHECKER_REGISTRY`） | `CheckerRegistry` | judge 的 `judge-checkers` | judge |
| `http`（`HTTP`） | `HttpServer` | `@libreoj/plugin-http-nest` | 任何要暴露/挂路由的插件 |

- **`checkerRegistry`**：插件可贡献一个 **checker 接口实现**（`CustomChecker`），让题目的 checker 走你的实现。
  内置 checker（`integers` / `floats` / `lines` / `binary`）走原生绑定，不在这个 seam 内。
- **`http`**：Provider 中立——你通过 `HttpServer.route(method, path, handler)` / `use(middleware)` 注册，读到归一化的
  `HttpRequest` / `HttpResponse`。今天唯一的 Provider 是 Nest，换 Provider 不需要改你的插件。**注册必须在
  `apply`（`listen` 之前）完成**。

### 后端内部 seam（`apps/backend/src/plugin/seam.ts`）

这些是 backend 进程内部的服务，契约就是服务自身的类型（未镜像到 `plugin-api`）。加载进 backend 的插件可以
`inject.required` 它们：

| Service 名（常量） | 类型 | 提供方 |
| --- | --- | --- |
| `backendConfig`（`BACKEND_CONFIG`） | `ConfigService` | `@libreoj/backend-infra` |
| `backendDatabase`（`BACKEND_DATABASE`） | `DataSource` | `@libreoj/backend-infra` |
| `backendRedis`（`BACKEND_REDIS`） | `RedisService` | `@libreoj/backend-infra` |
| `backendLock`（`BACKEND_LOCK`） | `LockService` | `@libreoj/backend-infra` |
| `backendStorage`（`BACKEND_STORAGE`） | `FileService` | `@libreoj/backend-infra` |
| `backendMail`（`BACKEND_MAIL`） | `MailService` | `@libreoj/backend-infra` |
| `problemDataImporters`（`PROBLEM_DATA_IMPORTERS`） | `ProblemDataImporterRegistry` | `@libreoj/backend-problem-data-import` |
| `problemTypeRegistry`（`PROBLEM_TYPE_REGISTRY`） | `ProblemTypeRegistry` | `@libreoj/backend-problem-type-registry` |
| `backendDomainModules`（`BACKEND_DOMAIN_MODULES`） | `BackendDomainModules` | `@libreoj/backend-domain-modules` |

> 这些类型定义在 `apps/backend` 内，因此**外部包**要接它们需要依赖 backend 包（非 workspace 场景不推荐）。真正
> 稳定、跨端、可独立分发的扩展点是上面的 `@libreoj/plugin-api` seam。

### 贡献一个后端域（`backendDomainModules`）

官方把每个业务域做成一个插件，向 `backendDomainModules` 注册自己的 Nest 模块：

```ts
import { BACKEND_DOMAIN_MODULES, type BackendDomainModules } from "./seam";

export const plugin: PluginDefinition = {
  name: "@libreoj/backend-domain-example",
  inject: { required: [BACKEND_DOMAIN_MODULES] },
  apply(ctx) {
    const modules = ctx.get<BackendDomainModules>(BACKEND_DOMAIN_MODULES);
    ctx.effect(() => modules.add(ExampleModule)); // 撤销时移除登记
  }
};
```

**重要限制**：Nest 根模块只在 `http` provider 的 `start` 阶段物化**一次**。之后把条目移出注册表不会从运行中的
应用摘掉 controller。因此"禁用即卸载"一律指**改 profile + 重启**，内核与域插件都不做运行时热插拔（与整体设计
一致）。官方域插件用 `apps/backend/src/plugin/domains/define-domain-plugin.ts` 的 `defineDomainPlugin(name, module)`
把上面这段样板收敛成一行。

### 贡献一个题目类型（`problemTypeRegistry`）

```ts
inject: { required: [PROBLEM_TYPE_REGISTRY] },
apply(ctx) {
  const registry = ctx.get<ProblemTypeRegistry>(PROBLEM_TYPE_REGISTRY);
  ctx.effect(() => registry.register(ProblemType.YourType, yourService));
}
```

`ProblemTypeFactoryService` 通过该 seam 解析类型对应的服务，不再硬编码映射。

## 推荐的发布自查清单

- [ ] `libreoj-plugin-validate <包>` 退出码 0。
- [ ] `libreoj-dump-config <profile>` 里条目 `state: active`。
- [ ] `apply` 内所有登记都走 `ctx.provide/on/effect/registry`（保证卸载可逆）。
- [ ] 不在插件间直接 `import` 实现，只经 service / event 交互。
- [ ] 需要热重载则发布为 CommonJS。
