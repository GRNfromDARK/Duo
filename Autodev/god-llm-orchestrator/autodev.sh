#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  God LLM Orchestrator — Automated Development Pipeline
#  用法: ./Autodev/god-llm-orchestrator/autodev.sh [OPTIONS]
# ═══════════════════════════════════════════════════════════
set -euo pipefail

# ──── 路径配置 ────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AUTODEV="$SCRIPT_DIR"
CARDS_DIR="$AUTODEV/cards"
LOGS_DIR="$AUTODEV/logs"
STATE_FILE="$AUTODEV/state"
SYSTEM_PROMPT="$AUTODEV/system_prompt.md"
GATE_SCRIPT="$AUTODEV/gate_check.sh"

# ──── macOS 兼容 ────
if command -v gtimeout &>/dev/null; then
    TIMEOUT_CMD="gtimeout"
elif command -v timeout &>/dev/null; then
    TIMEOUT_CMD="timeout"
else
    TIMEOUT_CMD=""
fi

# ──── 配置 ────
MODEL="${GOD_LLM_MODEL:-opus}"
VERIFY_MODEL="${GOD_LLM_VERIFY_MODEL:-opus}"
CARD_TIMEOUT="${GOD_LLM_TIMEOUT:-900}"
GATE_MAX_RETRIES="${GOD_LLM_GATE_RETRIES:-10}"
TEST_MAX_RETRIES="${GOD_LLM_TEST_RETRIES:-10}"
AC_MAX_RETRIES="${GOD_LLM_AC_RETRIES:-10}"
DECISIONS_CONTEXT_LINES="${GOD_LLM_DECISIONS_CONTEXT_LINES:-120}"
DECISIONS_FILE="$AUTODEV/decisions.jsonl"
PHASE_BASELINE_FILE="$AUTODEV/.phase_baseline"
SUMMARY_FILE="$AUTODEV/summary.md"
BUG_HUNT_MAX_ROUNDS="${GOD_LLM_BUG_HUNT_ROUNDS:-15}"
BUG_REPORTS_DIR="$AUTODEV/bug_reports"

# ──── 执行顺序 ────
ALL_STEPS=(
    "CARD:A.1"
    "CARD:A.2"
    "CARD:A.4"
    "CARD:A.3"
    "GATE:A"
    "CARD:B.1"
    "CARD:B.2"
    "CARD:B.3"
    "CARD:B.4"
    "GATE:B"
    "CARD:C.1"
    "CARD:C.2"
    "CARD:C.3"
    "GATE:C"
    "CARD:D.1"
    "CARD:D.2"
    "CARD:D.3"
    "GATE:D"
    "CARD:E.1"
    "CARD:E.2"
    "GATE:E"
    "CARD:F.1"
    "CARD:F.2"
    "CARD:F.3"
    "CARD:F.4"
    "CARD:F.5"
    "GATE:F"
)

# ──── 颜色输出 ────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK  ]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_fail()  { echo -e "${RED}[FAIL]${NC} $1"; }
log_title() {
    echo ""
    echo -e "${BOLD}${CYAN}=================================================${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${BOLD}${CYAN}=================================================${NC}"
}

# ──── 进度管理 ────
is_completed() { grep -qxF "$1" "$STATE_FILE" 2>/dev/null; }
mark_completed() { echo "$1" >> "$STATE_FILE"; log_ok "完成: $1"; }
get_completed_count() {
    if [ -f "$STATE_FILE" ]; then wc -l < "$STATE_FILE" | tr -d ' '
    else echo "0"; fi
}

get_next_card_before_gate() {
    local gate_phase=$1 last_card=""
    for step in "${ALL_STEPS[@]}"; do
        local type="${step%%:*}" id="${step#*:}"
        if [ "$type" = "CARD" ]; then last_card="$id"
        elif [ "$type" = "GATE" ] && [ "$id" = "$gate_phase" ]; then break; fi
    done
    echo "${last_card:-A.1}"
}

