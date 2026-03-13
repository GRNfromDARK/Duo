# Card A.4: 不可代理场景规则引擎

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-008a: 不可代理场景规则引擎 (AC-028, AC-029, AC-030)
- NFR-009: 规则引擎 block 不可被 God 覆盖

从 `docs/requirements/god-llm-todolist.md` 读取：
- A-4 任务描述和验证标准

## 读取已有代码
- `src/decision/` — 现有决策相关代码，了解代码风格
- `src/types/` — 现有类型定义

## 任务

### 1. 创建规则引擎模块
创建 `src/god/rule-engine.ts`：

```typescript
export type RuleLevel = 'block' | 'warn';

export interface RuleResult {
  ruleId: string;      // R-001, R-002, ...
  level: RuleLevel;
  matched: boolean;
  description: string;
  details?: string;
}

export interface RuleEngineResult {
  blocked: boolean;
  results: RuleResult[];
}

export function evaluateRules(action: ActionContext): RuleEngineResult
```

### 2. 实现 5 条规则
同步规则引擎（< 5ms，不涉及 LLM）：
- **R-001**: ~/Documents 外文件写操作 → block
  - 支持相对路径 resolve 到 cwd 后比对
- **R-002**: 系统关键目录（/etc, /usr, /bin, /System, /Library）→ block
- **R-003**: 可疑网络外连（`curl -d @file` 等模式）→ block
- **R-004**: God 与规则引擎矛盾 → warn
- **R-005**: Coder 修改 .duo/ 配置 → warn

### 3. ActionContext 类型
```typescript
export interface ActionContext {
  type: 'file_write' | 'command_exec' | 'config_modify';
  path?: string;         // 文件路径
  command?: string;       // 命令内容
  cwd: string;           // 当前工作目录
  godApproved?: boolean; // God 是否批准
}
```

### 4. 编写测试
在 `src/__tests__/god/rule-engine.test.ts` 中：
- R-001 正确检测相对路径（`../outside/file` resolve 后比对）
- R-001 允许 ~/Documents 内的写操作
- R-002 检测 /etc, /usr, /bin, /System, /Library
- R-003 检测 `curl -d @file` 等模式
- R-004 God 批准但规则引擎有 block → block 级别不可覆盖
- R-005 检测 .duo/ 配置修改
- 规则引擎执行 < 5ms（性能测试）
- block 结果正确标记 blocked: true

## 验收标准
- [ ] AC-1: R-001 正确检测相对路径（`../outside/file` resolve 后比对）
- [ ] AC-2: R-002 检测 /etc, /usr, /bin, /System, /Library
- [ ] AC-3: R-003 检测 `curl -d @file` 等模式
- [ ] AC-4: 规则引擎执行 < 5ms
- [ ] AC-5: block 事件结果中 blocked: true，God 无法覆盖 block
- [ ] AC-6: warn 级别不 block 执行
- [ ] AC-7: 所有测试通过: `npx vitest run`
- [ ] AC-8: 现有测试不受影响
