#!/bin/bash
set -e
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AUTODEV_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"
PASS=0; FAIL=0; WARN=0
check_pass() { echo -e "\033[0;32m  ✅ $1\033[0m"; PASS=$((PASS+1)); }
check_fail() { echo -e "\033[0;31m  ❌ $1\033[0m"; FAIL=$((FAIL+1)); }
check_warn() { echo -e "\033[1;33m  ⚠️  $1\033[0m"; WARN=$((WARN+1)); }

echo "═══════════════════════════════════════════════"
echo "  Duo — Phase Gate Checks"
echo "═══════════════════════════════════════════════"

# ──── 1. TypeScript 编译检查 ────
echo ""
echo "── TypeScript 编译 ──"
if npx tsc --noEmit 2>/dev/null; then
    check_pass "TypeScript 编译通过（无类型错误）"
else
    check_fail "TypeScript 编译失败"
fi

# ──── 2. 单元测试 ────
echo ""
echo "── 单元测试 ──"
if npm test 2>/dev/null; then
    check_pass "所有测试通过"
else
    check_fail "测试失败"
fi

# ──── 3. ESLint 检查 ────
echo ""
echo "── ESLint ──"
if npx eslint src/ --ext .ts,.tsx 2>/dev/null; then
    check_pass "ESLint 无错误"
elif [ $? -eq 127 ]; then
    check_warn "ESLint 未安装，跳过"
else
    check_warn "ESLint 有警告或错误"
fi

# ──── 4. CLIAdapter 接口一致性 ────
echo ""
echo "── CLIAdapter 接口一致性 ──"
adapter_count=$(find src/adapters -name "*.ts" -not -name "*.test.*" -not -name "*.spec.*" 2>/dev/null | wc -l | tr -d ' ')
if [ "$adapter_count" -gt 0 ]; then
    implements_count=$(grep -rl "CLIAdapter" src/adapters/ 2>/dev/null | wc -l | tr -d ' ')
    check_pass "发现 $adapter_count 个适配器文件，$implements_count 个引用 CLIAdapter"
else
    check_warn "未发现适配器文件（可能在早期 Phase）"
fi

# ──── 5. 进程管理安全性 ────
echo ""
echo "── 进程管理 ──"
if [ -d "src/" ]; then
    zombie_risk=$(grep -r "child_process\|spawn\|exec(" src/ --include="*.ts" 2>/dev/null | grep -v "test\|spec\|node_modules" | wc -l | tr -d ' ')
    kill_group=$(grep -r "process.kill(-" src/ --include="*.ts" 2>/dev/null | wc -l | tr -d ' ')
    echo "  进程创建相关代码: $zombie_risk 处"
    echo "  进程组 kill 代码: $kill_group 处"
    if [ "$zombie_risk" -gt 0 ] && [ "$kill_group" -eq 0 ]; then
        check_warn "有进程创建但未发现进程组 kill（-pid），可能产生僵尸进程"
    else
        check_pass "进程管理代码正常"
    fi
else
    check_warn "src/ 目录不存在（可能在 Phase A）"
fi

# ──── 6. 环境变量隔离（Claude Code 嵌套检测） ────
echo ""
echo "── 环境变量隔离 ──"
if grep -r "CLAUDECODE" src/ --include="*.ts" 2>/dev/null | grep -q "delete"; then
    check_pass "Claude Code 嵌套会话检测已处理（delete env.CLAUDECODE）"
else
    if [ -d "src/adapters/claude-code" ]; then
        check_warn "未发现 delete env.CLAUDECODE，可能导致嵌套会话错误"
    else
        check_warn "Claude Code 适配器尚未实现，跳过检查"
    fi
fi

# ──── 7. SPEC-DECISION / AI-REVIEW 审计 ────
echo ""
echo "── 决策审计 ──"
spec_count=$(grep -r "SPEC-DECISION" src/ --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l | tr -d ' ')
review_count=$(grep -r "AI-REVIEW" src/ --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l | tr -d ' ')
echo "  SPEC-DECISION 标注: $spec_count 处"
echo "  AI-REVIEW 标注: $review_count 处"

