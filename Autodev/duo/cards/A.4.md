# Card A.4: 进程生命周期管理

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.3 > FR-012: 进程生命周期管理

从 `todolist.md` 读取：
- Phase A > A-4：进程生命周期管理

## 读取已有代码
- `src/types/adapter.ts` — ExecOptions 类型
- `src/adapters/` — 确认目录结构

## 任务
1. 实现 `src/adapters/process-manager.ts` — `ProcessManager` 类：
   - `spawn()`: 使用 `child_process.spawn` with detached process group + 独立环境变量
   - `kill()`: SIGTERM → 等待 5s → SIGKILL，使用 `process.kill(-pid)` 杀整个进程组
   - `isRunning()`: 检查进程是否仍在运行
   - 超时机制（可配置，默认 10 分钟）
   - 心跳检测（30s 间隔，60s 无输出告警）

2. 实现异常处理：
   - 进程崩溃（非零退出码）→ 发出 error 事件
   - 进程挂起（心跳超时）→ 发出 warning 事件
   - 进程被 kill → 保留已有输出

3. 编写完整单元测试：
   - 测试 spawn + kill 生命周期
   - 测试进程组 kill（-pid）
   - 测试超时自动终止
   - 压力测试 10 次 spawn+kill 无僵尸进程

## 验收标准
- [ ] AC-1: 子进程使用独立环境变量和 CWD
- [ ] AC-2: kill 使用进程组信号（`process.kill(-pid)`），确保子子进程被终止
- [ ] AC-3: 超时后自动终止进程
- [ ] AC-4: 不产生僵尸进程（压力测试 10 次 spawn+kill）
- [ ] AC-5: 心跳检测正常工作
- [ ] AC-6: 所有测试通过: `npm test`
