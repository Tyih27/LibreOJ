# @libreoj/plugin-core

LibreOJ 的框架无关插件内核，对齐 Cordis / dsh 的"一切皆插件"模型：内核只负责**加载 / 卸载**与**依赖关系**，
具体能力通过 service 与 event 协作，注册都是副作用、随插件卸载撤销。构建目标为 CommonJS
（`tsconfig.json` 的 `module: CommonJS`），除 `js-yaml`（用于 profile 读取与 dump 序列化）外无运行时依赖。

包为 `private`，通过 workspace 依赖使用：

```json
{ "dependencies": { "@libreoj/plugin-core": "workspace:*" } }
```

## 核心概念

### Context

`Context`（`src/context.ts`）是插件运行时句柄，一个 Context 拥有事件监听器、副作用、子 Context 与可撤销注册表，
被 dispose 时全部逆序回滚。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `parent` | `Context \| null` | 父 Context，根为 `null` |
| `scope` | `string` | 作用域名，宿主中即插件名 |
| `config` | `Record<string, unknown>` | 该插件生效配置（构造时浅拷贝） |
| `disposed` | `boolean` | 是否已 dispose |
| `fork` | `(scope, config?) => Context` | 创建子 Context，随父一起（且先于父）dispose，复用父的 service scope |
| `isolate` | `(names) => Context` | 创建隔离边界子 Context：所列名只用该边界的独立 scope，未列名仍树级全局 |
| `set` | `(name, value) => void` | 注册服务主方法：注册到拥有该名字的 scope（未隔离即树级），撤销随本 Context；同一 scope 内同名存活提供者重复注册抛错 |
| `provide` | `(name, value) => void` | `set` 的别名，保留兼容 |
| `get<T>` | `(name) => T` | 解析拥有该名字的 scope 中的 service，缺失抛错 |
| `tryGet<T>` | `(name) => T \| undefined` | 缺失返回 `undefined` |
| `has` | `(name) => boolean` | 是否存在 |
| `onServiceChange` | `(listener) => Disposer` | 订阅本 Context scope 链上的增删；隔离内的变更会向上传播到祖先（含根） |
| `fibers` | `FiberManager` | 根 Context 拥有、全树共享的内核 fiber 管理器 |
| `plugin` | `(input, config?) => Fiber` | 挂载插件（对象或函数形态），返回受门控的 fiber |
| `inject` | `(deps, cb) => Disposer` | deps 全就绪时执行 `cb` 并登记其 disposer，依赖变化时撤销并重跑；`cb` 抛错时清除本次占位并经内核 error 钩子上报，后续依赖变化会重试 |
| `on` | `(event, listener) => Disposer` | 注册普通层事件监听器，随本 Context 撤销 |
| `before` | `(event, listener) => Disposer` | 注册 `before` 层监听器，在本 Context 的普通监听器之前运行 |
| `after` | `(event, listener) => Disposer` | 注册 `after` 层监听器，在本 Context 的普通监听器之后运行 |
| `once` | `(event, listener) => Disposer` | 注册只触发一次的普通层监听器，随本 Context 撤销 |
| `emit` | `(event, ...args) => unknown` | 向本 Context 及祖先冒泡；返回首个非 `undefined` 的监听器返回值（bail），都返回 `undefined` 时返回 `undefined` |
| `effect` | `(fn) => Disposer` | 立即执行 `fn`，登记其返回的 disposer |
| `registry<T>` | `(namespace) => ReversibleRegistry<T>` | 获取命名空间注册表句柄 |
| `dispose` | `() => Promise<void>` | 逆序回滚全部登记，幂等 |

对已 dispose 的 Context 调用会抛错。

### Service 作用域

`ServiceScope`（`src/service.ts`）是一棵 scope 树：根 Context 创建树级 scope，普通 `fork` 复用父 scope，
`isolate` 则挂一个子 scope 并独占一组名字。

