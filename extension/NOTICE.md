# 来源与许可

本项目是 [aleixmedina9-gif/chatgpt-prompt-queue](https://github.com/aleixmedina9-gif/chatgpt-prompt-queue) 的 MIT 派生版。基础提交 `cedeeba36ba5028742afe00be00b9bf2d1976033`，原版本 2.3.2。保留原 LICENSE 与来源声明。当前展示名为“ChatGPT 自动生图与下载助手”，原展示名“创作图片库 · Open”保留为升级识别；PNG 图标由本项目经 Codex 原生 ImageGen 独立生成，原图与来源校验保存在开发设计目录，不随扩展分发。

3.0.0 重构了队列状态与后台下载调度，新增图片数据库、参考图、图库、会话/工作区导出与本机知识库接入。可见 DOM 输入、队列和浮动面板的思路来自上游。界面与后台按本项目需求重构。

3.1.0 依据本项目 PRD/OpenSpec 增加检查点往返、工作区引用验证、未知上传对账和批量逐项结果/取消/失败重试，OpenSpec 仅为开发依赖。

2026-10-21 MCP 开发构建新增本机调用桥接与专用私有库工作流。Node 端使用官方 @modelcontextprotocol/server 2.3.1（Apache-2.0）、ws（MIT）和 zod（MIT）；这些依赖由 npm 安装，未打入 Chrome 扩展 ZIP。保留各依赖随包提供的许可证。

ChatGPT Automation Toolkit 仅作为公开功能参考。本项目不含该商业扩展的私有代码、素材、品牌授权、支付或许可证实现。本项目不隶属于 OpenAI 或原商业扩展的开发者。

ChatGPT、OpenAI、Gemini 与 Google 名称仅用于说明所兼容的站点，不表示官方产品、合作或授权关系。
