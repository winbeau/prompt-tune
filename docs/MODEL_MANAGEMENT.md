# 自研模型管理设计

- 日期：2026-10-11
- 状态：接口与行为规划，尚未实现

## 1. 决策与边界

学习 Pi 的 provider / model / credentials / runtime 分层，开发 PromptTune 自己的轻量模型层。
运行时不依赖 Pi SDK，不引入编码 Agent、工具执行、会话运行时或 Pi 的用户配置目录。

支持的接入来源：DeepSeek、OpenCode Zen、OpenCode Go、兼容已支持协议的第三方 API。
供应商数量和协议数量分别管理：同一供应商可以有不同协议的模型，同一协议可被多家供应商复用。

首轮实现 Chat Completions；按实际模型需要继续实现 Responses 和 Messages。
不为尚未出现的需求搭建插件市场或任意脚本扩展机制；非兼容私有协议需单独开发适配器。

## 2. 从 Pi 学习什么

| 设计思路 | 在 PromptTune 中的实现方式 |
| --- | --- |
| Provider 与 Model 分开 | 一个供应商配置包含地址和凭据引用，一个模型声明自己的协议与能力。 |
| 内置目录与用户覆盖 | 内置预设、发现列表、手动模型和字段覆盖分层合并。 |
| 可用性与模型列表分开 | “目录里存在”不代表“有凭据、协议受支持、可成功请求”。 |
| 能力约束请求参数 | 按模型能力发送 JSON、流式、采样和思考参数。 |
| 凭据与配置独立 | 凭据加密保存，配置只保存引用，导出可脱敏。 |