- 任何 Context `set`（别名 `provide`）的 service 默认在整棵树内可见（祖先、后代、兄弟皆可），与挂载位置或顺序无关；
- 同一 scope 内**同名存活提供者只允许一个**，重复 `set` / `provide` 抛错；
- 撤销登记在**提供者的 Context** 上，提供者卸载即移除该 service，并通知 `onServiceChange` 订阅者；
- 不同根 Context 的 scope 相互隔离，不共享 service；
- `ctx.isolate(names)` 返回隔离边界 Context `iso`：在 `iso` 及其后代内，对 `name ∈ names` 的
  `set`/`get`/`tryGet`/`has` 只作用于该边界自己的 scope——看不到外层同名注册，外层也看不到它。未列入 `names`
  的名字照常沿 scope 链解析（树级全局）。两个 isolate 即使平级、名字相同也互不共享；隔离沿子树传递
  （`fork` / `ctx.plugin` 得到的子 Context 沿用同一隔离 scope）；dispose `iso` 会连同整棵子树移除其隔离服务。
- `ServiceScope.resolveScope(name)` 选择最近的隔离该名字的 scope，否则回落到父/根；`onServiceChange` 沿 scope
  链向上传播，因此隔离内发生的变更其祖先（含根，例如 `FiberManager`）也能收到通知。

### Service 基类

`Service`（`src/service.ts`）是 Cordis 风格的服务基类：**构造即注册**——`super(ctx, name)` 内部调用
`ctx.set(name, this)`，把实例绑定到拥有该名字的 scope（默认树级，隔离内则为其隔离 scope），撤销与 `ctx.set`
完全一致（随传入的 Context 一起吊销）。

```ts
class Db extends Service {
  constructor(ctx: Context) {
    super(ctx, "db");
  }
}
```

内核**有意未实现** Service 拦截（interception）与 trait：它们要求内核理解具体 service 的语义，会把"一切皆插件"的通用内核耦合到业务细节，因此留给具体插件通过 event / service 自行扩展。

### Fiber 与依赖门控（内核）

`Fiber`（`src/fiber.ts`）是"一个已挂载插件"的运行时身份：每个 `ctx.plugin(input, config?)` 产生一个 Fiber，
字段为 `name` / `definition` / `config` / `state` / `context` / `error` / `started`，并带 `dispose()` 运行期卸载。

- 状态机与门控都由内核维护：`inject.required` 未满足时保持 `pending` 且不调用 `apply`；满足后 `loading → active`；
  required service 消失则 `disposing → dispose 旧 context → pending`，恢复后从**全新 context** 重新 `apply`；
  `apply` 抛错则回滚该 context 并进入 `error`。运行期调用 `fiber.dispose()`（幂等）卸载单个插件：从内核注销、
  `emit("dispose")`、销毁 context，`state` 落到 `disposed`，并让内核重新评估依赖方。
- Fiber 由根 Context 的 `FiberManager` 统一登记：它订阅 `ServiceScope.onChange` 并把树 `reconcile()` 到不动点
  （先 deactivate 缺依赖的 active，再 activate 满足依赖的 pending），`settle()` 串行化并等待这一过程。每次
  **改变了 fiber 状态**的 reconcile 安定后，`FiberManager` 通过 `onSettled(listener)` 通知订阅者（未改变状态的
  安定不通知，避免监听者反复触发空转）。
- `FiberManager` 承担 `failureMode`（`skip` / `fatal`）、`onError(name, error)` 与 `fatalError`；
  `fatal` 时记录首个错误并让等待方 reject。
- `ctx.inject(deps, cb)` 是 service 级联的轻量形式：deps 变化时撤销 / 重跑 `cb` 登记的副作用。
- `inject.optional` 不门控激活（缺失也 `active`）：`Fiber.optionalAvailable`（`Record<string, boolean>`）与
  `Fiber.missingOptional()` 反映 optional 依赖当前是否可用，供诊断 / dump 观察其出现与消失；插件内可用
  `ctx.inject` 对 optional service 的出现 / 消失重跑回调。
- 子插件随挂载它的 Context 一起卸载。

### 事件语义

