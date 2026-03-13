# Card F.2: Smart Scroll Lock

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.4 > FR-016: Smart Scroll Lock

从 `todolist.md` 读取：
- Phase F > F-2：Smart Scroll Lock

## 读取已有代码
- `src/ui/components/MessageView.tsx` — 消息展示

## 任务
1. 实现 Smart Scroll Lock 逻辑:
   - 默认自动跟随最新输出
   - 用户上滚 1 行即锁定视口，停止自动跟随
   - 视口锁定时底部显示浮动提示 "↓ New output (press G to follow)"
   - 按 G 跳到最新并重新启用自动跟随

2. 实现浮动提示组件 `src/ui/components/ScrollIndicator.tsx`

3. 编写完整测试

## 验收标准
- [ ] AC-1: 上滚后停止自动跟随
- [ ] AC-2: 浮动提示在有新输出时正确显示
- [ ] AC-3: G 键恢复自动跟随
- [ ] AC-4: 所有测试通过: `npm test`
