# 插件开发者指南

LibreOJ 的 backend、judge 与构建期 frontend 都由内核 `@libreoj/plugin-core` 的**插件**组装而成：内核只负责加载、
依赖门控与撤销，产品功能（HTTP 服务、各业务域、判题语言、checker……）都以插件形式接入。官方功能与第三方插件
地位相同，不存在需要打补丁的内核。

本目录是面向"想给 LibreOJ 加插件的人"的入口，共三篇：

| 文档 | 内容 |
| --- | --- |
| [distribution-format.md](distribution-format.md) | 一个插件包长什么样：`package.json` 的 `libreoj` manifest、入口导出、模块类型、依赖与命名。 |
| [authoring.md](authoring.md) | 从零到挂进 profile 的 step-by-step，含 **seam 目录**（可以接在哪）与校验命令用法。 |
| [profiles.md](profiles.md) | profile 文件格式与运维：`extends` / `bundles` / `plugins` / `config` / `patch` / `disabled`，站点如何引入第三方插件。 |

内核本身的运行时 API（`Context` / `Service` / `Fiber` / 事件 / 注册表 / 配置分层）见
[`packages/plugin-core/README.md`](../../packages/plugin-core/README.md)。跨 Backend–Judge 的 seam 契约见
[`packages/plugin-api/README.md`](../../packages/plugin-api/README.md)。

## 五分钟概览

一个最小插件就是一个 npm 包，在 `package.json` 里加一段 `libreoj` 声明入口，并在入口模块导出一个
`PluginDefinition`：

```jsonc
{
  "name": "libreoj-plugin-example",
  "main": "dist/index.js",
  "libreoj": { "entry": "dist/index.js", "config": { "greeting": "hello" } }
}
```

```ts
import type { PluginDefinition } from "@libreoj/plugin-core";

export const plugin: PluginDefinition = {
  name: "libreoj-plugin-example",
  apply(ctx, config) {
    ctx.provide("exampleGreeting", String(config.greeting ?? "hello"));
  }
};
```

把它装成 backend（或 judge）的依赖，再在 profile 的 `plugins:` 里列出它，重启即可生效——**不需要改 host 代码**：

```yaml
active: web
profiles:
  web:
    plugins:
      - "libreoj-plugin-example"
```

完整、可运行、带测试的示例包见
[`examples/plugin-example`](../../examples/plugin-example)。上线前用校验命令自查：

```bash
libreoj-plugin-validate libreoj-plugin-example
```

> **信任模型**：插件在进程内以全权限运行，只有管理员能安装。LibreOJ 不做插件沙箱或能力门控，`dump-config` /
> `libreoj-plugin-validate` 是唯一的内建审查手段。只安装你信任来源的插件。