`EventBus`（`src/events.ts`）只做**单层**派发；`Context.emit` 负责分层冒泡：从最深的 Context 开始，逐级触发
每个祖先的 bus。每个 bus 内监听器按 `before → on → after` 三个层级调用，同层按注册顺序。

- **bail**：任一监听器返回非 `undefined` 值即中断——本层后续监听器、后续层与祖先 Context 的监听器都不再运行，
  该值作为 `emit` 的返回值；全部返回 `undefined` 时 `emit` 返回 `undefined`。
- 监听器随其注册 Context 自动撤销；`once` 注册的普通层监听器在首次触发前先自移除。
- 生命周期事件：插件 `apply` 成功后在**插件自身的 Context** 上 `emit("ready")`（向挂载它的 Context 及祖先冒泡）；
  卸载 / 停用前在其 Context 上 `emit("dispose")`。

### ReversibleRegistry

`ReversibleRegistry<T>`（`src/registry.ts`）是可撤销键值注册表。命名空间的底层共享存储（cell）由**根 Context 创建并拥有**，
树内任何 `ctx.registry(namespace)` 都解析到同一份存储；调用者只持有非拥有句柄。

- `set(key, value): void` 追加一次写入，并把"撤销这一次写入"的 disposer 登记到**调用者 Context** 的栈上；
- 因此子插件 dispose 只回滚自己注册的键，不影响祖先或兄弟的条目；
- 每个键维护写入链，撤销时精确移除对应写入并重算有效值，交错覆盖也能正确回退（不会复活被后续写入取代的值）；
- 其它方法：`get` / `has` / `delete` / `keys` / `entries` / `onChange` / `size` / `dispose`。

### DisposableStack

`DisposableStack`（`src/disposable.ts`）收集 disposer 并在 `run()` 时**逆序（LIFO）**执行：

- `add(disposer)` 返回一个可提前注销并立即执行的 disposer；
- `run()` 幂等，每个 disposer 至多执行一次；多个 disposer 抛错时记录全部并重新抛出第一个。

## 插件定义

插件有两种形态，均由 `normalizePlugin(input, fallbackName?)`（`src/plugin.ts`）归一为 `PluginDefinition`。

**函数式插件** `PluginFunction`（Cordis 风格）：可调用对象，元数据挂在其属性上。函数必须有名字（匿名时用
`fallbackName` 兜底，两者皆无则抛错）；`normalizePlugin` 把 `Config` 映射为 `config`、函数体作为 `apply`，
并透传 `start`。

```ts
type PluginFunction<C = Record<string, unknown>> = ((ctx: Context, config: C) => void | Promise<void>) & {
  name?: string;
  inject?: Inject;
  provide?: string[];
  Config?: PluginConfigSchema<C>;
  start?: (ctx: Context, config: C) => void | Promise<void>;
};
```

**对象式插件** `PluginDefinition`：

```ts
interface PluginDefinition<TConfig = Record<string, unknown>> {
  name: string;
  inject?: { required?: string[]; optional?: string[] };
  provide?: string[];
  config?: PluginConfigSchema<TConfig>;
  apply(ctx: Context, config: TConfig): void | Promise<void>;
  start?(ctx: Context, config: TConfig): void | Promise<void>;
}
```

两者共用同一组字段，`PluginInput` 即是二者的联合。

- `inject.required` 是**激活门控**：所列 service 未全部就绪前插件保持 `pending`，不调用 `apply`；`inject.optional`
  不参与门控（缺失也 `active`），仅声明插件可能观察的 service，可通过 `Fiber.optionalAvailable` /
  `Fiber.missingOptional()` 查看，并在插件内用 `ctx.inject` 对 optional service 的出现 / 消失做出反应。
- `provide` 是诊断用的声明，实际注册发生在 `apply` 中。
- `config` 为可选的自身配置处理：`defaults` 是最低优先级层，`parse` 负责校验 / 归一化合并后的配置并可在非法时抛错。
- 模块解析由注入的 `ModuleResolver` 完成（`resolve(name, options?) => PluginDefinition | Promise<PluginDefinition>`，
  内核不关心加载方式）：`options.fresh` 请求绕过模块缓存，同步的 `InlineResolver`（内存表，测试与 fixture 用）忽略它，
  内置 `NodeResolver`（文件系统，见下）按入口类型同步或异步返回，内核统一 `await`。