Pi 的当前上游为 [earendil-works/pi](https://github.com/earendil-works/pi)，旧 `badlogic/pi-mono` 地址已重定向。
详细核对的源文件和固定提交见 [调研记录](RESEARCH.md)。

## 3. 模块职责

```text
UI：供应商列表 / 模型选择 / 任务模型 / 连接状态
          ↓ 白名单 IPC
ModelService
  ├─ ProviderStore       配置、schema 版本、迁移和导入导出
  ├─ CredentialVault     密钥保存、删除、引用和解析
  ├─ ModelRegistry       列表、缓存、合并、能力与可用性
  ├─ DiscoveryService    各供应商发现模型的请求与转换
  ├─ TaskModelResolver   translate / tune / summarize 的绑定
  └─ RequestExecutor     协议路由、限流、取消、重试和用量
       └─ ProtocolAdapters：chat-completions / responses / messages
```

对业务层提供稳定接口：`listProviders`、`listModels`、`refreshModels`、`testConnection`、`resolveTaskModel`、`generate`、`cancel`。
业务层只提供任务、文本、模板和输出约束；供应商参数与 SSE 解析封装在模型层。
适配器输出统一事件：`started` / `text_delta` / `usage` / `completed` / `error`。
`completed` 表示网络响应完整；业务 schema 校验通过后才表示一次有效处理。

## 4. 配置数据

| 对象 | 必要字段或行为 |
| --- | --- |
| ProviderConfig | 稳定实例 ID、显示名、preset、baseUrl、默认 protocol、credentialRef、enabled、超时。 |
| ModelConfig | providerId + 原始 modelId、显示名、protocol override、启用/收藏、能力、限制、兼容配置。 |
| TaskBinding | translate / tune / summarize 各自的 providerId、modelId、参数和可选备用模型。 |
| CredentialRef | keychain 引用或显式环境变量引用；服务无需认证时可设为 none。 |
| CapabilityValue | supported / unsupported / unknown，附来源和最近确认时间。 |

模型能力包括 text、stream、JSON object/schema、thinking、temperature、最大输入/输出等。
目录价格和 token 限制均附更新时间与来源；未知价格显示未知，不按零元统计。
模型标识使用 `(providerInstanceId, modelId)`，不能只用 modelId；同服务可配置多个账号或网关。
ModelConfig 使用独立保存的原始 modelId 发请求，不随意附加或拆掉 OpenCode CLI 的供应商前缀。

每个配置带 `schemaVersion`，读取严格校验，迁移前备份；保存采用事务或原子替换。
导入前展示供应商、地址和覆盖变化；配置文件不接受可执行命令。
自定义 headers 中的敏感值同样以加密引用保存；UI 只显示密钥是否存在及脱敏提示。
用户在密钥输入框提交后立即清空，主进程不再将解密后的已存密钥返回渲染进程。

## 5. 供应商预设与发现

| 预设 | Base URL | 发现入口 | 首轮协议 |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `/models` | chat-completions |
| OpenCode Zen | `https://opencode.ai/zen/v1` | `/models` | 按模型元数据路由；先启用 chat-completions。 |
| OpenCode Go | `https://opencode.ai/zen/go/v1` | `/models` | 按模型元数据路由；先启用 chat-completions。 |
| Third-party | 用户填写 API 根地址 | 兼容 `/models`，可禁用发现 | 用户明确选择已支持协议。 |

地址与协议来自 [DeepSeek 文档](https://api-docs.deepseek.com/api/list-models/)、[OpenCode Zen](https://opencode.ai/docs/zen/) 和 [OpenCode Go](https://opencode.ai/docs/go/)，实现时重新验证。
API 根地址允许包含 `/v1` 或网关子路径；统一拼接 endpoint，避免重复 `/v1` 和丢失子路径。
HTTPS 为默认；本地兼容服务允许 loopback HTTP，远程 HTTP 需用户明确配置。
每个预设有独立认证和发现规则；网关的 header 要求在适配时逐项验证。

发现策略：

1. 应用启动立即读上次成功缓存，后台只在缓存过期时刷新；提供手动“刷新模型”。
2. 第一版默认 24 小时缓存，按供应商实例分别记录时间和错误。
3. `/models` 不支持时允许手动填写 model ID，不把“发现失败”等同于“生成不可用”。
4. 发现返回缺少协议或能力时标记 unknown，使用已核对的供应商目录补齐，或让用户显式配置。
5. 不能仅根据 GPT / Claude / Gemini 等名字前缀猜协议；OpenCode Zen 与 Go 对同名模型也可能有不同路由。
6. 刷新失败保留旧列表与手动模型；刷新成功后标记失踪项待核验，不直接删除用户绑定。

模型目录合并顺序：内置预设目录 → 最近成功发现数据 → 手动模型 → 用户字段覆盖。
能力测试结果按 provider/model/protocol/baseUrl 记录；更换地址、模型协议或凭据后使相关状态过期。
用户禁用/收藏/覆盖不被刷新抹掉。所有合并结果附来源，避免手动配置被无提示替换。

## 6. 协议适配与供应商差异

| 协议 | 路由 | 实现要点 |
| --- | --- | --- |
| chat-completions | `/chat/completions` | messages、content delta、usage、finish reason，字段兼容可配置。 |
| responses | `/responses` | input、输出事件、最终文本、usage 和中断状态独立解析。 |
| messages | `/messages` | system 与 messages 分离、内容块、SSE 事件及供应商认证要求。 |

OpenCode 官方列出了多种 endpoint；只支持 Chat Completions 时，仅启用明确兼容的模型。
Responses / Messages 原生模型在对应适配器完成前显示原因并不可选；Gemini 原生和分类/图像模型暂不启用。
协议适配器一次只处理文本生成，不加入 tools、Agent 循环或多模态任务。

DeepSeek 预设按官方 [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/) 使用非思考参数作为翻译/微调默认值。
该供应商专用字段不能自动传播到任意第三方服务；不支持关闭思考的模型如实显示其限制。
结构化输出根据已知能力选择 JSON schema / JSON object / 提示约束 JSON，最后均通过业务 schema 校验。
[DeepSeek JSON 文档](https://api-docs.deepseek.com/guides/json_mode/)要求提示中明确说明 JSON；空结果和输出截断仍需独立处理。

兼容配置按需要增加：token 字段名、是否接受 temperature、usage streaming、system role、JSON 模式和思考开关。
不盲目发送 max_tokens、temperature、thinking 等参数；遇到“不支持参数”需明确诊断，再由受控规则或用户修改。
扩展参数不能覆盖 model、输入正文、认证 header 或取消信号等核心字段。

## 7. 模型管理界面

供应商页包含：新增预设/自定义服务、修改名称和地址、保存/删除密钥、启用/停用、测试连接、刷新模型和删除配置。
模型页包含：按供应商分组、搜索、收藏、显示协议/能力/上下文/价格来源、手动添加与字段覆盖。
任务模型页分别绑定翻译、微调和总结；总结可选择更便宜的模型，也可沿用前台模型。
删除被绑定的模型或供应商时先选择替代或清除绑定，不静默改变发送目的地。

状态区分：未配置凭据 / 待测试 / 可用 / 鉴权失败 / 限流 / 不支持协议 / 列表过期 / 模型失效。
“测试连接”先做轻量认证或列表测试；“测试生成”才发送一条简短固定文本并说明会产生少量用量。
接口可达、密钥有效、模型有访问权限与生成能力是不同状态，UI 分别呈现。
默认不跨供应商自动失败切换；备用模型是用户主动配置的任务绑定，启用时显示目标和可能费用。
已经收到部分输出时停止自动切换，避免混合两个模型的结果。

## 8. 可靠性与用量

- 请求级超时可配置；流式请求另设无数据超时，取消立即中止读取和重试。
- 429、部分网络错误和 5xx 有限退避，尊重 Retry-After；401、403、参数错误不自动重试。
- 未开始输出且可安全重试时最多自动重试两次；记录 attempt 和费用的不确定性。
- 前台优先，默认一个后台总结任务；供应商各自管理并发和限流状态。
- 配置修改仅影响后续请求；在途请求固定使用开始时的供应商、模型与参数快照。
- 优先保存供应商实际 usage；未返回用量时标明未知，token 估算与实际数值分别展示。
- 费用是按已知目录价格计算的估算，附币种与更新时间；订阅型 OpenCode Go 不冒充精确账单。
- 后台总结可设每日调用/token 上限及已知价格下的估算费用上限，达到后暂停并在 UI 显示状态。

所有用户文本只发往当前任务绑定的服务，诊断日志默认不写原文和认证信息。
凭据通过 [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) 保存；加密不可用时采用仅本次会话保存并明确显示状态。

## 9. 测试重点

注册表：供应商实例隔离、列表合并、字段优先级、未知能力、刷新失败和模型失踪。
配置：迁移、导入导出脱敏、非法 URL、重复 ID、绑定删除和热更新。
适配器：脱敏协议 fixtures、SSE 跨块切分、非文本事件、usage、截断、错误与取消。
任务：三种任务绑定相互独立，重试不重复计数，后台总结不抢占前台。
真实 smoke test：DeepSeek、OpenCode Zen/Go 可访问的兼容模型，以及用户配置的第三方服务；不要求开发者在 CI 提交密钥。

实现顺序：类型/schema → 凭据与配置 → 注册表/发现 → Chat Completions → 连接测试/UI → 任务绑定 → 按需增加其他协议。
