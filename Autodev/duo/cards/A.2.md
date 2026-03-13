# Card A.2: CLIAdapter 接口定义 + 注册表 + 自动检测

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.3 > FR-008: CLIAdapter 插件化架构（接口定义、12 个工具注册表、自动检测）

从 `todolist.md` 读取：
- Phase A > A-2：CLIAdapter 接口定义 + 注册表 + 自动检测

## 读取已有代码
- `src/types/` — 检查是否已有类型定义
- `src/adapters/` — 检查目录结构

## 任务
1. 在 `src/types/adapter.ts` 定义核心接口：
   - `CLIAdapter` 接口（name, displayName, version, isInstalled, getVersion, execute, kill, isRunning）
   - `ExecOptions` 接口（cwd, systemPrompt, env, timeout, permissionMode）
   - `OutputChunk` 接口（type, content, metadata, timestamp）
   - `CLIRegistry` 注册表类型

2. 在 `src/adapters/registry.ts` 实现 CLI 注册表：
   - 12 个主流工具的元数据（命令名、检测命令、非交互调用方式、输出格式、YOLO 模式）
   - 注册表数据结构包含: name, displayName, command, detectCommand, execCommand, outputFormat, yoloFlag, parserType

3. 在 `src/adapters/detect.ts` 实现 `detectInstalledCLIs()`：
   - 并行扫描所有注册表中的 CLI 工具（使用 `which` + `--version`）
   - 返回已安装工具列表及版本
   - 扫描超时: 3 秒

4. 创建适配器子目录结构：`src/adapters/claude-code/`, `src/adapters/codex/`, `src/adapters/gemini/` 等

5. 支持用户自定义扩展（`.duo/adapters.json`）

## 验收标准
- [ ] AC-1: CLIAdapter 接口定义完整，TypeScript 编译通过
- [ ] AC-2: 注册表包含 12 个 CLI 工具的完整元数据
- [ ] AC-3: `detectInstalledCLIs()` 并行扫描所有工具，<= 3 秒完成
- [ ] AC-4: 适配器目录结构 `src/adapters/<name>/` 已创建
- [ ] AC-5: 支持用户自定义扩展（`.duo/adapters.json`）
- [ ] AC-6: 所有测试通过: `npm test`