# ──── Pipeline 文件防篡改保护 ────
_state_backup=""
protect_pipeline_files() {
    [ ! -f "$STATE_FILE" ] && return 0
    _state_backup="${STATE_FILE}.bak.$$"
    cp "$STATE_FILE" "$_state_backup"
    chmod 444 "$STATE_FILE" 2>/dev/null || true
    for f in "$CARDS_DIR"/*.md "$AUTODEV/autodev.sh" "$AUTODEV/system_prompt.md" "$AUTODEV/gate_check.sh"; do
        [ -f "$f" ] && chmod 444 "$f" 2>/dev/null || true
    done
}
unprotect_pipeline_files() {
    chmod 644 "$STATE_FILE" 2>/dev/null || true
    if [ -n "$_state_backup" ] && [ -f "$_state_backup" ]; then
        if ! diff -q "$STATE_FILE" "$_state_backup" > /dev/null 2>&1; then
            log_fail "🚨 STATE FILE TAMPERED by Claude agent! Restoring from backup..."
            cp "$_state_backup" "$STATE_FILE"
            chmod 644 "$STATE_FILE"
        fi
        rm -f "$_state_backup"
    fi
    _state_backup=""
    for f in "$CARDS_DIR"/*.md "$AUTODEV/autodev.sh" "$AUTODEV/system_prompt.md" "$AUTODEV/gate_check.sh"; do
        [ -f "$f" ] && chmod 644 "$f" 2>/dev/null || true
    done
}

# ──── 构建 Prompt ────
build_prompt() {
    local card_file="$CARDS_DIR/${1}.md"
    [ ! -f "$card_file" ] && { log_fail "Card 文件不存在: $card_file"; return 1; }
    {
        cat "$SYSTEM_PROMPT"; echo ""; echo "---"; echo ""
        echo "## 运行时信息"
        echo "DECISIONS_FILE: $DECISIONS_FILE"
        echo ""
        echo "## 当前进度"
        if [ -f "$STATE_FILE" ] && [ -s "$STATE_FILE" ]; then
            echo "已完成的 Card:"; cat "$STATE_FILE" | sed 's/^/- /'
        else echo "尚无已完成的 Card（首个任务）"; fi
        if [ -f "$DECISIONS_FILE" ] && [ -s "$DECISIONS_FILE" ]; then
            echo ""; echo "## 前序决策记录（最近 ${DECISIONS_CONTEXT_LINES} 条）"
            echo '```jsonl'; tail -n "$DECISIONS_CONTEXT_LINES" "$DECISIONS_FILE"; echo '```'
        fi
        echo ""; echo "---"; echo ""; cat "$card_file"
    }
}

# ──── 执行单张 Card ────
execute_card() {
    local card_id=$1 timestamp=$(date +%Y%m%d_%H%M%S)
    local log_file="$LOGS_DIR/card_${card_id//./_}_${timestamp}.log"
    log_title "Card $card_id"
    local prompt; prompt="$(build_prompt "$card_id")" || return 1
    log_info "Model: $MODEL | Timeout: ${CARD_TIMEOUT}s"
    log_info "Log: $log_file"; echo ""

    cd "$PROJECT_ROOT"
    local prompt_file; prompt_file=$(mktemp "${TMPDIR:-/tmp}/autodev_prompt.XXXXXX")
    printf '%s' "$prompt" > "$prompt_file"
    local exit_code=0
    protect_pipeline_files
    if [ -n "$TIMEOUT_CMD" ]; then
        $TIMEOUT_CMD "$CARD_TIMEOUT" claude -p --dangerously-skip-permissions --model "$MODEL" --verbose \
            < "$prompt_file" 2>&1 | tee "$log_file" || exit_code=$?
    else
        claude -p --dangerously-skip-permissions --model "$MODEL" --verbose \
            < "$prompt_file" 2>&1 | tee "$log_file" || exit_code=$?
    fi
    unprotect_pipeline_files
    rm -f "$prompt_file"

    [ $exit_code -eq 124 ] && { log_fail "Card $card_id 超时 (>${CARD_TIMEOUT}s)"; return 1; }
    [ $exit_code -ne 0 ] && { log_fail "Card $card_id 执行失败 (exit: $exit_code)"; return 1; }

    # 测试验证 + 自动修复循环
    echo ""
    local test_attempt=0 tests_passed=false
    local test_timeout=300
    while [ $test_attempt -lt $TEST_MAX_RETRIES ]; do
        test_attempt=$((test_attempt + 1))
        log_info "运行测试 (第 ${test_attempt}/${TEST_MAX_RETRIES} 次)..."
        cd "$PROJECT_ROOT"
        local test_output test_exit=0
        if [ -n "$TIMEOUT_CMD" ]; then
            test_output=$($TIMEOUT_CMD "$test_timeout" npx vitest run 2>&1) || test_exit=$?
        else
            test_output=$(npx vitest run 2>&1) || test_exit=$?
        fi
        if [ $test_exit -eq 124 ]; then
            log_fail "测试命令超时 (>${test_timeout}s)，可能存在交互式测试阻塞。"
            return 1
        fi
        [ $test_exit -eq 0 ] && tests_passed=true
        echo "$test_output" | tee -a "$log_file"
        [ "$tests_passed" = true ] && { log_ok "测试通过"; break; }

        if [ $test_attempt -lt $TEST_MAX_RETRIES ]; then
            log_warn "测试失败，AI 自动修复 ($test_attempt/$TEST_MAX_RETRIES)..."
            local fix_file; fix_file=$(mktemp "${TMPDIR:-/tmp}/autodev_fix.XXXXXX")
            {
                echo "Card $card_id 执行后测试失败，请修复。"
                echo ""
                echo "## 测试输出"
                echo '```'
                printf '%s\n' "$test_output"
                echo '```'
                echo ""
                cat <<'FIX_RULES_EOF'
## 规则
- 读取失败的测试文件和对应的实现代码
- 读取设计文档确认正确行为
- 修复后运行: npx vitest run
- 只修复导致测试失败的问题，不要做额外改动
- 不能破坏现有测试（向后兼容）
FIX_RULES_EOF
            } > "$fix_file"
            cd "$PROJECT_ROOT"
            protect_pipeline_files
            claude -p --dangerously-skip-permissions --model "$MODEL" --verbose \
                < "$fix_file" 2>&1 | tee -a "$log_file" || true
            unprotect_pipeline_files
            rm -f "$fix_file"
        fi
    done
    [ "$tests_passed" != true ] && { log_fail "Card $card_id 测试修复失败"; return 1; }

    # ──── 独立验收验证 + 自动修复闭环 ────
    local card_content
    card_content=$(cat "$CARDS_DIR/${card_id}.md")
    local ac_attempt=0 ac_passed=false
    while [ $ac_attempt -lt $AC_MAX_RETRIES ]; do
        ac_attempt=$((ac_attempt + 1))
        log_info "启动独立验收验证 (第 ${ac_attempt}/${AC_MAX_RETRIES} 次)..."
        local ac_file; ac_file=$(mktemp "${TMPDIR:-/tmp}/autodev_ac.XXXXXX")
        {
            echo "你是独立验收审计员（不是开发者）。验证 Card $card_id 的验收标准是否全部满足。"
            echo ""
            echo "## Card 完整内容"
            printf '%s\n' "$card_content"
            echo ""
            cat <<'VERIFY_STATIC_EOF'
## 请你：
1. 读取 Card 中"读取已有代码"列出的源文件，确认修改已就位
2. 运行 Card 中指定的测试命令，确认通过
3. 逐条检查验收标准（AC-1, AC-2, ...），判定 PASS 或 FAIL
4. 输出格式（严格遵守）：
   AC-1: PASS — 原因
   AC-2: FAIL — 原因
   ...
   VERDICT: ALL_PASS | HAS_FAILURES

重要：你是独立审计员。直接读文件和跑测试来验证，不要信任之前的 AI 输出。
VERIFY_STATIC_EOF
        } > "$ac_file"
        local verify_output verify_exit=0
        protect_pipeline_files
        verify_output=$(claude -p --dangerously-skip-permissions --model "$VERIFY_MODEL" --verbose < "$ac_file" 2>&1) || verify_exit=$?
        unprotect_pipeline_files
        rm -f "$ac_file"
        echo "$verify_output" | tee -a "$log_file"

        if [ $verify_exit -eq 0 ] && echo "$verify_output" | grep -q "VERDICT: ALL_PASS"; then
            log_ok "验收验证通过"
            ac_passed=true
            break
        fi

        if [ $verify_exit -ne 0 ]; then
            log_warn "验收验证 AI 异常退出 (exit: $verify_exit)，触发自恢复后重试"
        else
            log_warn "验收验证发现未满足的 AC，触发修复"
        fi

        local ac_fix_file; ac_fix_file=$(mktemp "${TMPDIR:-/tmp}/autodev_acfix.XXXXXX")
        {
            echo "验收审计发现以下 AC 未满足："
            echo ""
            printf '%s\n' "$verify_output"
            echo ""
            cat <<'AC_FIX_STATIC_EOF'
请修复未通过的验收标准。只修复未通过的项，不要改动已通过的部分。
修复后运行测试确认通过，并准备再次接受独立验收。
AC_FIX_STATIC_EOF
        } > "$ac_fix_file"
        protect_pipeline_files
        claude -p --dangerously-skip-permissions --model "$MODEL" --verbose \
            < "$ac_fix_file" 2>&1 | tee -a "$log_file"
        unprotect_pipeline_files
        rm -f "$ac_fix_file"

        cd "$PROJECT_ROOT"
        local ac_test_exit=0
        if [ -n "$TIMEOUT_CMD" ]; then
            $TIMEOUT_CMD "$test_timeout" npx vitest run 2>&1 | tee -a "$log_file" || ac_test_exit=$?
        else
            npx vitest run 2>&1 | tee -a "$log_file" || ac_test_exit=$?
        fi
        if [ $ac_test_exit -eq 124 ]; then
            log_fail "验收修复后测试超时 (>${test_timeout}s)"; return 1
        elif [ $ac_test_exit -ne 0 ]; then
            log_warn "Card $card_id 验收修复后测试仍失败，将继续自动修复"
        fi
    done
    [ "$ac_passed" != true ] && { log_fail "Card $card_id 验收验证未通过 (达到 AC 重试上限)"; return 1; }

    return 0
}

# ──── Phase Gate ────
run_phase_gate() {
    local phase=$1 timestamp=$(date +%Y%m%d_%H%M%S)
    local log_file="$LOGS_DIR/gate_${phase}_${timestamp}.log"
    log_title "Phase Gate: Phase $phase"

    if [ -f "$GATE_SCRIPT" ]; then
        local attempt=0 gate_passed=false
        while [ $attempt -lt $GATE_MAX_RETRIES ]; do
            attempt=$((attempt + 1))
            log_info "门禁检查 (第 ${attempt}/${GATE_MAX_RETRIES} 次)..."
            cd "$PROJECT_ROOT"
            local gate_output
            gate_output=$(bash "$GATE_SCRIPT" 2>&1) && gate_passed=true
            echo "$gate_output" | tee -a "$log_file"
            [ "$gate_passed" = true ] && { log_ok "自动门禁通过"; break; }
            if [ $attempt -lt $GATE_MAX_RETRIES ]; then
                log_warn "门禁未通过，AI 自动修复..."
                local gate_fix_file; gate_fix_file=$(mktemp "${TMPDIR:-/tmp}/autodev_gatefix.XXXXXX")
                {
                    echo "门禁检查报告了以下问题，请修复:"
                    printf '%s\n' "$gate_output"
                    echo "读取设计文档和测试确认正确行为。只修复问题，不做额外改动。"
                } > "$gate_fix_file"
                protect_pipeline_files
                claude -p --dangerously-skip-permissions --model "$MODEL" --verbose \
                    < "$gate_fix_file" 2>&1 | tee -a "$log_file" || true
                unprotect_pipeline_files
                rm -f "$gate_fix_file"
            fi
        done
        [ "$gate_passed" != true ] && { log_fail "门禁经 $GATE_MAX_RETRIES 次修复仍未通过"; return 1; }
    fi

    log_info "运行 AI 审计..."
    local gate_audit_file; gate_audit_file=$(mktemp "${TMPDIR:-/tmp}/autodev_audit.XXXXXX")
    {
        cat "$CARDS_DIR/phase_gate.md"
        echo ""
        echo "---"
        echo "当前审计: Phase $phase"
        echo "已完成的 Card:"
        grep "^CARD:" "$STATE_FILE" 2>/dev/null | sed 's/^CARD:/- /' || echo "（无）"
    } > "$gate_audit_file"
    protect_pipeline_files
    claude -p --dangerously-skip-permissions --model "$MODEL" --verbose \
        < "$gate_audit_file" 2>&1 | tee -a "$log_file" || true
    unprotect_pipeline_files
    rm -f "$gate_audit_file"
    log_ok "Phase Gate $phase 完成"

    git rev-parse HEAD > "$PHASE_BASELINE_FILE" 2>/dev/null || true
    return 0
}

# ──── Pipeline 完成总结 ────
generate_summary() {
    log_title "生成 Pipeline 完成总结"
    local completed_cards
    completed_cards=$(grep "^CARD:" "$STATE_FILE" 2>/dev/null | sed 's/CARD://' | tr '\n' ', ' | sed 's/,$//' || true)
    local completed_gates
    completed_gates=$(grep "^GATE:" "$STATE_FILE" 2>/dev/null | sed 's/GATE://' | tr '\n' ', ' | sed 's/,$//' || true)

    local diff_ref="${PIPELINE_BASELINE:-HEAD}"
    local git_diff_stat git_diff_files
    cd "$PROJECT_ROOT"
    # 优先用 git diff；非 git 项目回退到扫描 src/
    if git rev-parse --git-dir >/dev/null 2>&1; then
        git_diff_stat=$(git diff --stat "$diff_ref" 2>/dev/null || echo "(no git changes)")
        git_diff_files=$({ git diff --name-only "$diff_ref" 2>/dev/null || true; git diff --name-only 2>/dev/null || true; } | sort -u || true)
    else
        git_diff_stat="(not a git repository)"
        git_diff_files=$(find src/ -name "*.ts" -not -path "*/node_modules/*" 2>/dev/null | sort || true)
    fi
    local decisions_content=""
    if [ -f "$DECISIONS_FILE" ] && [ -s "$DECISIONS_FILE" ]; then
        decisions_content=$(cat "$DECISIONS_FILE")
    fi
    local log_files
    log_files=$(ls -1t "$LOGS_DIR"/*.log 2>/dev/null | head -20 || true)

    local summary_file_prompt; summary_file_prompt=$(mktemp "${TMPDIR:-/tmp}/autodev_summary.XXXXXX")
    {
        cat <<'SUMMARY_STATIC_1'
你是 Pipeline 总结报告员。请根据以下信息生成一份结构化总结报告（Markdown 格式）。

## Pipeline 信息
SUMMARY_STATIC_1
        echo "- 项目: God LLM Orchestrator"
        echo "- 完成的 Cards: $completed_cards"
        echo "- 完成的 Gates: $completed_gates"
        echo ""
        echo "## Git 变更统计"
        echo '```'
        printf '%s\n' "$git_diff_stat"
        echo '```'
        echo ""
        echo "## 变更的文件列表"
        printf '%s\n' "$git_diff_files"
        echo ""
        echo "## 决策记录"
        echo '```jsonl'
        printf '%s\n' "$decisions_content"
        echo '```'
        echo ""
        cat <<'SUMMARY_STATIC_2'
## 请你：
1. 读取上述变更的文件，理解每个文件做了什么修改
2. 生成以下格式的总结报告，直接输出 Markdown 内容（不需要代码块包裹）：

# God LLM Orchestrator — Pipeline 完成总结

## 实现概要
（用 2-3 句话概括本次 pipeline 实现了什么）

## 变更清单
| 文件 | 变更类型 | 说明 |
|------|----------|------|
（每个变更文件一行：新增/修改/删除 + 一句话说明做了什么）

## 关键决策
（从 decisions.jsonl 提取，如无则写"无"）
- 【Card X.Y】决策描述 — 选择了方案 A，原因...

## 测试结果
（从 log 文件名推断哪些 Card 执行了，整体结论）

## 注意事项
（任何残余风险、TODO、或后续建议，如无则写"无"）

重要：只输出 Markdown 报告本身，不要用代码块包裹。
SUMMARY_STATIC_2
    } > "$summary_file_prompt"

    local summary_output
    summary_output=$(claude -p --dangerously-skip-permissions --model "$VERIFY_MODEL" --verbose < "$summary_file_prompt" 2>&1) || true
    rm -f "$summary_file_prompt"

    echo "$summary_output" > "$SUMMARY_FILE"
    log_ok "总结报告已生成: $SUMMARY_FILE"

    echo ""
    echo -e "${BOLD}${CYAN}=================================================${NC}"
    echo -e "${BOLD}${CYAN}  Pipeline 完成总结${NC}"
    echo -e "${BOLD}${CYAN}=================================================${NC}"
    echo ""
    cat "$SUMMARY_FILE"
    echo ""
}

# ──── Bug Hunt Phase ────
run_bug_hunt() {
    if is_completed "BUG_HUNT_DONE"; then
        log_info "Bug Hunt 已完成（跳过）"
        return 0
    fi

    log_title "Bug Hunt Phase 启动"
    local diff_ref="${PIPELINE_BASELINE:-HEAD}"

    local round=0
    while is_completed "BUG_HUNT_ROUND:$((round + 1))"; do
        round=$((round + 1))
        log_info "跳过已完成: Bug Hunt Round $round"
    done

    while [ $round -lt $BUG_HUNT_MAX_ROUNDS ]; do
        round=$((round + 1))
        log_title "Bug Hunt — Round ${round}/${BUG_HUNT_MAX_ROUNDS}"

        local report_file="$BUG_REPORTS_DIR/bug_report_round_${round}.md"
        local scan_file; scan_file=$(mktemp "${TMPDIR:-/tmp}/autodev_bughunt_scan.XXXXXX")
        cd "$PROJECT_ROOT"
        local git_diff_files
        # 优先用 git diff；非 git 项目回退到扫描 src/ 下所有源文件
        if git rev-parse --git-dir >/dev/null 2>&1; then
            git_diff_files=$({ git diff --name-only "$diff_ref" 2>/dev/null || true; git diff --name-only 2>/dev/null || true; } | sort -u || true)
        else
            git_diff_files=$(find src/ -name "*.ts" -not -path "*/node_modules/*" 2>/dev/null | sort || true)
        fi
        if [ -z "$git_diff_files" ]; then
            log_warn "无变更文件，跳过 Bug Hunt"
            break
        fi
        local summary_content=""
        [ -f "$SUMMARY_FILE" ] && summary_content=$(cat "$SUMMARY_FILE")
        local requirements_content=""
        for card_file in "$CARDS_DIR"/*.md; do
            [ -f "$card_file" ] || continue
            case "$(basename "$card_file")" in
                phase_gate.md) continue ;;
            esac
            requirements_content="${requirements_content}
--- $(basename "$card_file") ---
$(cat "$card_file")
"
        done
        {
            cat <<'BH_SCAN_STATIC_1'
你是独立 Bug 审计员（不是开发者）。你的任务是对已完成的代码进行全面 Bug 扫描。

## 重要约束
- 你只有只读权限。不要修改、创建或删除任何文件。只读取和报告。
- 只报告真实存在的 bug，不要报告代码风格问题。
- 不要猜测或假设 bug，必须有源代码中的具体证据。

## 扫描方法
1. 读取下面列出的所有变更文件的源代码
2. 对照原始需求（Cards），逐一检查功能是否正确实现
3. 检查边界条件、错误处理、类型安全、安全漏洞
4. 检查现有测试的覆盖是否充分

## Bug 分级标准
- **P0**: 崩溃、数据丢失、安全漏洞、核心功能完全不可用
- **P1**: 功能未按需求实现、显著逻辑错误、重要边界条件缺失
- **P2**: 次要边界条件、缺少输入校验、错误信息不准确、测试覆盖不足

BH_SCAN_STATIC_1
            echo "## Pipeline 完成总结"
            printf '%s\n' "$summary_content"
            echo ""
            echo "## 变更的文件列表（请逐一读取源代码）"
            printf '%s\n' "$git_diff_files"
            echo ""
            echo "## 原始需求（Cards）"
            printf '%s\n' "$requirements_content"
            echo ""
            if [ $round -gt 1 ]; then
                echo "## 前几轮已发现并处理的 Bug（不要重复报告这些已修复的 bug）"
                for prev_rf in "$BUG_REPORTS_DIR"/bug_report_round_*.md; do
                    [ -f "$prev_rf" ] && { echo "--- $(basename "$prev_rf") ---"; cat "$prev_rf"; echo ""; }
                done
                echo ""
            fi
            cat <<'BH_SCAN_STATIC_2'
## 输出格式（严格遵守）

如果发现 bug，按以下格式输出：

### BUG-1 [P0] 简短描述
- 文件: path/to/file.py:行号
- 问题: 具体问题描述
- 预期: 正确的行为应该是什么
- 建议修复: 如何修复

### BUG-2 [P1] 简短描述
...

如果没有发现任何 P0/P1/P2 级别的 bug，输出：

VERDICT: NO_BUGS_FOUND

如果发现了 bug，在末尾输出：

VERDICT: BUGS_FOUND | P0:数量 P1:数量 P2:数量

重要：
- 你是独立审计员。直接读源文件来验证，不要信任之前的 AI 输出。
- 只报告有充分证据的真实 bug。
- 不要重复报告前几轮已发现并修复的 bug，只报告当前代码中仍然存在的新问题。
BH_SCAN_STATIC_2
        } > "$scan_file"

        log_info "Bug Scan 中 (VERIFY_MODEL: $VERIFY_MODEL)..."
        local scan_output scan_exit=0
        scan_output=$(claude -p --dangerously-skip-permissions --model "$VERIFY_MODEL" --verbose < "$scan_file" 2>>"$LOGS_DIR/bug_hunt_round_${round}.log") || scan_exit=$?
        rm -f "$scan_file"
        echo "$scan_output" > "$report_file"
        log_ok "Bug 报告已保存: $report_file"

        if [ $scan_exit -eq 0 ] && echo "$scan_output" | grep -q "VERDICT: NO_BUGS_FOUND"; then
            log_ok "Bug Hunt 完成 — Round $round 未发现新 bug"
            mark_completed "BUG_HUNT_ROUND:$round"
            break
        fi

        if [ $scan_exit -ne 0 ]; then
            log_warn "Bug Scan AI 异常退出 (exit: $scan_exit)，跳过本轮继续下一轮"
            continue
        fi

        log_warn "发现 bug，进入修复流程"

        local fix_attempt=0 all_fixed=false
        while [ $fix_attempt -lt $AC_MAX_RETRIES ]; do
            fix_attempt=$((fix_attempt + 1))

            log_info "Bug Fix (第 ${fix_attempt}/${AC_MAX_RETRIES} 次)..."
            local fix_file; fix_file=$(mktemp "${TMPDIR:-/tmp}/autodev_bughunt_fix.XXXXXX")
            {
                if [ $fix_attempt -gt 1 ] && [ -n "${verify_output:-}" ]; then
                    echo "## 上一次修复的验证结果（请特别关注 NOT_FIXED 和 PARTIAL 的项目）"
                    printf '%s\n' "$verify_output"
                    echo ""
                fi
                echo "以下是独立审计员发现的 bug 报告："
                echo ""
                printf '%s\n' "$scan_output"
                echo ""
                cat <<'BH_FIX_STATIC_EOF'
## 你的任务
1. 读取报告中提到的每个文件
2. 修复所有列出的 P0/P1/P2 bug
3. 为每个 bug 编写对应的回归测试（确保 bug 不会再次出现）
4. 运行全量测试确认通过: npx vitest run

## 规则
- 每个 bug 必须有对应的回归测试
- 回归测试放在项目现有的测试文件中（或与被修复代码相邻的测试文件中）
- 测试命名以 test_bug_ 或 test_regression_ 为前缀，便于识别
- 使用项目现有的测试框架和模式
- 不能破坏现有测试（向后兼容）
- 修复后运行测试确认全部通过
- 只修复报告中列出的 bug，不要做额外重构
BH_FIX_STATIC_EOF
            } > "$fix_file"
            cd "$PROJECT_ROOT"
            protect_pipeline_files
            claude -p --dangerously-skip-permissions --model "$MODEL" --verbose \
                < "$fix_file" 2>&1 | tee -a "$LOGS_DIR/bug_hunt_round_${round}.log" || true
            unprotect_pipeline_files
            rm -f "$fix_file"

            log_info "Bug Fix 后运行测试..."
            local test_attempt=0 tests_passed=false
            local test_timeout=300
            while [ $test_attempt -lt $TEST_MAX_RETRIES ]; do
                test_attempt=$((test_attempt + 1))
                log_info "运行测试 (第 ${test_attempt}/${TEST_MAX_RETRIES} 次)..."
                cd "$PROJECT_ROOT"
                local test_output test_exit=0
                if [ -n "$TIMEOUT_CMD" ]; then
                    test_output=$($TIMEOUT_CMD "$test_timeout" npx vitest run 2>&1) || test_exit=$?
                else
                    test_output=$(npx vitest run 2>&1) || test_exit=$?
                fi
                if [ $test_exit -eq 124 ]; then
                    log_fail "测试超时 (>${test_timeout}s)"; break
                fi
                [ $test_exit -eq 0 ] && tests_passed=true
                echo "$test_output" | tee -a "$LOGS_DIR/bug_hunt_round_${round}.log"
                [ "$tests_passed" = true ] && { log_ok "测试通过"; break; }

                if [ $test_attempt -lt $TEST_MAX_RETRIES ]; then
                    log_warn "测试失败，AI 自动修复 ($test_attempt/$TEST_MAX_RETRIES)..."
                    local tfix_file; tfix_file=$(mktemp "${TMPDIR:-/tmp}/autodev_bh_tfix.XXXXXX")
                    {
                        echo "Bug Hunt 修复后测试失败，请修复。"
                        echo ""
                        echo "## 当前正在修复的 Bug 报告（参考上下文）"
                        printf '%s\n' "$scan_output"
                        echo ""
                        echo "## 测试输出"
                        echo '```'
                        printf '%s\n' "$test_output"
                        echo '```'
                        echo ""
                        cat <<'BH_TFIX_RULES_EOF'
## 规则
- 读取失败的测试文件和对应的实现代码
- 如果不确定测试的预期行为，读取上面的 bug 报告和需求文档来确认
- 优先修复实现代码而非修改测试的预期值（除非测试本身有错误）
- 修复后运行: npx vitest run
- 只修复导致测试失败的问题，不要做额外改动
- 不能破坏现有测试
BH_TFIX_RULES_EOF
                    } > "$tfix_file"
                    cd "$PROJECT_ROOT"
                    protect_pipeline_files
                    claude -p --dangerously-skip-permissions --model "$MODEL" --verbose \
                        < "$tfix_file" 2>&1 | tee -a "$LOGS_DIR/bug_hunt_round_${round}.log" || true
                    unprotect_pipeline_files
                    rm -f "$tfix_file"
                fi
            done

            if [ "$tests_passed" != true ]; then
                log_warn "Bug Fix 后测试仍失败，继续下一轮修复尝试"
                continue
            fi

            log_info "验证 Bug 修复 (第 ${fix_attempt}/${AC_MAX_RETRIES} 次)..."
            local verify_file; verify_file=$(mktemp "${TMPDIR:-/tmp}/autodev_bughunt_verify.XXXXXX")
            {
                echo "你是独立审计员（只读角色，不要修改任何文件）。以下是之前发现的 bug 报告："
                echo ""
                printf '%s\n' "$scan_output"
                echo ""
                cat <<'BH_VERIFY_STATIC_EOF'
## 重要约束
- 你只有只读权限。不要修改、创建或删除任何文件。只读取和验证。

## 你的任务
1. 逐一检查报告中的每个 bug 是否已被修复（读取源文件确认）
2. 检查每个 bug 是否有对应的回归测试，且该测试确实能覆盖修复的场景（不是空壳测试）
3. 运行测试确认通过: npx vitest run
4. 检查修复是否引入了新的问题

## 输出格式（严格遵守）
BUG-1: FIXED — 说明 | 回归测试: YES/NO
BUG-2: PARTIAL — 主要场景已修复但边界条件仍存在 | 回归测试: YES/NO
BUG-3: NOT_FIXED — 说明
...
VERDICT: ALL_FIXED | HAS_UNFIXED

说明：PARTIAL 视为未修复，计入 HAS_UNFIXED。

重要：直接读源文件和测试文件来验证，不要信任之前的 AI 输出。
BH_VERIFY_STATIC_EOF
            } > "$verify_file"
            local verify_output verify_exit=0
            protect_pipeline_files
            verify_output=$(claude -p --dangerously-skip-permissions --model "$VERIFY_MODEL" --verbose < "$verify_file" 2>>"$LOGS_DIR/bug_hunt_round_${round}.log") || verify_exit=$?
            unprotect_pipeline_files
            rm -f "$verify_file"
            echo "$verify_output" | tee -a "$LOGS_DIR/bug_hunt_round_${round}.log"

            if [ $verify_exit -eq 0 ] && echo "$verify_output" | grep -q "VERDICT: ALL_FIXED"; then
                log_ok "所有 bug 已修复并验证"
                all_fixed=true
                break
            fi

            log_warn "部分 bug 未修复，继续修复尝试"
        done

        if [ "$all_fixed" != true ]; then
            log_warn "Round $round: 经 $AC_MAX_RETRIES 次修复仍有未解决的 bug，进入下一轮全量扫描"
        fi
        mark_completed "BUG_HUNT_ROUND:$round"
    done

    if [ $round -ge $BUG_HUNT_MAX_ROUNDS ]; then
        log_warn "Bug Hunt 达到最大轮次 ($BUG_HUNT_MAX_ROUNDS)，部分 bug 可能未解决"
        log_warn "请查看最新报告: $BUG_REPORTS_DIR/bug_report_round_${round}.md"
    fi

    log_info "更新 summary.md，追加 Bug Hunt 结果..."
    if [ ! -f "$SUMMARY_FILE" ]; then
        log_warn "summary.md 不存在，跳过 Bug Hunt 结果追加"
        mark_completed "BUG_HUNT_DONE"
        return 0
    fi
    local bh_summary_file; bh_summary_file=$(mktemp "${TMPDIR:-/tmp}/autodev_bh_summary.XXXXXX")
    {
        echo "## Bug Hunt 报告数据"
        echo "总轮次: $round"
        for rf in "$BUG_REPORTS_DIR"/bug_report_round_*.md; do
            [ -f "$rf" ] && { echo "--- $(basename "$rf") ---"; cat "$rf"; echo ""; }
        done
        echo ""
        cat <<'BH_SUMMARY_STATIC_EOF'
请根据上面的 Bug Hunt 报告数据，只输出一个新的 Markdown 章节（不要包含已有的 summary 内容）。格式如下：

## Bug Hunt 结果
- 扫描轮次: N
- 发现并修复的 bug 数量: X
- 剩余未修复: Y（如有）
- 新增回归测试: Z 个

### 修复的 Bug 列表
| Bug ID | 优先级 | 描述 | 状态 |
|--------|--------|------|------|

重要：只输出上面这个章节的 Markdown 内容。不要输出其他内容，不要用代码块包裹。
BH_SUMMARY_STATIC_EOF
    } > "$bh_summary_file"
    local bh_section
    bh_section=$(claude -p --dangerously-skip-permissions --model "$VERIFY_MODEL" --verbose < "$bh_summary_file" 2>>"$LOGS_DIR/bug_hunt_summary.log") || true
    rm -f "$bh_summary_file"
    { echo ""; echo "$bh_section"; } >> "$SUMMARY_FILE"
    log_ok "summary.md 已更新（追加 Bug Hunt 结果）"
    mark_completed "BUG_HUNT_DONE"
}

# ──── CLI ────
show_help() {
    echo "God LLM Orchestrator — Automated Development Pipeline"
    echo ""
    echo "用法: ./Autodev/god-llm-orchestrator/autodev.sh [OPTIONS]"
    echo ""
    echo "选项:"
    echo "  --from CARD_ID    从指定 Card 开始 (如 --from B.1)"
    echo "  --model MODEL     Claude 模型 (默认: opus)"
    echo "  --reset           清除所有进度，从头开始"
    echo "  --dry-run         只显示执行计划，不实际执行"
    echo "  --status          显示当前进度"
    echo "  --help            显示此帮助"
}

show_status() {
    local total=${#ALL_STEPS[@]} done=$(get_completed_count)
    echo ""; echo "God LLM Orchestrator 开发进度: $done / $total"; echo ""
    for step in "${ALL_STEPS[@]}"; do
        local id="${step#*:}" type="${step%%:*}"
        if is_completed "$step"; then
            echo -e "  ${GREEN}[DONE]${NC} [$type] $id"
        else
            echo -e "  ⬜ [$type] $id"
        fi
    done
}

main() {
    local start_from="" dry_run=false
    while [[ $# -gt 0 ]]; do
        case $1 in
            --from)     start_from="$2"; shift 2 ;;
            --model)    MODEL="$2"; shift 2 ;;
            --reset)    rm -f "$STATE_FILE" "$AUTODEV/.pipeline_baseline"; rm -rf "$BUG_REPORTS_DIR"/*.md 2>/dev/null; log_info "进度已清除（含 Bug Hunt 报告和 Pipeline 基线）"; shift ;;
            --dry-run)  dry_run=true; shift ;;
            --status)   show_status; exit 0 ;;
            --help)     show_help; exit 0 ;;
            *)          log_fail "未知选项: $1"; show_help; exit 1 ;;
        esac
    done

    mkdir -p "$LOGS_DIR"
    mkdir -p "$BUG_REPORTS_DIR"
    touch "$STATE_FILE"

    trap 'unprotect_pipeline_files 2>/dev/null; rm -f "${STATE_FILE}.bak.$$" 2>/dev/null' EXIT INT TERM

    # 持久化 Pipeline 基线：只在首次运行时记录，续跑时读取原始基线
    local baseline_file="$AUTODEV/.pipeline_baseline"
    if [ -f "$baseline_file" ]; then
        PIPELINE_BASELINE=$(cat "$baseline_file")
    elif git rev-parse --git-dir >/dev/null 2>&1; then
        PIPELINE_BASELINE=$(cd "$PROJECT_ROOT" && git rev-parse HEAD 2>/dev/null || echo "")
        echo "$PIPELINE_BASELINE" > "$baseline_file"
    else
        PIPELINE_BASELINE=""
        echo "" > "$baseline_file"
    fi

    log_title "God LLM Orchestrator — Pipeline 启动"
    log_info "Model: $MODEL | Progress: $(get_completed_count)/${#ALL_STEPS[@]}"

    if [ "$dry_run" = true ]; then
        for step in "${ALL_STEPS[@]}"; do
            local type="${step%%:*}" id="${step#*:}"
            if is_completed "$step"; then
                echo -e "  ${GREEN}[SKIP]${NC} $type $id"
            else
                echo -e "  ${YELLOW}[TODO]${NC} $type $id"
            fi
        done
        exit 0
    fi

    local skip=false cards_executed=0 start_time=$(date +%s)
    [ -n "$start_from" ] && skip=true

    for step in "${ALL_STEPS[@]}"; do
        local type="${step%%:*}" id="${step#*:}"
        if [ "$skip" = true ]; then
            [ "$id" = "$start_from" ] && skip=false || continue
        fi
        is_completed "$step" && { log_info "跳过已完成: $type $id"; continue; }

        if [ "$type" = "GATE" ]; then
            run_phase_gate "$id" && mark_completed "$step" || { log_fail "Gate $id 失败"; exit 1; }
        elif [ "$type" = "CARD" ]; then
            execute_card "$id" && { mark_completed "$step"; cards_executed=$((cards_executed + 1)); } \
                || { log_fail "Card $id 失败，重跑: ./Autodev/god-llm-orchestrator/autodev.sh --from $id"; exit 1; }
        fi
    done

    generate_summary
    run_bug_hunt
    local elapsed=$(( ($(date +%s) - start_time) / 60 ))
    log_title "Pipeline 完成！Cards: $cards_executed | Bug Hunt: max ${BUG_HUNT_MAX_ROUNDS} rounds | 耗时: ${elapsed}m"
}
main "$@"
