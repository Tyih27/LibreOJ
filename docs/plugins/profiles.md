# Profile 与站点组装

**profile** 是一个 YAML 文件，声明一次运行要加载哪些插件、给它们什么配置、覆盖/禁用哪些条目。它是 LibreOJ
"启动期组装"的唯一入口（不做运行时热插拔）：改 profile + 重启 = 换插件集。

仓库随附两份：

| Profile | 文件 | 谁在用 | 入口点覆盖变量 |
| --- | --- | --- | --- |
| backend | [`profiles/backend.yaml`](../../profiles/backend.yaml) | `apps/backend` | `LIBREOJ_BACKEND_PROFILE` |
| judge | [`profiles/judge.yaml`](../../profiles/judge.yaml) | `apps/judge` | `LIBREOJ_JUDGE_PROFILE` |

两者都支持站点覆盖层：`LIBREOJ_PATCH_FILE` 指向一个 patch 文件，在所有 profile 层之后应用。

## 文件格式

### 多 profile 文件

```yaml
active: web            # 选中哪个 profile

profiles:
  base:
    bundles:
      - "@libreoj/plugin-http-nest"
    config:
      "@libreoj/plugin-http-nest": { port: 3000 }
  web:
    extends: base       # 先应用 base，再应用 web
    bundles:
      - "@libreoj/backend-domain-homepage"
    plugins:
      - "./my-plugins/example"     # 本地路径（相对 profile 文件所在目录）
      - "libreoj-plugin-example"   # 包名
    config:
      libreoj-plugin-example: { greeting: "hi" }
    patch:              # 本 profile 自带的覆盖层
      "@libreoj/plugin-http-nest": { port: 8080 }
```

`active` 的 `extends` 链被展开为**基类在前、被选 profile 在后**的有序层；未知 profile 或环形 `extends` 抛错。

### 单 profile 文件

没有 `profiles` 键时，整个文档就是一层（不跟随 `extends`）：

```yaml
name: web
bundles:
  - "@libreoj/plugin-http-nest"
config:
  "@libreoj/plugin-http-nest": { port: 8080 }
```

### 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | 层名（诊断用）。 |
| `extends` | `string` | 仅多 profile：继承的 profile 名。 |
| `bundles` | `string[]` | 按序加载的插件条目（来源标签 `bundles`）。 |
| `plugins` | `string[]` | 按序加载的插件条目（来源标签 `plugins`）；惯例上第三方/本地插件放这里。 |
| `config` | `Record<name, object>` | 各插件的配置层，按层序深合并。 |
| `patch` | `Record<name, object \| { disabled }>` | 本层的覆盖层；对条目深合并，`disabled` 切换开关。 |

同一层内 `bundles` 与 `plugins` 按**首次出现**去重。`config` / `patch` 可以前向引用更后层才注册的插件，
不会被丢弃。

## 叠加顺序（后者覆盖前者）

```
profile extends 链（base 在前）
  → 被选 profile 的 bundles / plugins / config
  → 被选 profile 自带的 patch
  → 站点 patch（LIBREOJ_PATCH_FILE）
  → CLI --patch 文件（按出现顺序，可多次；dump-config 用）
```

合并规则：对象逐键递归合并；数组与其它值整体替换。

## 启用 / 覆盖 / 禁用

**启用**：把包名或路径加进 `bundles` / `plugins`。

**覆盖配置**：在 `config`（默认层）或 `patch`（覆盖层）里写该条目的键，深层合并：

```yaml
patch:
  libreoj-plugin-example: { greeting: "overridden" }
```

**禁用**：`patch` 里对该条目 `{ disabled: true }`。条目仍保留在解析结果中（便于 `dump-config` 报告），可用
`{ disabled: false }` 重新启用：

```yaml
patch:
  "@libreoj/backend-domain-homepage": { disabled: true }
```

### 两个必须知道的限制

- **只有真正"独立"的插件能被卸载**：像 `homepage`、`cors` 这类自成一域、且没有被其它模块直接 `import` 的域，
  禁用后会从 OpenAPI 路由里消失。其余后端域虽以插件形式注册，但仍被别的模块直接引用，禁用它们不会摘掉功能。
- **能力 seam 不可禁用**：例如 `@libreoj/backend-problem-type-registry` 提供的 `problemTypeRegistry` 被
  `ProblemTypeFactoryService` 注入。禁用它会让启动**直接失败**（取不到服务），而不是优雅降级。它是能力，不是可选
  插件。

## 站点运维配方

### 引入一个第三方插件

```yaml
# site-patch.yaml
patch:
  libreoj-plugin-example: { greeting: "hello from the site" }
```

```yaml
# my-profile.yaml
active: web
profiles:
  web:
    extends: base                 # 若你有自己的基类
    plugins:
      - "libreoj-plugin-example"
```

```bash
LIBREOJ_BACKEND_PROFILE=$PWD/my-profile.yaml \
LIBREOJ_PATCH_FILE=$PWD/site-patch.yaml \
pnpm --filter @libreoj/backend dev
```

### 保留官方 profile，只做最小覆盖

不改官方 `profiles/backend.yaml`，用 `LIBREOJ_PATCH_FILE` 挂一个只写差异的层：

```yaml
# ops.yaml
patch:
  "@libreoj/backend-domain-homepage": { disabled: true }
  "@libreoj/plugin-http-nest": { port: 2002 }
```

### 排查

```bash
# 打印实际生效的插件树：name / source / state / disabled / config（键已排序，可 diff）
libreoj-dump-config profiles/backend.yaml --patch ops.yaml

# 校验单个插件包的格式
libreoj-plugin-validate libreoj-plugin-example
```

`dump-config` 顶部还会输出 `warnings`，汇总配置解析告警与生命周期告警（被禁用的条目、`error` 状态、因缺
required service 而 `pending`、未恢复的 fatal 错误）。参数缺失、文件读取/YAML 解析失败或插件解析失败时，
写 stderr 并返回退出码 1。
