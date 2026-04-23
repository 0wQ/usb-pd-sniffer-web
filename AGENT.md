# usb-pd-sniffer-web-v2 Agent Notes

## 1) 当前目标

- 这里是新一版重构工作区。
- 当前优先级不是兼容旧 `usb-pd-sniffer-web`，而是先把 `pd-core-v2` 的输入输出模型做对。
- `pd-web-v2` 暂时应直接面向 `pd-core-v2` 输出，不要再加旧 core projection。

## 2) 参考顺序

后续所有 `pd-core-v2` 解码补全，按这个顺序核对：

1. `/.tmp/USB_PD_R3_2_V1.1_2024-10.txt`
   - 主标准。
   - 用于确定协议名词、字段名、bit 范围、reserved/deprecated 规则、单位、解释性描述。

2. `/.tmp/USB_PD_Parser_API_Py`
   - 用于核对具体怎么拆字段、怎么拆 PDO/RDO/VDM/Extended payload。
   - 可以帮助确认规范 txt 抽取不稳定时的实际拆法。

3. `/.tmp/UCPD-Monitor`
   - 只做第三参考。
   - 可借鉴某些解析实现，但不能反过来主导 `pd-core-v2` 的模型。
   - 不要把它的 host record、tree row、UI summary 直接搬进 core。

另见：
- [docs/planning/pd-core-v2-reference-policy.md](/Users/sora/project/usb-pd-sniffer-v4/usb-pd-sniffer-web-v2/docs/planning/pd-core-v2-reference-policy.md)

## 2.1) 规范载体使用规则

- `/.tmp/USB_PD_R3_2_V1.1_2024-10.txt` 适合做术语搜索、章节定位、关键字检索。
- 但遇到位域表、跨列表格、附录表头、脚注混排时，不要只信 txt 抽取结果。
- 对这类内容，必须回到原始 PDF 页面核对：
  - 原始 PDF: `/.tmp/USB_PD_R3_2 V1.1 2024-10.pdf`
  - 可先用 txt 定位，再用 PDF 原页确认字段边界、表头归属、reserved/deprecated 说明。
- 如果纯文本无法稳定理解表结构，可以直接截取 PDF 页面并按图片方式理解。
- 这一步是允许且推荐的，不算“跳过规范”；它本质上是在看更可靠的规范原件。

## 3) pd-core-v2 边界

- `pd-core-v2` 只负责协议解码。
- 不要在 core 里混入 UI row、table alias、host transport record、app summary。
- 如果字段缺上下文才能唯一解释，先输出显式 candidate interpretation，不要猜。
- reserved / deprecated 字段要保留可见，并通过非阻塞 `issues` 提示。
- 名词尽量跟规范一致，除非只是做必要的轻量规范化。

## 4) 当前输出模型

当前主模型是：

- `DecodedMessage`
- `sections[]`
- `Section.fields[]`
- `Section.issues[]`

每个 `Section` 应尽量具备：

- `title`
- `semanticKind`
- `byteOffset`
- `byteLength`
- `rawBytes`
- `rawValue`
- `fields`
- `issues`

每个 `BitField` 应尽量具备：

- `bitStart`
- `bitLength`
- `rawValue`
- `decodedValue`
- `displayValue`
- `note`

目标是支撑 ET240 类展示，而不是旧 core 那种 summary/object 投影。

## 5) pd-web-v2 边界

- `pd-web-v2` 目前是新 core 的直接消费者。
- `DecodeCard` 应优先做通用 `section/field` renderer，不要为每种消息堆特判 UI。
- `TableCard` 先尽量显示 core 原始值，不做太多 alias。
- 如果某条消息还没深度解码，web 应该正常展示 raw bytes / raw value / section，而不是在 view 层偷偷补协议语义。

## 6) 当前方向

当前结构方向已经从旧的 `summary/payload/objects` 转向更接近 ET240 的：

- `Message Header`
- `Extended Message Header`
- `Payload Section`
- `Object / Block Section`
- `Bit Field List`

所以后续重点是继续补 **语义覆盖**，不是再次推翻输出结构。

优先顺序：

1. `Structured VDM` 后续 `VDO`
2. `Extended Message payload`
3. `Request` 结合上下文收敛唯一解释
4. 更多常见 Data / Extended message 的 bit-level 解码

## 7) 避免走回旧路

- 不要为了 web 先去修改 core 成“更像 UI 需要的样子”。
- 不要为了兼容旧项目加 projection 层。
- 不要把 `UCPD-Monitor` 或 Python parser 的展示模型直接搬进 core。
- 不要把 SOP/reset/error/debug 等 monitor envelope 概念混进纯 PD message 结构。

## 8) 本工作区常用命令

- `bun run --cwd usb-pd-sniffer-web-v2/packages/pd-core typecheck`
- `bun run --cwd usb-pd-sniffer-web-v2/packages/pd-core build`
- `bun run --cwd usb-pd-sniffer-web-v2/packages/pd-web build`

## 9) 修改约定

- 优先使用 `rg` 搜索。
- 优先用 `apply_patch` 修改文件。
- 改解码前，先查规范，再查 `USB_PD_Parser_API_Py`，最后再看 `UCPD-Monitor`。
- 如果规范 txt 对表格/位域理解不稳定，允许直接回到 PDF 原页，必要时做页面截图后按图片理解。
- planning 文档保持单一职责：
  - `coverage` 类文档只记录进度和状态，不混入大段方法论、来源盘点或讨论过程。
  - 参考顺序、方法约束、设计原则写到独立 policy 文档。
- `docs/planning/pd-core-v2-coverage-by-type.md` 的用法：
  - 它是分支级进度板，不是设计文档，不是讨论记录。
  - 开工前先看目标分支当前状态。
  - 完成一个分支后再更新状态，不要边做边把半成品写成 `Done`。
  - 新增分支时只补分支名、状态、简短备注，不把实现过程塞进去。
  - 一个分支要按“补到底”方式推进，避免同时把多个分支都停在半成品。
