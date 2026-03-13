# Card C.2: 创建新会话

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.1 > FR-001: 创建新会话

从 `todolist.md` 读取：
- Phase C > C-2：创建新会话

## 读取已有代码
- `src/cli.ts` — CLI 入口
- `src/adapters/detect.ts` — CLI 检测
- `src/adapters/registry.ts` — 注册表

## 任务
1. 实现 `duo start` 命令:
   - CLI 参数模式: `duo start --dir <path> --coder <cli> --reviewer <cli> --task <desc>`
   - 交互式模式: `duo start`（进入引导流程）

2. 启动前检测:
   - 项目目录是否存在
   - 是否为 git 仓库
   - CLI 工具是否安装（调用 detectInstalledCLIs）

3. Onboarding:
   - 首次启动展示检测到的 CLI 工具
   - Quick tips

4. 参数解析（使用 minimist 或 commander）

5. 编写完整单元测试

## 验收标准
- [ ] AC-1: 命令行参数模式正确解析所有选项
- [ ] AC-2: 交互式模式引导流程完整
- [ ] AC-3: 未安装的 CLI 工具给出友好提示
- [ ] AC-4: 非法目录（不存在/无权限）给出错误提示
- [ ] AC-5: 所有测试通过: `npm test`
