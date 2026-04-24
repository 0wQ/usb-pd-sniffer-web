# pd-core-v2 Context And Assemble Policy

Date: 2026-04-23

这份文档记录 `pd-core-v2` 中“上下文增强解析”和“Chunked Extended Message 拼包”的约定。

它是行为/边界文档，不是进度板。

## 1. 目标

- 保持 `pd-core-v2` parse-first、protocol-only。
- 允许调用方在显式提供有效上下文时获得更丰富的解析结果。
- 避免对不完整 chunk 数据做不安全的语义展开。
- 不让表格/列表渲染被迫依赖全局 sequence 状态。

## 2. 范围

这份文档适用于：

- 可选的上下文增强消息解析
- Chunked Extended Message 的字节级拼包
- `pd-core-v2` 与 `pd-web-v2` 等上层之间的职责边界

这份文档不定义：

- UI 布局
- transport / session 身份
- host 侧 buffer 的具体实现
- 具体 TypeScript helper 命名

## 3. 术语

- `single-frame decode`
  - 只解析当前帧。
- `context-assisted decode`
  - 调用方显式提供外部上下文后，对当前帧做增强解析。
- `assembled prefix`
  - 已从 chunk `0..N` 重组出的字节前缀，但总长度仍小于 Extended Message 的 `Data Size`。
- `complete assembled payload`
  - 已重组出的字节长度达到或超过声明的 `Data Size`。
- `prefix-decodable`
  - 可以基于“已拼出的前缀”安全解析前部完整单元的消息族。
- `full-assemble-only`
  - 在完整 payload 拼齐前，不应暴露内部语义结构的消息族。

## 4. 边界与归属

- `pd-core-v2` 应保持显式、按次调用近似无状态。
- `pd-core-v2` 不应内置隐藏的滚动缓存去记住历史 frame / chunk。
- capture history 由调用方持有，并由调用方决定是否提供上下文。
- 调用方可以只缓存 detail view 需要的最小上下文。
- `pd-core-v2` 可以校验传入上下文是否自洽，但不应凭空推断其输入中不存在的 transport identity、direction 或 transaction grouping。

这样可以保持 `pd-core-v2` 边界干净，同时允许消费者在掌握历史帧时获得更强解析能力。

## 5. 解析策略总览

语义状态分三档：

1. `raw-only`
   - 没有有效上下文，或者当前字节还不足以安全展开语义。

2. `partial semantic`
   - 已有有效的 assembled prefix，且该消息族属于 prefix-decodable。
   - 只解析前部已经完整到齐的单元。
   - 尾部尚未构成完整单元的字节继续按 raw 保留。

3. `complete semantic`
   - 已拼出的 payload 长度达到声明的 `Data Size`。
   - 可以进行完整消息族语义解析。

## 6. 消息族分类

### 6.1 不需要额外上下文

这些类型继续直接按当前帧解析：

- control messages
- 大多数 data messages
- 大多数 unchunked Extended Messages
- `EPR_Request`
- 已经自包含的 VDM / VDO 分支

### 6.2 需要上下文，但不依赖 chunk assemble

当前这类只有：

- `Request`

规则：

- 无上下文时，只解析通用 RDO 位段。
- 有合法 `Source_Capabilities` 上下文时，通过 `Object Position` 和被引用 PDO 类型收敛到唯一 RDO 分支。

这已经是当前 `pd-core-v2` 的既定方向。

### 6.3 属于 prefix-decodable 的 Chunked Extended 家族

当前这一组是：

- `EPR_Source_Capabilities`
- `EPR_Sink_Capabilities`

规则：

- chunk `0` 到来时，就可以产出有价值的部分语义解析。
- chunk `N > 0` 只有在调用方同时提供覆盖 `0..N` 的合法 assembled prefix 时，才允许做语义解析。
- 只解析完整的 32-bit PDO 单元。
- 尾部尚未组成完整 PDO 的字节继续按 raw 保留。

### 6.4 直接按当前帧 / chunk raw data block 展示的 Extended 家族

当前这一组是：

- `Security_Request`
- `Security_Response`
- `Firmware_Update_Request`
- `Firmware_Update_Response`

规则：

- 不对内部 payload 做字段级语义展开。
- 不要求 assemble 后才有可展示结果。
- 当前帧或当前 chunk 的 payload bytes 直接以专名 raw data block 展示：
  - `Security Request Data Block (SRQDB)`
  - `Security Response Data Block (SRPDB)`
  - `Firmware Update Request Data Block (FRQDB)`
  - `Firmware Update Response Data Block (FRPDB)`

### 6.5 属于 full-assemble-only 的 Chunked Extended 家族

当前这一组是：

- `Vendor_Defined_Extended`

规则：

- 不对部分前缀做语义展开。
- 在完整 payload 拼齐前，只展示 framing 和 raw data block bytes。
- 只有 assembled payload 达到 `Data Size` 后，才允许进入语义解析。