`PluginState` 生命周期：`pending → loading → active → disposing → disposed`，`apply` / `start` 抛错进入 `error`。

### NodeResolver

`NodeResolver`（`src/node-resolver.ts`）是面向文件系统的 `ModuleResolver`：

- 以 `.` 开头或绝对路径的名称相对其 `baseDir`（默认 `process.cwd()`）解析，其它名称按包名从 `baseDir` 解析；
- 读取最近的 `package.json` 的 `libreoj` manifest：`libreoj.entry` 指定入口模块（缺省回退到 `main`，再回退到解析到的文件）；
  `libreoj.config` 是最低的默认配置层，会被插件自身的 `config.defaults` 覆盖；
- 从模块导出中依次取 `plugin`、`default`、模块本身作为 `PluginDefinition`；导出是函数时经 `normalizePlugin` 归一
  （匿名函数以 `resolve` 的名称兜底）；
- 入口类型判定：`package.json#type === "module"` 或入口以 `.mjs` / `.mts` 结尾即 **ESM**，用真正的动态 `import()`
  （经 `new Function("s", "return import(s)")` 规避 CommonJS 降级，规格化为 `pathToFileURL(entry).href`）异步加载，
  `resolve` 返回 promise；否则走 `require` 同步返回；
- `resolve(name, { fresh: true })` 会从 `require.cache` 清除该入口及其 `package.json`，使改动过的 CommonJS 文件被重新
  读取（支撑 `PluginHost.reload`）；Node 的 ESM 加载器没有缓存失效接口，故 `fresh` 对 ESM 无效，重载后的 ESM 插件
  仍是首次求值的实例（已在源码注释说明）。

### ChainResolver

`ChainResolver`（`src/chain-resolver.ts`）把一组 `ModuleResolver` 串成有序链，按顺序尝试、**返回第一个成功**：

- 依序调用 `resolvers[0]`、`resolvers[1]`……当前解析器**同步抛错**或返回的 **promise reject** 时前进到下一个；一旦
  返回值（同步结果或已 resolve 的 promise）即短路返回，不再探测后续解析器；
- 全部失败时重新抛出**最后一个**错误，因为它最具体（例如文件系统 `NodeResolver` 的 "Cannot resolve plugin …"）；
- 返回类型仍是 `PluginDefinition | Promise<PluginDefinition>`（内部 `await` 统一处理同步 / 异步两种结果，内核也统一
  `await`）。

它让宿主用内存表解析**内置 bundle**、其余走**文件系统**：profile 里出现一个内存表不认识的条目时会回退到文件系统解析，
而不是直接终止启动，因此第三方无需改动宿主代码即可通过 profile 启用已安装的插件。

### 依赖门控与 start

门控由内核 `FiberManager` 承担；`PluginHost`（`src/host.ts`）退化为按 profile 装载的 loader：`resolveConfig` →
对每个未禁用条目 `root.plugin(definition, entry.config)` 挂载 → 等待 `root.fibers.settle()` → 对 `active` 且本
激活周期内尚未 start 的 fiber 按装载顺序各调一次 `start`。host 把两者的结果反复推进到不动点：

- required 未就绪 → 保持 `pending`，不 apply；就绪 → `active`；
- required service 消失 → 依赖方被 deactivate（dispose 其 Context）并回到 `pending`，依赖恢复后会获得**全新 Context
  并重新 `apply`**；
- `start` 在树稳定后按装载顺序对每个 `active` 且本激活周期内尚未 start 的插件各调用一次；`start` 中 `provide` 出的
  service 可再激活其它插件，宿主会重复"settle + start"直到不再变化；
