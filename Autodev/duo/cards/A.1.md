# Card A.1: 项目脚手架搭建

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 5: NFR-005 技术架构（TypeScript strict, Node.js >= 20, Ink, xstate v5）

从 `todolist.md` 读取：
- Phase A > A-1：项目脚手架搭建

## 读取已有代码
- `package.json`（如存在）
- `tsconfig.json`（如存在）

## 任务
1. 初始化 Node.js 项目：`npm init -y`
2. 安装依赖：
   - 运行时依赖: `ink`, `react`, `xstate`, `@xstate/react`
   - 开发依赖: `typescript`, `@types/node`, `@types/react`, `vitest`, `eslint`, `tsup`, `ink-testing-library`
3. 配置 `tsconfig.json`：
   ```json
   {
     "compilerOptions": {
       "strict": true,
       "target": "ES2022",
       "module": "NodeNext",
       "moduleResolution": "NodeNext",
       "jsx": "react-jsx",
       "outDir": "dist",
       "rootDir": "src",
       "declaration": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "forceConsistentCasingInFileNames": true
     },
     "include": ["src"]
   }
   ```
4. 配置 `vitest.config.ts`
5. 建立目录结构：
   - `src/adapters/`
   - `src/engine/`
   - `src/ui/`
   - `src/session/`
   - `src/decision/`
   - `src/parsers/`
   - `src/types/`
6. 配置 `package.json` 的 `bin` 字段，CLI 命令名为 `duo`
7. 创建入口文件 `src/index.ts` 和 `src/cli.ts`
8. 添加示例测试文件 `src/__tests__/setup.test.ts`
9. 配置 `package.json` scripts：`"test": "vitest run"`, `"build": "tsup src/cli.ts --format esm"`, `"dev": "tsx src/cli.ts"`

## 验收标准
- [ ] AC-1: `npm install` 无错误
- [ ] AC-2: `npx tsc --noEmit` 通过
- [ ] AC-3: `npm test` 运行成功（含示例测试）
- [ ] AC-4: `npx duo --version` 或 `npx tsx src/cli.ts --version` 输出版本号
- [ ] AC-5: 目录结构 `src/adapters/`, `src/engine/`, `src/ui/`, `src/session/`, `src/decision/`, `src/parsers/`, `src/types/` 全部存在
- [ ] AC-6: 所有测试通过: `npm test`
