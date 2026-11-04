# ChatGPT 自动生图与下载助手

面向 ChatGPT 网页的提示词队列、自动生图、下载和图片管理扩展，也兼容 Gemini。当前版本 **3.9.3**。

这是第三方工具，与 OpenAI、Google 及其站点无隶属关系。生成能力、账号权限、额度和验证码由相应站点提供。

## 安装

1. 下载本仓库 releases 目录中的 `chatgpt-automation-workbench-3.9.3.zip` 并完整解压。
2. 打开 Chrome 扩展管理页，开启开发者模式，选择“加载已解压的扩展程序”，选中解压后的目录。
3. 打开或刷新 ChatGPT / Gemini，点击扩展图标展开工作台。

也可下载完整源码后直接加载本仓库的 `extension` 文件夹。基础功能无需 Node.js、源码构建、本机服务或私有配对。当前 ZIP 是可安装发布包；Chrome 商店状态以实际条目为准。

## 使用流程

点击“新建任务” → 填写提示词（多项用空行分隔） → 加入队列 → 检查后点击“开始队列”。扩展逐项提交、等待生成、归档并下载。运行期间保留网页打开，不要同时手工发送消息。

- 支持参考图、图片/文字任务及生成参数。
- 图库提供小图、中图、大图、列表，支持描述编辑、筛选、分页和批量下载。
- 顶栏“布局”提供嵌入/悬浮、宽度调整，以及展开状态和宽度的自动恢复。
- 下载子目录可在设置中保存，文件由 Chrome 的下载目录管理。
- 已提交且结果不明确的任务进入“待核对”，不会自动重新提交。

本仓库公开浏览器扩展源码和可安装包，不包含开发机配置、浏览器数据、私有配对或内部验收资料。Windows 自选目录、SQLite、Webhook 和 MCP 属于需要另行安装服务的可选增强，配套服务程序未包含在该 ZIP 内。

## 数据与校验

[隐私说明](PRIVACY.md) · [完整使用说明](extension/INSTALL.md) · [来源与许可](NOTICE.md)

发布包 SHA-256：`e6dd8dee733b17d61ff7e69cde520ccdd3c1c6a70d6ac6bd32f7866fa11d15cd`。逐文件指纹见 release-manifest.json，可用 `python tools/verify_release.py` 校验 ZIP 与源码。

公开源码源于 MIT 项目 [aleixmedina9-gif/chatgpt-prompt-queue](https://github.com/aleixmedina9-gif/chatgpt-prompt-queue)，保留原 LICENSE 和来源声明。