### 6.6 未来 chunked 分支的默认规则

如果后续新增某个 chunked Extended 家族，但还没有证明它支持安全的 prefix 解析，则默认按 `full-assemble-only` 处理。

## 7. 拼包规则

拼包是字节级的，不是 object 级的。

传入的 chunk 上下文至少要满足这些条件：

- SOP 相同
- Message Type 相同
- 都是 `Chunked = 1` 的 Extended Message
- 参与语义拼包的必须是 `Request Chunk = 0` 的数据 chunk
- chunk coverage 必须从 `0` 开始连续，不能跳号

如果连续性不成立，`pd-core-v2` 应回退为当前 chunk 的 `raw-only` 解析。

补充规则：

- 语义解析只基于已经拼出的字节前缀，不能猜缺失字节。
- 解析边界必须从 assembled payload 起点计算，不能从“当前 chunk 的局部偏移”计算。
- 超出当前完整单元边界的尾部字节继续保留为 raw。
- 超出声明 `Data Size` 的字节不参与语义 payload 解析。

## 8. Request Chunk 帧

`Request Chunk = 1` 的帧在本策略里不视为语义 payload 载体。

规则：

- 不把它展开成 payload fields。
- 只展示它的 headers 和 raw bytes。
- 不把它作为语义拼包时的 payload bytes 参与组装。

## 9. EPR Capabilities 特例规则

`EPR_Source_Capabilities` 和 `EPR_Sink_Capabilities` 是当前唯一被批准支持 prefix 解析的 chunked Extended 家族。

核心规则是：

- 从 assembled payload 起点开始解析
- 只输出已经完整到齐的 PDO 大小单元
- 永远不要猜尾部半截

例子：

- 如果 chunk `0` 一共贡献了 26 个 assembled bytes，那么只有前 24 个字节能被解析成 6 个完整 32-bit PDO 单元。
- 最后 2 个字节继续保留为 raw，等待后续 chunk。
- 如果之后提供了 chunk `1`，并且同时给出 chunk `0 + 1` 的 assembled prefix，那么应从 payload 起点重新切分，得到更多完整 PDO 单元。

这正是为了避免“单独拿 chunk `1+` 做语义解析”这种错误策略。

## 10. 调用方职责

`pd-web-v2` 这类上层负责：

- 保留最小必要的历史 frame
- 决定某个 detail view 是否需要上下文增强解析
- 在可行时构建 `0..N` 的 assembled prefix
- 把上下文显式传给 `pd-core-v2`

这意味着：

- protocol list / table 渲染不需要被迫变成全局状态机
- context 只需要在选中详情路径上按需缓存
- `pd-core-v2` 不依赖 host 的 capture 存储策略

还要注意一点：

- 当前 `pd-core-v2` 输入本身不携带 direction / timestamp / transport identity，因此“这些 chunk 是否真的属于同一条消息链”最终仍由调用方负责保证

## 11. 当前实现状态

当前状态：

- `Request` 已经支持显式 `Source_Capabilities` 上下文。
- `EPR_*_Capabilities` 已经支持显式 chunk 上下文下的 assembled prefix 解析。
- `Security_*` / `Firmware_Update_*` 当前直接显示当前帧或当前 chunk 的专名 raw data block。
- `Vendor_Defined_Extended` 仍未落地完整 assemble 后的专用语义解析。

这份文档不要求现在就把具体 API 命名定死。

这份文档真正固定下来的，是行为约束：

- 上下文必须由调用方显式持有并传入
- core 不维护隐藏缓存
- `EPR_*_Capabilities` 允许基于 assembled prefix 做部分语义解析
- `Security_*`、`Firmware_Update_*` 当前直接以专名 raw data block 展示，不做内部 payload 语义展开
- `Vendor_Defined_Extended` 仍要求完整拼包后才允许语义展开

## 12. 为什么这样定

本地参考实现并不是同一种策略：

- `USB_PD_Parser_API_Py` 对多个 chunked Extended 家族做了真正的累积拼接。
- `UCPD-Monitor` 主要是为了 EPR capability 展示做 chunk-aware 局部处理，并没有形成通用的完整 payload assemble 模型。

因此 `pd-core-v2` 最终选择的是：

- 先遵守规范
- 优先使用显式字节拼包，而不是按 chunk 猜结构
- 保持 core 边界干净
- 只在“前部完整单元可安全解释”时允许部分语义解析

## 13. 非目标

这份文档不承诺：

- 在 `pd-core-v2` 内部维护隐藏 sequence 状态
- 对 `Security_*` / `Firmware_Update_*` 的内部 payload 做字段级语义展开
- 对非完整 `Vendor_Defined_Extended` chunk 做语义解析
- 引入 UI-specific projection model
- 在协议 core 里做 transport / session heuristic
