# Card A.2: God Adapter 配置 + --god 参数

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-006: God adapter 配置 (AC-021, AC-022)
- AR-001: God 通过 CLI adapter 调用
- Section about `--god` parameter

从 `docs/requirements/god-llm-todolist.md` 读取：
- A-2 任务描述和验证标准

## 读取已有代码
- `src/cli.ts` — CLI 入口，了解参数解析方式
- `src/cli-commands.ts` — handleStart 函数，了解启动流程
- `src/session/session-starter.ts` — parseStartArgs, createSessionConfig
- `src/types/session.ts` — SessionConfig, StartArgs 类型
- `src/adapters/registry.ts` — adapter 注册表
- `src/adapters/factory.ts` — adapter 工厂
- `src/types/adapter.ts` — adapter 接口定义
- `src/__tests__/cli.test.ts` — 现有 CLI 测试模式

## 任务

### 1. 扩展 SessionConfig 和 StartArgs
在 `src/types/session.ts` 中：
```typescript
export interface SessionConfig {
  projectDir: string;
  coder: string;
  reviewer: string;
  god: string;        // 新增：God adapter 名称
  task: string;
}

export interface StartArgs {
  dir?: string;
  coder?: string;
  reviewer?: string;
  god?: string;        // 新增
  task?: string;
}
```

### 2. 扩展 parseStartArgs
在 `src/session/session-starter.ts` 中支持 `--god <adapter-name>` 参数解析。
- 默认值：`--god` 省略时跟随 `--reviewer` 的值

### 3. God adapter 实例化
God adapter 独立于 Coder/Reviewer（不同实例、不同 session），即使选择同一 CLI 工具。
- 在 adapter 工厂中支持创建 God adapter 实例
- God adapter 实例与 Coder/Reviewer 实例完全隔离

### 4. God system prompt 注入机制
设计 God system prompt 结构：
- 编排者角色指令（区别于 Coder/Reviewer 的执行者角色）
- JSON 格式约束（要求输出 ```json ... ``` 块）
- 可作为配置注入到 adapter 的 system prompt

创建 `src/god/god-system-prompt.ts`：
```typescript
export function buildGodSystemPrompt(context: GodPromptContext): string
```

### 5. 编写测试
在 `src/__tests__/god/god-adapter-config.test.ts` 中：
- `--god claude-code` 正确解析到 StartArgs
- `--god` 省略时默认跟随 `--reviewer`
- God 与 Coder 使用同一 CLI 工具时 session 完全隔离
- God system prompt 包含编排者角色指令和 JSON 格式约束

## 验收标准
- [ ] AC-1: `--god claude-code` 正确实例化 God adapter
- [ ] AC-2: `--god` 省略时默认跟随 `--reviewer`
- [ ] AC-3: God 与 Coder 使用同一 CLI 工具时 session 完全隔离
- [ ] AC-4: God system prompt 包含编排者角色指令和 JSON 格式约束
- [ ] AC-5: SessionConfig 和 StartArgs 类型更新不破坏现有代码
- [ ] AC-6: 所有测试通过: `npx vitest run`
- [ ] AC-7: 现有测试不受影响
