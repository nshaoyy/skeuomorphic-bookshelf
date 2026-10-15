# 拟物书架 · Skeuomorphic Bookshelf

把书架照片变成可以浏览、可以整理的线上书架。用你自己的视觉模型和生图 API，部署在你自己的电脑或服务器上。

*Turn a photo of your bookshelf into a browsable online shelf, using your own vision and image-generation API. English below.*

## 为什么做这个

说实话，这是给实体书爱好者装逼用的。我有哪些书，罗杰·泽拉兹尼还有哪本没买，《地海巫师》有哪两个版本，我自己门清，不需要工具帮我记。可我挑书、攒书的品味，全在家里的书架上，没法随身带着给人看。拍张照片发出去吧，书脊歪的歪、反光的反光，看不清，质感也丢了，硬装。

拟物书架就是解决这个的，让实体书爱好者可以优雅地装逼：对着书架拍一张，得到一个链接，打开就是一面像模像样的书架。认书、扶正、录入交给模型，人只管挑书，和体面地炫耀挑过的书。

## 它做什么

1. 你拍一张书脊朝外的书架照片上传。
2. 视觉模型找出照片里每一本书的书脊，按书架的阅读顺序（从上到下、从左到右）排好。
3. 每本书的书脊被透视校正、裁出来，再由视觉模型读出书名和作者。
4. 可选：生图模型把书脊重绘成干净、正面的“书脊图”，视觉模型再核对一遍书名没有被改动。
5. 通过的书放上你的书架。你可以修改书名、作者、阅读状态、日期和笔记。

## 先说清楚：识别效果取决于你的模型和提示词

仓库自带一套**基础提示词**，能跑通流程，但**没有针对任何具体模型调优**。不同模型在定位书脊、读竖排中文、重绘书脊上的差别很大。想要好的效果，请换成你自己的模型，并调整提示词（见下文“自定义提示词”）。

## 快速开始

需要 Node.js 22.18 或更新版本（直接运行 TypeScript，不需要构建）。

```bash
git clone https://github.com/nshaoyy/skeuomorphic-bookshelf.git && cd skeuomorphic-bookshelf
npm install
cp .env.example .env    # 填入你的 API 地址、密钥和模型
npm start               # 打开 http://127.0.0.1:8787
```

不想花钱、只想先看看效果：`node test/demo-server.ts` 会用本地模拟的模型启动一个预置了示例书架的演示站（不联网、不需要密钥）。

## 配置

全部通过环境变量（或 `.env` 文件）设置，完整说明见 [`.env.example`](.env.example)。

| 变量 | 说明 |
|---|---|
| `VISION_BASE_URL` / `VISION_API_KEY` / `VISION_MODEL` | 任何兼容 OpenAI `/chat/completions`、支持图片输入的服务（如 OpenAI、火山方舟、阿里云百炼） |
| `IMAGE_API_STYLE` | `none`：不生图，直接用校正后的照片裁图当书脊（最省钱）；`openai-edits`：OpenAI 风格 `/images/edits`；`json-image`：`/images/generations` + `image` 字段（如火山方舟 Seedream） |
| `IMAGE_BASE_URL` / `IMAGE_API_KEY` / `IMAGE_MODEL` / `IMAGE_SIZE` | 生图服务 |
| `MAX_BOOKS_PER_PHOTO` | 每张照片最多处理几本，默认 10，其余标记为“本次未处理”且不产生费用 |
| `MAX_PHOTOS_PER_DAY` | 每 24 小时最多上传几张照片，默认 20 |
| `SHELF_PASSWORD` / `SHELF_PUBLIC` | 修改书架需要的密码；`SHELF_PUBLIC=true` 时任何人可以看书架 |
| `HOST` / `PORT` / `DATA_DIR` | 监听地址（默认只监听本机 `127.0.0.1`）、端口、数据目录 |

**每本书大约调用多少次模型**：1 次识别；生图模式下另加 1 次生图和 1 次核对；每张照片另加 1 次书脊定位。

## 自定义提示词

在 `DATA_DIR/prompts/` 下放 `detect.txt`、`identify.txt`、`spine.txt`、`check.txt` 中的任意几个，就会替换对应的默认提示词（默认内容见 [`src/prompts.ts`](src/prompts.ts)）。返回格式必须与默认提示词要求的 JSON 一致。

## 隐私与安全

- 照片的拍摄位置等元数据（EXIF/XMP/IPTC）在**浏览器上传前**去除，服务器保存前**再去除一次**；只保留照片方向。
- 上传前会弹窗确认照片将发送给你配置的 AI 服务。
- 原始照片只保存在你的数据目录里，**永远不会通过网页对外提供**；网页只提供书脊图。
- 不设 `SHELF_PASSWORD` 时只允许监听本机；要对外开放必须设置密码。修改操作校验来源，页面带严格的 CSP。
- 你的照片会被发送给**你自己配置的**模型服务商，请了解对方的数据政策。

## 数据

全部在 `DATA_DIR`：`shelf.db`（SQLite）和 `files/`（照片与书脊图）。备份就是复制这个目录。

## 开发

```bash
npm test          # 15 项测试，全部使用本地模拟的模型接口，不联网、不产生费用
npm run typecheck
```

代码结构：`src/server.ts`（HTTP 与鉴权）、`src/pipeline.ts`（照片 → 书）、`src/providers.ts`（模型接口）、`src/prompts.ts`（提示词）、`src/db.ts`（SQLite）、`src/image/`（解码、透视校正、元数据去除）、`public/`（网页，无需构建）。

## 参与贡献

目前暂不接受代码合并请求，欢迎提 issue：bug、建议，以及你调好的提示词和模型组合。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[GNU AGPL-3.0](LICENSE)。如果你修改后以网络服务的形式提供给他人使用，需要向这些用户提供你修改后的源代码。第三方代码的许可证见 [NOTICE](NOTICE)。

---

## English

### Why

Honestly, it's for book lovers who like to show off. I know exactly what I own — which Roger Zelazny I'm still missing, which two editions of *A Wizard of Earthsea* are on my shelf. I don't need an app to remember. But my taste in choosing and collecting books lives on the shelves at home, and I can't carry it around. A photo doesn't cut it: the spines are tilted, there's glare, you can't read them, the texture is gone. It just looks like trying too hard.

Skeuomorphic Bookshelf lets book lovers show off, gracefully: take one photo of a shelf, get a link that opens onto a shelf that actually looks like one. Models do the recognizing, straightening and cataloguing; you just choose the books — and show them off with a little dignity.

### What it does

Skeuomorphic Bookshelf turns a photo of your bookshelf into an online shelf. A vision model finds each spine (in reading order), the spine is perspective-corrected and read for title and author, and optionally an image model redraws it as a clean flat spine that the vision model double-checks. You bring your own OpenAI-compatible vision API and, optionally, an image API.

**Results depend heavily on your models and prompts.** The bundled prompts are a working baseline, not tuned for any model. Override them by placing `detect.txt`, `identify.txt`, `spine.txt` or `check.txt` in `DATA_DIR/prompts/`.

Quick start: Node.js ≥ 22.18, `npm install`, copy `.env.example` to `.env`, `npm start`. Offline demo with a fake model: `node test/demo-server.ts`. Tests (`npm test`) never call a real provider.

Contributing: pull requests aren't being accepted for now; issues, bug reports and prompt/model recipes are very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

Privacy: location/capture metadata is stripped in the browser and again on the server; original photos are never served; without `SHELF_PASSWORD` the server only listens on localhost. Licensed under AGPL-3.0.
