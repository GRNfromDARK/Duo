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
echo "  God LLM Integration — Phase Gate Checks"
echo "═══════════════════════════════════════════════"

# ──── 1. 全量测试 ────
echo ""
echo "── 全量测试 ──"
if npx vitest run 2>&1 | tail -5; then
    check_pass "全量测试通过"
else
    check_fail "全量测试失败"
fi

# ──── 2. TypeScript 编译检查 ────
echo ""
echo "── TypeScript 编译 ──"
if npx tsc --noEmit 2>&1 | tail -5; then
    check_pass "TypeScript 编译通过"
else
    check_fail "TypeScript 编译失败"
fi

# ──── 3. v1 组件保留检查（不可删除） ────
echo ""
echo "── v1 组件保留检查 ──"
if [ -f "src/decision/convergence-service.ts" ]; then
    check_pass "ConvergenceService 保留"
else
    check_fail "ConvergenceService 被删除！（AR-004 违规）"
fi
if [ -f "src/decision/choice-detector.ts" ]; then
    check_pass "ChoiceDetector 保留"
else
    check_fail "ChoiceDetector 被删除！（AR-004 违规）"
fi
if [ -f "src/session/context-manager.ts" ]; then
    check_pass "ContextManager 保留"
else
    check_fail "ContextManager 被删除！（AR-004 违规）"
fi

# ──── 4. God 模块未被修改检查 ────
echo ""
echo "── God 模块完整性 ──"
god_modified=$(git diff --name-only src/god/ 2>/dev/null | wc -l | tr -d ' ' || echo "0")
if [ "$god_modified" -eq 0 ]; then
    check_pass "God 模块未被修改"
else
    check_warn "God 模块有 $god_modified 个文件被修改（应为只读引用）"
fi

# ──── 5. DegradationManager 接入检查 ────
echo ""
echo "── 降级机制 ──"
degradation_imports=$(grep -r "degradation-manager\|DegradationManager" src/ui/components/App.tsx 2>/dev/null | wc -l | tr -d ' ' || echo "0")
if [ "$degradation_imports" -gt 0 ]; then
    check_pass "App.tsx 引入 DegradationManager ($degradation_imports 处)"
else
    check_warn "App.tsx 未引入 DegradationManager"
fi

# ──── 6. SPEC-DECISION / AI-REVIEW 审计 ────
echo ""
echo "── 决策审计 ──"
spec_count=$(grep -r "SPEC-DECISION" src/ 2>/dev/null | wc -l | tr -d ' ' || echo "0")
review_count=$(grep -r "AI-REVIEW" src/ 2>/dev/null | wc -l | tr -d ' ' || echo "0")
echo "  SPEC-DECISION 标注: $spec_count 处"
echo "  AI-REVIEW 标注: $review_count 处"

# ──── 7. decisions.jsonl 审计 ────
if [ -f "$AUTODEV_DIR/decisions.jsonl" ] && [ -s "$AUTODEV_DIR/decisions.jsonl" ]; then
    block_count=$(grep -c '"severity": *"BLOCK"' "$AUTODEV_DIR/decisions.jsonl" 2>/dev/null || echo 0)
    warn_count=$(grep -c '"severity": *"WARN"' "$AUTODEV_DIR/decisions.jsonl" 2>/dev/null || echo 0)
    total_decisions=$(wc -l < "$AUTODEV_DIR/decisions.jsonl" | tr -d ' ')
    review_decisions=$(grep -c '"level": *"AI-REVIEW"' "$AUTODEV_DIR/decisions.jsonl" 2>/dev/null || echo 0)
    echo "  decisions.jsonl: $total_decisions 条记录 (AI-REVIEW: $review_decisions, BLOCK: $block_count, WARN: $warn_count)"
    unresolved_blocks=$(grep '"severity": *"BLOCK"' "$AUTODEV_DIR/decisions.jsonl" | grep '"consensus": *false' | wc -l | tr -d ' ' || echo "0")
    if [ "$unresolved_blocks" -gt 0 ]; then
        check_fail "存在 $unresolved_blocks 个未达成共识的 BLOCK 级决策"
    else
        check_pass "所有 BLOCK 级决策已达成共识"
    fi
else
    check_warn "decisions.jsonl 为空或不存在，无法审计决策覆盖率"
fi

# ──── 8. Phase baseline diff 检查 ────
phase_base_file="$AUTODEV_DIR/.phase_baseline"
phase_base_ref=""
[ -f "$phase_base_file" ] && phase_base_ref=$(cat "$phase_base_file")
if [ -n "$phase_base_ref" ] && git rev-parse --verify "${phase_base_ref}^{commit}" >/dev/null 2>&1; then
    changed_files=$(git diff --name-only "$phase_base_ref" -- 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    echo "  Phase 基线: $phase_base_ref"
    phase_review_count=0
    while IFS= read -r changed_file; do
        [ -f "$changed_file" ] || continue
        file_review_count=$(grep -c "AI-REVIEW" "$changed_file" 2>/dev/null || true)
        phase_review_count=$((phase_review_count + file_review_count))
    done < <(git diff --name-only "$phase_base_ref" -- 2>/dev/null || true)
else
    changed_files=$(git diff --name-only HEAD 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    phase_review_count=$review_count
    check_warn "未找到有效 .phase_baseline，暂回退到工作区 diff"
fi
if [ "$changed_files" -gt 3 ] && [ "$phase_review_count" -eq 0 ]; then
    check_warn "本 Phase 变更了 $changed_files 个文件但代码中无 AI-REVIEW 标注"
else
    check_pass "AI-REVIEW 覆盖率正常 ($changed_files 文件变更, $phase_review_count 处 AI-REVIEW 标注)"
fi

# ──── 9. XState TASK_INIT 状态检查 ────
echo ""
echo "── XState 状态机 ──"
if grep -q "TASK_INIT" src/engine/workflow-machine.ts 2>/dev/null; then
    check_pass "workflow-machine 包含 TASK_INIT 状态"
else
    check_warn "workflow-machine 未包含 TASK_INIT 状态（Phase A 尚未完成？）"
fi

# ──── 汇总 ────
echo ""
echo "═══════════════════════════════════════════════"
echo "结果: ✅ $PASS | ❌ $FAIL | ⚠️  $WARN"
[ $FAIL -gt 0 ] && exit 1 || exit 0
