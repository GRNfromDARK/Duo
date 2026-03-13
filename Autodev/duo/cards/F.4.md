# Card F.4: 项目目录选择器

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.4 > FR-019: 项目目录选择器

从 `todolist.md` 读取：
- Phase F > F-4：项目目录选择器

## 读取已有代码
- `src/cli.ts` — CLI 入口
- `src/ui/` — UI 组件

## 任务
1. 实现交互式路径选择组件 `src/ui/components/DirectoryPicker.tsx`:
   - 路径输入 + Tab 补全
   - MRU 最近使用目录列表

2. MRU 持久化:
   - 存储到 `~/.duo/recent.json`

3. 自动扫描:
   - 扫描 `~/Projects`, `~/Developer`, `~/code` 发现 git 仓库

4. 非 git 仓库目录给出警告

5. 编写完整测试

## 验收标准
- [ ] AC-1: Tab 路径补全功能正常
- [ ] AC-2: MRU 列表跨会话持久化
- [ ] AC-3: 自动发现常见路径下的 git 仓库
- [ ] AC-4: 非 git 目录显示警告
- [ ] AC-5: 所有测试通过: `npm test`
