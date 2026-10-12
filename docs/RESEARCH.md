# GitHub 调研与复用方案

- 调研日期：2026-10-11（America/Los_Angeles）
- 方法：联网检索 GitHub、通过 GitHub API 核对仓库元数据/许可证，并阅读固定提交的文档和关键源码。
- 用途：指导开发计划；本次没有复制第三方应用代码进入 PromptTune。

## 1. 结论

模型层学习 Pi 的职责划分，自研范围受控的管理模块；桌面层采用 Electron，优先提取 MIT 项目的小型窗口/快捷键逻辑。
悬浮翻译项目用于研究交互与平台行为；逐个核对 LICENSE，不仅依据 README 或 package.json 的声明判断复用条件。

## 2. 候选项目

| 项目                                                                        | 核对结果                                                    | 对本项目的价值                                                | 采用方式                                                     |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| [Pi](https://github.com/earendil-works/pi)                                  | MIT，TypeScript；旧 badlogic/pi-mono 重定向到这里。         | 供应商、模型目录、能力、凭据与请求运行时的分层。              | 学习设计，自研轻量模型层；不依赖 Pi SDK。                    |
| [Ueli](https://github.com/oliverschwendener/ueli)                           | MIT，Electron + TypeScript。                                | 快捷键呼出、焦点恢复、窗口管理、托盘与平台配置。              | 优先提取必要小模块，保留版权与许可；不搬入完整模块注册系统。 |
| [Witsy](https://github.com/Kochava-Studios/witsy)                           | AGPL-3.0，Electron；旧 nbonamy/witsy 的 README 指向新仓库。 | Prompt Anywhere、输入/输出面板和独立设置窗。                  | 参考交互，不直接复制实现代码。                               |
| [FloatQuickTrans](https://github.com/hughedward/FloatQuickTrans)            | LICENSE 为 AGPL-3.0；README 底部却写 MIT，存在不一致。      | Electron + React 的轻量翻译悬浮窗、置顶、全屏可见性与快捷键。 | 依据实际 LICENSE 处理，仅研究交互和平台行为。                |
| [Pot Desktop](https://github.com/pot-app/pot-desktop)                       | GPL-3.0，Tauri + React。                                    | 翻译窗/配置窗分离、多语言、托盘、历史和热键。                 | 借鉴功能组织；不移植 Rust/Tauri 窗口代码。                   |
| [NextAI Translator](https://github.com/nextai-translator/nextai-translator) | AGPL-3.0，原 yetone/openai-translator 已重定向。            | 翻译、润色、历史和双语入口的交互组织。                        | 参考模式设计，不复制实现。                                   |
| [QTranslate](https://github.com/yousfhidan/QTranslate)                      | package.json 声明 MIT，仓库没有独立 LICENSE。               | Windows 浮动入口及弹窗。                                      | 当前不列为直接代码复用来源。                                 |

MIT 项目中的依赖与资源仍按各自许可证处理。所有实际复制/改写的源文件记录仓库、提交、原始路径与版权，并随应用提供第三方声明。

## 3. Pi：已阅读源码与本项目取舍

固定提交：`4270522473e677ddba7b093caa0064a3df51d459`。

- [模型选择与配置文档](https://github.com/earendil-works/pi/blob/4270522473e677ddba7b093caa0064a3df51d459/packages/coding-agent/docs/models.md)
- [pi-ai 文档](https://github.com/earendil-works/pi/blob/4270522473e677ddba7b093caa0064a3df51d459/packages/ai/README.md)
- [模型集合](https://github.com/earendil-works/pi/blob/4270522473e677ddba7b093caa0064a3df51d459/packages/ai/src/models.ts)
- [ModelRegistry](https://github.com/earendil-works/pi/blob/4270522473e677ddba7b093caa0064a3df51d459/packages/coding-agent/src/core/model-registry.ts)
- [ModelRuntime](https://github.com/earendil-works/pi/blob/4270522473e677ddba7b093caa0064a3df51d459/packages/coding-agent/src/core/model-runtime.ts)
- [Provider Composer](https://github.com/earendil-works/pi/blob/4270522473e677ddba7b093caa0064a3df51d459/packages/coding-agent/src/core/provider-composer.ts)
- [AuthStorage](https://github.com/earendil-works/pi/blob/4270522473e677ddba7b093caa0064a3df51d459/packages/coding-agent/src/core/auth-storage.ts)

采用 Provider/Model 分离、配置覆盖、目录缓存和能力约束；凭据改为本项目的加密引用。
PromptTune 不读取 Pi auth.json、不执行配置中的 shell 命令，也不引入 Agent 的工具和会话机制。
仅支持用户所需的三类服务来源，通过统一业务接口和少量协议适配器实现。

## 4. Ueli：优先复用的桌面逻辑

固定提交：`7543c1f76c37e6a60741ab5ed429e2afa3207712`。

- [BrowserWindowToggler](https://github.com/oliverschwendener/ueli/blob/7543c1f76c37e6a60741ab5ed429e2afa3207712/src/main/Core/SearchWindow/BrowserWindowToggler/BrowserWindowToggler.ts)：区分可见且聚焦、隐藏和显示；包含 Windows minimize/restore 的焦点处理。
- [SearchWindowModule](https://github.com/oliverschwendener/ueli/blob/7543c1f76c37e6a60741ab5ed429e2afa3207712/src/main/Core/SearchWindow/SearchWindowModule.ts)：窗口职责、失焦隐藏、设置窗例外、快捷键和设置同步。
- [GlobalShortcutModule](https://github.com/oliverschwendener/ueli/blob/7543c1f76c37e6a60741ab5ed429e2afa3207712/src/main/Core/GlobalShortcut/GlobalShortcutModule.ts)：快捷键生命周期。
- [macOS 窗口配置](https://github.com/oliverschwendener/ueli/blob/7543c1f76c37e6a60741ab5ed429e2afa3207712/src/main/Core/SearchWindow/BrowserWindowConstructorOptionsProvider/MacOsBrowserWindowConstructorOptionsProvider.ts)：平台相关外观参数。
- [MIT LICENSE](https://github.com/oliverschwendener/ueli/blob/7543c1f76c37e6a60741ab5ed429e2afa3207712/LICENSE)

移植范围以独立窗口切换/快捷键辅助逻辑为主，移除 Ueli 自己的模块注册依赖。
安全配置独立按 Electron 官方建议实现，不照搬参考文件里为开发环境关闭 webSecurity 的配置。
全屏 panel 并非 Ueli 已为本项目验证的能力，必须独立做 macOS 原型验证。

## 5. 悬浮交互参考源码

- Witsy [Prompt Anywhere](https://github.com/Kochava-Studios/witsy/blob/c81c7de417a6362825bced2e865184d6e3fb73ba/src/main/windows/anywhere.ts)：面板边界、获得/释放焦点、窗口尺寸与输入输出交互。
- FloatQuickTrans [主进程窗口逻辑](https://github.com/hughedward/FloatQuickTrans/blob/3ef4a3187922f2f3e2e3c70251e312dbd84c31a5/src/main/index.ts)：使用 panel、floating 层级、全屏空间可见和全局快捷键。
- Pot [window.rs](https://github.com/pot-app/pot-desktop/blob/594d32ede96acd106b0256deaa8bb440ffcdff40/src-tauri/src/window.rs) 与 [hotkey.rs](https://github.com/pot-app/pot-desktop/blob/594d32ede96acd106b0256deaa8bb440ffcdff40/src-tauri/src/hotkey.rs)：多窗口角色和翻译入口组织。

建议交互：顶部两个明确模式、简洁输入/输出、复制主按钮、改动解释默认收起，历史/总结/设置使用独立窗口。
置顶可固定，未固定时失焦隐藏需要尊重输入法候选窗和应用内弹层；编辑/生成期间保留草稿，隐藏不自动丢弃结果。

## 6. 官方技术依据

| 来源                                                                                | 本项目使用的结论                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) | 窗口层级和跨空间 API 有平台差异；用实机验证全屏与输入法，不默认最高置顶。 |
| [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)       | context isolation、sandbox、IPC 校验与限制导航。                          |
| [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)     | 使用系统能力保护密钥；加密可用性需检测。                                  |
| [electron-vite](https://electron-vite.org/guide/)                                   | 管理 main / preload / renderer 三个构建入口。                             |
| [i18next 配置](https://www.i18next.com/overview/configuration-options)              | 显式语言、支持语言和回退配置。                                            |
| [SQLite Transaction](https://www.sqlite.org/lang_transaction.html)                  | 原子保存前台记录、后台批次与证据聚合。                                    |
| [DeepSeek Models](https://api-docs.deepseek.com/api/list-models/)                   | 模型列表与可用元数据；具体字段在适配时校验。                              |
| [DeepSeek Thinking](https://api-docs.deepseek.com/guides/thinking_mode/)            | 翻译/微调优先关闭思考；参数属于供应商适配。                               |
| [DeepSeek JSON](https://api-docs.deepseek.com/guides/json_mode/)                    | JSON 参数需配合明确的格式提示；仍处理空内容与截断。                       |
| [OpenCode Zen](https://opencode.ai/docs/zen/) / [Go](https://opencode.ai/docs/go/)  | 两个目录端点分开管理，模型请求按实际 endpoint 路由。                      |

模型 ID、价格、可用模型和协议映射会变化，使用运行时发现与可更新目录；不把此次检索到的型号列表永久写死在 UI。
