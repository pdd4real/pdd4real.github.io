---
title: Agent 运行时基础：异步执行、工具调用与上下文管理
date: 2026-08-06 03:08:00
updated: 2026-08-06 03:08:00
description: 从异步 I/O 出发，梳理 Agent 的安全检查、并发工具调用、OpenAI API 响应结构、短期上下文和状态一致性。
categories:
  - Agent
tags:
  - AsyncIO
  - Tool Calling
  - OpenAI API
  - Memory
---

一个能够使用工具的 LLM Agent，不只是“调用一次模型并返回文本”。它通常还要完成安全检查、上下文检索、任务规划、工具执行、结果回填和输出审核。这里的大部分时间都花在等待网络、数据库或模型服务，因此 Agent 天然属于高并发 I/O 系统。

异步编程解决的是任务等待期间的调度问题；消息协议和上下文管理解决的是模型、工具与运行时之间如何连续交互的问题。把这两部分放在一起，才能看清一次 Agent 执行循环的完整结构。

<!-- more -->

## Agent 为什么适合异步执行

一次较完整的 Agent 请求可能经过以下阶段：

1. 接收用户输入。
2. 执行内容安全、权限和 Prompt Injection 检查。
3. 检索会话记忆、长期记忆和 RAG 文档。
4. 调用搜索、数据库、浏览器或代码执行工具。
5. 将工具结果交给模型继续推理。
6. 审核输出，并执行获准的外部动作。
7. 以流式方式返回结果。

这些步骤中，远程模型、HTTP API、向量数据库和普通数据库都属于 I/O 操作。同步程序在等待一个请求时会占住当前执行路径；异步程序则可以把控制权交还给事件循环，让同一线程继续调度其他协程。

异步不会让单个 API 本身计算得更快。它的价值是减少串行等待，提高多个独立 I/O 任务之间的重叠程度。

## 并发的前提是任务相互独立

安全检查、只读记忆检索和知识库检索可以同时发起：

```python
import asyncio


async def prepare_context(message):
    safety_task = asyncio.create_task(check_safety(message))
    memory_task = asyncio.create_task(retrieve_memory(message))
    rag_task = asyncio.create_task(search_knowledge(message))

    safety = await safety_task
    if not safety.ok:
        memory_task.cancel()
        rag_task.cancel()
        await asyncio.gather(memory_task, rag_task, return_exceptions=True)
        return None

    memory, documents = await asyncio.gather(memory_task, rag_task)
    return memory, documents
```

这里提前启动的是只读任务。发送邮件、删除文件、下单等有副作用的操作不能仅因为可以并发就提前执行，必须等安全检查和权限验证通过。

并发还要求任务之间不存在直接数据依赖。如果第二个工具必须使用第一个工具的结果，它们仍然需要按顺序执行。

## 工具调用是异步化的主要场景

假设用户要求查询股价、汇总新闻并发送邮件。运行时可以并发获取股价、新闻和邮箱配置，等数据齐备后再生成邮件；真正发送邮件则应放在审批之后。

```text
User Request
     │
     ▼
Safety and Permission Check
     │
     ├────────────┬────────────┐
     ▼            ▼            ▼
 Stock API    News Search   Mail Config
     └────────────┴────────────┘
                  │
                  ▼
             LLM Summary
                  │
                  ▼
           Approval Checkpoint
                  │
                  ▼
              Send Mail
```

这类流程需要超时、取消、重试和错误聚合，而不只是几个 `await`。例如新闻搜索失败时，运行时需要决定是使用已有股价继续回答、重试搜索，还是返回部分结果。

## 模型调用与流式输出同样是 I/O

模型推理通常发生在远程服务中。客户端发出请求后，大部分时间都在等待服务端排队和生成 Token，因此也适合使用异步客户端。

```python
from openai import AsyncOpenAI

client = AsyncOpenAI(
    api_key=API_KEY,
    base_url=BASE_URL,
)

response = await client.chat.completions.create(
    model=MODEL,
    messages=messages,
    tools=TOOLS,
    tool_choice="auto",
)
```