- 运行期 service 变化由内核 reconcile 消化。宿主在 `load` 时订阅 `FiberManager.onSettled`（随根 Context 撤销），
  内核每次安定且改变了 fiber 状态后即自动重跑上述 "start + settle" 循环，因此被依赖恢复**重新激活的插件也会被
  `start`**，无需外部调用 `reconcile()`。`deactivate` 会清除本激活周期的 started 标记，重新激活后 `start` 可再次运行。

### failureMode

`PluginHostOptions.failureMode` 决定 `apply` / `start` 抛错时的行为：

- `"skip"`（默认）：记录该插件为 `error`，继续启动其余插件；
- `"fatal"`：记录并抛出，终止本次 `load` / `reconcile`。

`failureMode` 不覆盖解析期错误：`ModuleResolver.resolve` 失败或 `config.parse` 失败总是直接 reject（属于配置 / 安装错误）。
可选 `onError(name, error)` 在每个不同错误对象上至多回调一次。宿主还提供 `plugins`、`fatalError`、`root` 与
`load(layers)` / `reconcile()` / `dispose()` / `dumpConfig()`。

### 运行期装卸

`PluginHost` 在 `load` 之后提供可编程的装卸原语（不做文件监听式 HMR），三者都要求已 `load` 且未 dispose，否则抛错：

- `install(name, config?): Promise<Fiber>`：经 resolver 解析 → `root.plugin` 挂载 → settle 到不动点（active 且本激活
  周期内未 start 的 fiber 会 `start`）→ 返回 fiber。插件登记进 `plugins` / `dumpConfig`（新条目 `source: "runtime"`）；
  重复安装同名抛错。
- `uninstall(name): Promise<void>`：移除记录与解析条目 → `fiber.dispose()`（吊销其 service，依赖方自动 deactivate /
  回到 `pending`）→ settle；`plugins` 与 `dumpConfig` 不再列出该插件。未安装的名字抛错。
- `reload(name): Promise<Fiber>`：`uninstall` + fresh `install`，保留原配置与 `source`，用于改代码后热更新。
- `install` 触发的 `apply` / `start` 失败模式与 `load` 一致（`skip` 记录 `error` 并不 reject，`fatal` reject 并记录
  `fatalError`）。

## 配置分层

`ConfigLayer`（`src/config.ts`）是一层配置：`name?` / `bundles?` / `plugins?` / `config?` / `patch?`。
`Profile` 在 layer 基础上多一个 `extends?`。

`resolveConfig(layers)` 分两遍扁平化为 `ResolvedConfig`：

1. 第一遍按层序注册所有 `bundles` 与 `plugins`，按**首次出现**去重并记录来源（`"bundles"` 或 `"plugins"`）；
2. 第二遍按层序深合并每个 `config`，再套用每个 `patch`。上层覆盖下层，因此 `config` / `patch` 可以**前向引用**
   由更后层注册的插件。

合并规则：对象逐键递归合并；数组与其它值整体替换（`src/object.ts` 的 `deepMerge`）。

`patch` 中的特殊字段 `disabled` 切换条目开关：`{ disabled: true }` 禁用、`{ disabled: false }` 重新启用；
被禁用的条目仍保留在解析结果中，便于 dump 报告。指向从未被任何层注册的插件、或值不是映射的 `config` / `patch`
条目不会被静默丢弃，而是记入 `warnings`。

`ResolvedPlugin` 字段：`name` / `source` / `config` / `disabled`；`source` 为 `"bundles"` / `"plugins"`（配置层来源）
或 `"runtime"`（`PluginHost.install` 运行期挂载）。注意本地插件（`plugins` 中的路径）的 `name`
就是 profile 里写的那个条目字符串（例如 `"./provides"`），而非插件定义自身的 `name`。

`composeLayers({ profile, homePatchFile?, patches? })`（`src/layers.ts`）是 CLI 与各 loader **共用**的层序组装，
把以下来源按顺序拼成 `ConfigLayer[]`（后者覆盖前者）：

1. profile 文件展开：`extends` 链基类在前、被选 profile 在后，各 profile 的 `config` 之后应用其自带的 `patch`；
2. 站点/home patch（`LIBREOJ_PATCH_FILE`，可选）；
3. 各 `--patch` 文件，按出现顺序，可多次。

