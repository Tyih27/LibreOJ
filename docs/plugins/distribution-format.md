# 分发格式

一个 LibreOJ 插件就是一个 **npm 包**（workspace 成员或可发布到 registry 的独立包），加上 `package.json` 里的一段
`libreoj` 声明。内核通过 `NodeResolver` 从文件系统加载它，解析规则如下。

## `package.json` 的 `libreoj` manifest

```jsonc
{
  "name": "libreoj-plugin-example",
  "version": "1.0.0",
  "main": "dist/index.js",
  "libreoj": {
    "entry": "dist/index.js",
    "config": { "greeting": "hello" }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `libreoj.entry` | `string` | 否 | 入口模块，相对**包根**解析。缺省时回退到 `main`，再回退到包解析到的文件。建议始终显式声明，指向构建产物（如 `dist/index.js`）。 |
| `libreoj.config` | `object` | 否 | 本插件的**最低优先级**默认配置层。会被插件自身定义里的 `config.defaults` 覆盖，也会被 profile 的 `config` / `patch` 覆盖。 |

**manifest 里没有 `inject` / `provide`。** 依赖声明与服务提供都写在入口模块导出的插件定义里（见下），不在
`package.json` 中。这样依赖门控随代码走，不会出现"改了代码忘改 manifest"的漂移。

## 入口导出契约

内核读取入口模块的导出，按以下顺序挑选插件定义：

1. ESM 具名导出 `plugin`；
2. `default` 导出；
3. 模块导出对象本身（CommonJS 的 `module.exports`）。

选出的值必须能归一为 `PluginDefinition`：

- **对象式**：一个有 `string` 类型的 `name` 和函数类型 `apply` 的对象。
- **函数式**（Cordis 风格）：一个有名字的函数；其属性上可挂 `inject` / `provide` / `Config` / `start`。匿名函数
  会以解析时用的名字兜底，两者皆无则报错。

推荐的写法是具名导出，两种模块类型都适用：

```ts
// ESM 或 TS 编译为 ESM
export const plugin: PluginDefinition = { name: "…", apply(ctx, config) { /* … */ } };
```

```js
// CommonJS
module.exports.plugin = { name: "…", apply(ctx, config) { /* … */ } };
```

`PluginDefinition` 的完整字段（`name` / `inject` / `provide` / `config` / `apply` / `start`）见
[`packages/plugin-core/README.md`](../../packages/plugin-core/README.md#插件定义)。要点：

- `inject.required` 是**激活门控**——所列 service 未全部就绪前插件保持 `pending`，`apply` 不会被调用；`inject.optional`
  不门控。
- `provide` 只是诊断用的声明，真正的注册发生在 `apply` 里（例如 `ctx.set(name, value)`）。
- `config.defaults` 是插件自己的默认配置（**高于** manifest 的 `libreoj.config`）；`config.parse` 负责校验/归一化合并后
  的配置，可在非法时抛错。

## 模块类型（CJS / ESM）

判定规则：

- 包的 `package.json` 设了 `"type": "module"`，或入口以 `.mjs` / `.mts` 结尾 → **ESM**，用原生动态 `import()` 异步加载；
- 否则 → **CommonJS**，用 `require` 同步加载。

两种都受支持。差异只在**热重载**：`fresh` 重载只对 CommonJS 生效（从 `require.cache` 清除入口），Node 的 ESM
加载器没有缓存失效接口，ESM 插件重载后仍是首次求值的实例。若你的插件需要"改代码后 reload 生效"，请发布为
CommonJS。

## 依赖

- **`@libreoj/plugin-core`**：插件定义与运行时 API 的来源。workspace 内用 `workspace:*`；外部第三方包用具体版本
  （把 `plugin-core` 声明为 `dependency` 或 `peerDependency`）。
- **`@libreoj/plugin-api`**：仅当你要接**跨 Backend–Judge 的 seam**（`codeLanguageRegistry` / `languageRegistry` /
  `checkerRegistry` / `http`）时依赖。它在 workspace 内以 `workspace:*` 引用。

内核不做版本/能力协商：一个进程内所有插件共享同一份 `plugin-core` 实例。

## 命名

- 官方插件用 `@libreoj/*` scope（backend 域、judge、http provider……）。
- 第三方插件可用任意包名。**不要**占用 `@libreoj/*`，以免与官方包冲突。

## 分发方式

包只要能被 `NodeResolver` 从 profile 所在的基础目录解析到即可，两种形态都行：

| 形态 | 放法 | profile 里怎么引用 |
| --- | --- | --- |
| workspace 成员 | 放进本仓库 `plugins/*` 或 `examples/*`（`pnpm-workspace.yaml` 已包含这两个 glob） | 直接写包名，如 `"libreoj-plugin-example"` |
| 本地目录 | 任意路径 | 相对/绝对路径，如 `"./my-plugins/foo"`（相对 profile 文件所在目录解析） |
| 已发布的包 | 装进使用方的 `node_modules` | 写包名 |

`profiles/*.yaml` 默认随仓库分发；站点可以带自己的 profile（见
[profiles.md](profiles.md)）。内置 profile 中与本仓库产物相关的条目用相对路径解析，因此 profile 与其本地插件一起
移动。

## 自查

发布或挂载前用校验命令确认格式正确，它会加载包并检查 manifest 与插件定义：

```bash
libreoj-plugin-validate <包名或路径> [--base-dir <dir>] [--json]
```

退出码 `0` 表示通过。具体检查项与 warning / error 的含义见
[`packages/plugin-core/README.md`](../../packages/plugin-core/README.md) 的 `libreoj-plugin-validate CLI` 一节。