流式生成则是异步数据流：服务端每产生一部分内容，客户端就消费一部分，而不必等待完整回答生成后再显示。

## Chat Completions 与 Responses API 如何选择

OpenAI Python SDK 提供了不同的调用接口。`client.responses.create(...)` 对应较新的 Responses API，统一了文本、多模态和工具调用等能力；`client.chat.completions.create(...)` 对应传统的 Chat Completions API。

如果使用第三方中转站，Chat Completions 往往兼容性更好，因为很多服务只实现了：

```text
POST /v1/chat/completions
```

而没有完整实现：

```text
POST /v1/responses
```

当中转站不支持 Responses API 时，常见错误包括：

```text
404 Not Found
unsupported endpoint
invalid request
```

因此，面向中转站的工具调用代码经常使用：

```python
response = await client.chat.completions.create(
    model=MODEL,
    messages=memory.get(),
    tools=TOOLS,
    tool_choice="auto",
)
```

如果服务明确支持 `/v1/responses`，也可以使用 Responses API，但不能混用两套协议的消息格式。Chat Completions 使用 `role="tool"` 和 `tool_call_id`；Responses API 使用自己的输入项与 `function_call_output` 结构。

## `response`、`choices` 与 `message`

`response` 不是自定义类名，而是 SDK 根据服务端 JSON 创建的响应对象实例。Chat Completions 响应常见字段包括：

```python
response.id
response.model
response.usage
response.choices
```

`response.choices` 是候选结果列表。多数场景只请求一个候选，因此通常读取：

```python
message = response.choices[0].message
finish_reason = response.choices[0].finish_reason
```

模型直接回答文本时，消息结构接近：

```python
{
    "role": "assistant",
    "content": "The weather in Tokyo is sunny.",
    "tool_calls": None,
}
```

模型要求调用工具时，消息结构接近：

```python
{
    "role": "assistant",
    "content": None,
    "tool_calls": [
        {
            "id": "call_xxx",
            "type": "function",
            "function": {
                "name": "get_weather",
                "arguments": "{\"location\":\"Tokyo\"}",
            },
        }
    ],
}
```

因此运行时的判断通常是：

```python
if not message.tool_calls:
    final_answer = message.content or ""
else:
    # Parse and execute requested tools.
    ...
```

`finish_reason` 也值得检查。`stop` 通常表示自然结束，`tool_calls` 表示模型请求工具，`length` 则可能意味着输出被 Token 上限截断。

## Memory 在这里是短期上下文

最简单的 Memory 只是当前会话的消息列表：

```python
class Memory:
    def __init__(self):
        self.messages = []

    def add(self, role, content=None, **kwargs):
        message = {"role": role}
        if content is not None:
            message["content"] = content
        message.update(kwargs)
        self.messages.append(message)

    def get(self):
        return self.messages
```

`role` 表示消息来源：

- `system`：系统规则和行为约束。
- `user`：用户输入。
- `assistant`：模型回复或模型发出的工具调用。
- `tool`：工具执行结果。

`**kwargs` 用于附加 `tool_calls`、`tool_call_id` 等协议字段。例如：

```python
memory.add(
    "tool",
    "28 C, sunny",
    tool_call_id="call_xxx",
)
```

这个类没有向量检索、跨会话持久化、摘要压缩或遗忘策略，所以它不是长期记忆系统。它只是维护当前执行循环所需的短期上下文，并在下一次模型调用时完整传入 `messages`。

## 一次工具调用的消息闭环

Chat Completions 的工具调用不能只保存工具结果。运行时必须先保存 assistant 发出的 `tool_calls`，再为每个调用追加匹配的 tool 消息：

