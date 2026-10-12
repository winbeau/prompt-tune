# PromptTune

保留原意，调准英文 Prompt，并从日常使用中总结反复出现的表达问题。

Translate Chinese prompts, lightly tune English prompts, and learn from recurring expression patterns.

## 核心功能 / Features

| 功能 | 行为 |
| --- | --- |
| **Translate · CN → EN** | 将中文需求翻译为清晰、自然的英文 Prompt，保留约束和技术术语。 |
| **Tune · EN → EN** | 以最小必要改动修正英文 Prompt 的语法、用词和表达，保持原意和语气。 |
| **中英文界面 / Bilingual UI** | 支持简体中文、英文和跟随系统，界面语言与处理模式独立。 |
| **模型管理 / Model management** | 自研轻量模型层，支持 DeepSeek、OpenCode Zen/Go 和兼容协议的第三方 API。 |
| **历史与总结 / History & insights** | 保存处理记录；默认每 10 个有效轮次后台总结一次，持续归纳表达习惯。 |
| **桌面悬浮 / Floating panel** | 快捷键呼出、置顶、复制结果、托盘入口和独立设置窗口。 |

## 项目状态 / Status

目前完成项目初始化和开发规划，尚未实现应用代码。

The repository currently contains the development plan; the application is not implemented yet.

- [开发计划](docs/DEVELOPMENT_PLAN.md)：产品规则、架构、开发顺序和验收标准。
- [模型管理设计](docs/MODEL_MANAGEMENT.md)：自研模型层的职责、配置和协议适配。
- [GitHub 调研与复用方案](docs/RESEARCH.md)：Pi、Ueli 和悬浮翻译工具的源码参考。

拟采用 Electron + TypeScript + React，macOS 优先，随后验证 Windows。
Pi 仅作为模型管理设计参考；运行时使用本项目自己的模型层。

## License

[MIT](LICENSE) · Copyright (c) 2026 winbeau