相对路径以当前工作目录为基准解析；`dump-config` 用 `process.env.LIBREOJ_PATCH_FILE` 作为 `homePatchFile`。

## profile 文件格式

`loadProfileFile(path)` 接受两种形态。

多 profile 文件（`profiles` + `active`，可 `extends`）：

```yaml
active: web

profiles:
  base:
    bundles:
      - "@libreoj/http-nest"
      - "@libreoj/legacy"
    config:
      "@libreoj/http-nest": { port: 3000 }
  web:
    extends: base
    bundles:
      - "@libreoj/backend-user"
    plugins:
      - "./plugins/example"
    config:
      "@libreoj/backend-user": { allowRegistration: true }
    patch:
      "@libreoj/http-nest": { port: 8080 }
      "@libreoj/legacy": { disabled: true }
```

`active` 的 `extends` 链被展开为**基类在前、被选 profile 在后**的有序层；未知 profile 或环形 `extends` 抛错。

单 profile 文件（无 `profiles` 键）：整个文档就是一层（不跟随 `extends`）：

```yaml
name: web
bundles:
  - "@libreoj/http-nest"
config:
  "@libreoj/http-nest": { port: 8080 }
```

`loadPatchFile(path)` 把 YAML 读成单个覆盖层（同样支持 `name` / `bundles` / `plugins` / `config` / `patch`），
应用在 profile 自身各层之后，供 `--patch` 或其它覆盖来源使用。

## dump-config CLI

包提供 `libreoj-dump-config` 可执行文件（`src/bin/dump-config.ts`，bin 指向 `dist/bin/dump-config.js`）：

```
libreoj-dump-config <profile.yaml> [--patch <patch.yaml>]...
```

它通过 `composeLayers`（`src/layers.ts`）按顺序组装 layers，用 `NodeResolver` 加载，调用 `host.dumpConfig()` 把
**实际生效的插件树**序列化为 YAML 写到 stdout：

- 层序与 dsh 一致（后者覆盖前者）：profile 展开（含 `extends` 链与各 profile 自带 `patch`）→ 站点 patch
  `LIBREOJ_PATCH_FILE`（若设置）→ 各 `--patch` 文件（按出现顺序）；
- 每个条目报告 `name` / `source` / `disabled` / `state` / `config`（键已排序，输出确定、可做 golden 对比）；
- `state` 取值同 `PluginState`，另加 `"disabled"` 表示被禁用、从未挂载的条目；
- `warnings` 汇总配置解析告警与生命周期告警（禁用条目、`error` 状态、因缺少 required service 而 pending、
  未恢复的 fatal 错误）。

profile 中的相对插件路径以 profile 文件所在目录为基准解析，故 profile 与其本地插件一起移动。参数缺失、文件
读取 / YAML 解析失败或插件解析失败时，写 stderr 并返回退出码 1。

## libreoj-plugin-validate CLI

包提供 `libreoj-plugin-validate` 可执行文件（`src/bin/validate-plugin.ts`，bin 指向
`dist/bin/validate-plugin.js`），供第三方校验一个插件包是否符合分发格式：

```
libreoj-plugin-validate <name-or-path> [--base-dir <dir>] [--json]
```

校验逻辑即包根导出的 `validatePlugin(name, options?)`（`src/validate.ts`），**永不抛错**，而是返回
`PluginValidationResult`（`ok` / `requested` / `definitionName` / `entry` / `moduleKind` / `manifestEntry` /
`manifestConfig` / `errors` / `warnings`）。

- 目标解析与 `NodeResolver` 一致：以 `.` 开头或绝对路径相对 `--base-dir`（缺省为当前工作目录）解析，其它按包名
  解析；加载走真实解析路径（ESM 走动态 `import()`、CommonJS 走 `require`），入口选择同 `NodeResolver`
  （`libreoj.entry` → `main` → 解析到的文件）。