```python
import asyncio
import json


async def run_agent(user_input, memory):
    memory.add("user", user_input)

    while True:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=memory.get(),
            tools=TOOLS,
            tool_choice="auto",
        )

        message = response.choices[0].message
        memory.messages.append(message.model_dump(exclude_none=True))

        if not message.tool_calls:
            return message.content or ""

        results = await asyncio.gather(
            *(execute_tool(call) for call in message.tool_calls),
            return_exceptions=True,
        )

        for call, result in zip(message.tool_calls, results):
            content = (
                json.dumps({"error": str(result)})
                if isinstance(result, Exception)
                else json.dumps(result, ensure_ascii=False)
            )
            memory.add(
                "tool",
                content,
                tool_call_id=call.id,
            )
```

这段循环的顺序是：

1. 保存用户消息。
2. 请求模型决定直接回答还是调用工具。
3. 保存 assistant 消息及其 `tool_calls`。
4. 并发执行相互独立的工具。
5. 用 `tool_call_id` 把结果关联回原调用。
6. 再次请求模型，让它基于工具结果继续推理。
7. 直到模型返回不包含 `tool_calls` 的最终文本。

生产代码还应限制最大循环次数，校验工具参数，并为每个工具设置独立超时。否则模型可能重复调用同一工具，或因某个请求迟迟不返回而阻塞整个执行循环。

## 多 Agent 系统中的并发

在多 Agent 架构中，Planner、Browser、Coding 和 Safety 等角色可能并发运行：

```text
                 Planner
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
 Browser Agent  Code Agent  Safety Agent
       └────────────┼────────────┘
                    ▼
              Result Merger
```

这种结构已经接近分布式任务系统。除了 `asyncio`，工程中还可能使用消息队列、Actor Model、工作流引擎和分布式任务框架。具体工具包括 FastAPI、aiohttp、Ray、Celery、Kafka 和 Redis Queue 等。

是否拆成多个 Agent，取决于任务是否真的需要独立状态、权限边界或并行能力。仅仅把几个函数分别命名为 Agent，并不会自动提升系统质量。

## 真正困难的是异步状态一致性

Agent 的主要风险通常不在模型生成本身，而在异步任务完成顺序不可预测。

例如，运行时已经准备删除文件，但安全检查稍后才返回拒绝。如果删除操作提前执行，后续拒绝已经无法阻止副作用。因此系统需要明确区分：

- 可推测执行的只读任务。
- 必须经过权限门控的写操作。
- 可以重试的幂等操作。
- 需要事务或补偿逻辑的不可逆操作。

常见控制机制包括：

- Cancellation Token：取消不再需要的任务。
- Timeout：限制模型和工具的最长等待时间。
- Retry with Backoff：处理临时网络错误。
- Permission Gating：在副作用之前验证权限。
- Human Approval：对高风险动作增加人工确认。
- Transaction / Compensation：失败时回滚或执行补偿动作。
- Idempotency Key：避免重试造成重复下单或重复发送。

## 一个完整的 Agent Runtime

把前面的结构合并后，一次典型执行流程如下：

```text
User Input
    │
    ├── Safety Check
    ├── Memory Retrieval
    └── RAG Search
            │
            ▼
         Planner
            │
    ┌───────┼────────┐
    ▼       ▼        ▼
 Browser   Code      DB
    └───────┼────────┘
            ▼
      Tool Result Messages
            │
            ▼
       LLM Generation
            │
            ▼
    Output Safety Check
            │
            ▼
          Stream
```

从这个角度看，现代 Agent Runtime 更接近工作流引擎或任务调度器：它要管理并发任务、消息状态、权限、中断、超时、重试和资源，而模型只是其中一个重要组件。

## 总结

异步编程为 Agent 提供高效的 I/O 调度能力，Tool Calling 协议定义模型如何请求外部能力，Memory 则维持一次执行循环中的消息状态。三者需要共同设计：

- 只并发执行相互独立且时机安全的任务。
- 根据服务兼容性选择 Chat Completions 或 Responses API。
- 按协议保存 assistant 工具调用和对应的 tool 结果。
- 不把简单消息列表误认为长期记忆系统。
- 在有副作用的操作前设置权限与人工审批门槛。
- 为循环、工具和外部服务设置超时、取消与重试策略。

当这些基础设施具备后，Agent 才从一次模型调用变成可控制、可恢复、可审计的运行系统。