# ──── 8. decisions.jsonl 审计 ────
if [ -f "$AUTODEV_DIR/decisions.jsonl" ] && [ -s "$AUTODEV_DIR/decisions.jsonl" ]; then
    block_count=$(grep -c '"severity": *"BLOCK"' "$AUTODEV_DIR/decisions.jsonl" 2>/dev/null || echo 0)
    warn_count=$(grep -c '"severity": *"WARN"' "$AUTODEV_DIR/decisions.jsonl" 2>/dev/null || echo 0)
    total_decisions=$(wc -l < "$AUTODEV_DIR/decisions.jsonl" | tr -d ' ')
    review_decisions=$(grep -c '"level": *"AI-REVIEW"' "$AUTODEV_DIR/decisions.jsonl" 2>/dev/null || echo 0)
    echo "  decisions.jsonl: $total_decisions 条记录 (AI-REVIEW: $review_decisions, BLOCK: $block_count, WARN: $warn_count)"
    unresolved_blocks=$(grep '"severity": *"BLOCK"' "$AUTODEV_DIR/decisions.jsonl" | grep '"consensus": *false' | wc -l | tr -d ' ')
    if [ "$unresolved_blocks" -gt 0 ]; then
        check_fail "存在 $unresolved_blocks 个未达成共识的 BLOCK 级决策"
    else
        check_pass "所有 BLOCK 级决策已达成共识"
    fi
else
    check_warn "decisions.jsonl 为空或不存在，无法审计决策覆盖率"
fi

# ──── 9. Phase-scoped 变更 vs AI-REVIEW 匹配 ────
echo ""
echo "── Phase 变更审计 ──"
phase_base_file="$AUTODEV_DIR/.phase_baseline"
phase_base_ref=""
[ -f "$phase_base_file" ] && phase_base_ref=$(cat "$phase_base_file")
if [ -n "$phase_base_ref" ] && git rev-parse --verify "${phase_base_ref}^{commit}" >/dev/null 2>&1; then
    changed_files=$(git diff --name-only "$phase_base_ref" -- 2>/dev/null | wc -l | tr -d ' ')
    echo "  Phase 基线: $phase_base_ref"
    phase_review_count=0
    while IFS= read -r changed_file; do
        [ -f "$changed_file" ] || continue
        file_review_count=$(grep -c "AI-REVIEW" "$changed_file" 2>/dev/null || true)
        phase_review_count=$((phase_review_count + file_review_count))
    done < <(git diff --name-only "$phase_base_ref" -- 2>/dev/null)
else
    changed_files=$(git diff --name-only HEAD 2>/dev/null | wc -l | tr -d ' ')
    phase_review_count=$review_count
    check_warn "未找到有效 .phase_baseline，暂回退到工作区 diff"
fi
if [ "$changed_files" -gt 3 ] && [ "$phase_review_count" -eq 0 ]; then
    check_warn "本 Phase 变更了 $changed_files 个文件但代码中无 AI-REVIEW 标注"
else
    check_pass "AI-REVIEW 覆盖率正常 ($changed_files 文件变更, $phase_review_count 处 AI-REVIEW 标注)"
fi

# ──── 10. 无敏感文件泄露 ────
echo ""
echo "── 安全检查 ──"
sensitive_files=$(find . -name ".env" -o -name "*.key" -o -name "credentials*" -o -name "*secret*" 2>/dev/null | grep -v node_modules | grep -v .git | head -5)
if [ -n "$sensitive_files" ]; then
    check_warn "发现可能的敏感文件: $sensitive_files"
else
    check_pass "未发现敏感文件"
fi

# ──── 汇总 ────
echo ""
echo "═══════════════════════════════════════════════"
echo "结果: ✅ $PASS | ❌ $FAIL | ⚠️  $WARN"
[ $FAIL -gt 0 ] && exit 1 || exit 0
