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
echo "  God LLM Orchestrator — Phase Gate Checks"
echo "═══════════════════════════════════════════════"

# ──── 1. 核心单元测试 ────
echo ""
echo "── 单元测试 ──"
if npx vitest run 2>&1; then
    check_pass "所有测试通过"
else
    check_fail "测试失败"
fi

# ──── 2. TypeScript 编译检查 ────
echo ""
echo "── TypeScript 编译 ──"
if npx tsc --noEmit 2>&1; then
    check_pass "TypeScript 编译无错误"
else
    check_warn "TypeScript 编译有错误（非阻断）"
fi

# ──── 3. SPEC-DECISION / AI-REVIEW 审计 ────
echo ""
echo "── 决策审计 ──"
spec_count=$(grep -r "SPEC-DECISION" src/ 2>/dev/null | wc -l | tr -d ' ')
review_count=$(grep -r "AI-REVIEW" src/ 2>/dev/null | wc -l | tr -d ' ')
echo "  SPEC-DECISION 标注: $spec_count 处"
echo "  AI-REVIEW 标注: $review_count 处"

# ──── 4. AI-REVIEW 覆盖率检查 ────
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

# ──── 5. 跨文件变更 vs AI-REVIEW 匹配检查 ────
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
    check_pass "AI-REVIEW 覆盖率正常 ($changed_files 文件变更, 本 Phase $phase_review_count 处 AI-REVIEW 标注)"
fi

# ──── 6. 旧组件完整性检查（AR-004: 不删除 fallback） ────
echo ""
echo "── 旧组件完整性 (AR-004) ──"
fallback_ok=true
for fallback_file in \
    "src/decision/convergence-service.ts" \
    "src/decision/choice-detector.ts" \
    "src/session/context-manager.ts"; do
    if [ -f "$fallback_file" ]; then
        check_pass "保留: $fallback_file"
    else
        check_fail "缺失: $fallback_file（AR-004 要求保留为 fallback）"
        fallback_ok=false
    fi
done

# ──── 7. God Schema 完整性检查 ────
echo ""
echo "── God Schema 完整性 ──"
if [ -f "src/types/god-schemas.ts" ]; then
    schema_count=$(grep -c "export const God\|export const TaskType" "src/types/god-schemas.ts" 2>/dev/null || echo 0)
    if [ "$schema_count" -ge 5 ]; then
        check_pass "God schemas 完整 ($schema_count 个 schema)"
    else
        check_warn "God schemas 可能不完整 ($schema_count 个 schema, 期望 ≥ 5)"
    fi
else
    check_fail "src/types/god-schemas.ts 不存在"
fi

# ──── 8. God JSON 提取器存在检查 ────
echo ""
echo "── God JSON 提取器 ──"
if [ -f "src/parsers/god-json-extractor.ts" ]; then
    check_pass "God JSON 提取器存在"
else
    check_fail "src/parsers/god-json-extractor.ts 不存在"
fi

# ──── 9. 导入一致性检查 ────
echo ""
echo "── 导入一致性 ──"
import_errors=0
# 检查 God 相关文件的导入路径是否使用 .js 后缀（ESM 要求）
for src_file in $(find src/ -name "*.ts" -not -path "*/node_modules/*" -not -path "*/__tests__/*" 2>/dev/null); do
    bad_imports=$(grep -n "from '\.\./\|from '\.\/" "$src_file" 2>/dev/null | grep -v "\.js'" | grep -v "\.json'" | grep -v "\.ts'" || true)
    if [ -n "$bad_imports" ]; then
        import_errors=$((import_errors + 1))
    fi
done
if [ $import_errors -eq 0 ]; then
    check_pass "导入路径一致"
else
    check_warn "存在 $import_errors 个文件可能缺少 .js 导入后缀"
fi

# ──── 汇总 ────
echo ""
echo "═══════════════════════════════════════════════"
echo "结果: ✅ $PASS | ❌ $FAIL | ⚠️  $WARN"
[ $FAIL -gt 0 ] && exit 1 || exit 0