- 人类可读输出：先打印标头（`requested`，以及可确定时的 `definitionName` / `entry` / `moduleKind`），随后每行
  `error: …` 与 `warning: …`，最后一行 `ok` 或 `failed`。
- `--json` 打印完整 `PluginValidationResult`（缩进 2 空格）到 stdout。
- 退出码：`ok` 为 true 时 0，否则 1；参数缺失、未知选项或 `--base-dir` 缺值时写 stderr 并返回 1。
- **error（致命，`ok: false`）**：找不到 `package.json`，或它无法读取（不是合法 JSON / 不是 JSON 对象）；`libreoj`
  manifest 不是对象，或它的 `entry` 不是字符串 / `config` 不是对象；入口无法解析；模块未导出可用的 `PluginDefinition`
  （须为带字符串 `name` 与函数 `apply` 的对象，或具名函数）；`definition.name` 为空 / 仅空白；`inject` 存在但不是
  对象，或 `inject.required` / `inject.optional`、`provide` 存在但不是字符串数组；`config.defaults` 存在但不是普通
  对象；`config.parse` 存在但不是函数。
- **warning（不致命，不影响 `ok`）**：包未声明 `libreoj.entry`（回退到 `main`）；按包名发起请求时定义的 `name`
  与 `requested` 不一致（本地路径请求不告警）；定义未声明 `config` schema。

```bash
node packages/plugin-core/dist/bin/validate-plugin.js ./packages/plugin-core/fixtures/demo/provides
node packages/plugin-core/dist/bin/validate-plugin.js ./packages/plugin-core/fixtures/bad-inject --json
```

## 最小可运行示例

`fixtures/demo` 提供两个本地 CommonJS 插件：

- `fixtures/demo/provides`（导出 `module.exports.plugin`）在 `apply` 中 `ctx.provide("greeting", "hello")`；
- `fixtures/demo/consumes`（导出 `module.exports.default`）声明 `inject.required: ["greeting"]`，就绪后
  `ctx.get("greeting")` 并二次提供 `consumes.greeting`。

`fixtures/esm-plugin` 是一个最小 ESM 包（`package.json` 的 `type: "module"`，`index.mjs` 用 `export const plugin`
导出定义），用于验证 ESM 入口解析。

`fixtures/demo/profile.yaml` 还列出一个从未解析的 bundle `@fixture/disabled-plugin`，并在 `patch` 里
`disabled: true`，用于演示禁用条目的 dump。构建后 dump 整棵树：

```bash
PNPM_CONFIG_PM_ON_FAIL=ignore pnpm --filter @libreoj/plugin-core build
node packages/plugin-core/dist/bin/dump-config.js packages/plugin-core/fixtures/demo/profile.yaml
```

输出中 `"./provides"` 与 `"./consumes"` 均为 `active`（后者由前者提供的 `greeting` 激活），
`"@fixture/disabled-plugin"` 为 `state: disabled` 且 `disabled: true`。加覆盖层：

```bash
node packages/plugin-core/dist/bin/dump-config.js \
  packages/plugin-core/fixtures/demo/profile.yaml \
  --patch path/to/overlay.yaml
```

## 包内脚本

| 脚本 | 命令 | 说明 |
| --- | --- | --- |
| `build` | `rm -rf dist && tsc -p tsconfig.build.json` | 产出 `dist/`（含 CLI） |
| `check-types` | `tsc --noEmit -p tsconfig.json` | 类型检查（含测试） |
| `test` | `tsx --test src/*.test.ts src/bin/*.test.ts` | Node 内置 `node:test` + tsx |
| `check-format` | `prettier --check "src/**/*.ts" "*.json"` | 格式检查 |
| `format` | `prettier --write "src/**/*.ts" "*.json"` | 自动格式化 |

本仓库环境中 pnpm 命令需带 `PNPM_CONFIG_PM_ON_FAIL=ignore` 前缀，例如：

```bash
PNPM_CONFIG_PM_ON_FAIL=ignore pnpm --filter @libreoj/plugin-core test
PNPM_CONFIG_PM_ON_FAIL=ignore pnpm --filter @libreoj/plugin-core check-types
```
