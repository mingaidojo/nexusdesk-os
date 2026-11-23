#!/usr/bin/env bash
# ==============================================================================
# NexusDesk Inference Engine Test Harness
# Tests 'agy' (Antigravity CLI / Gemini) and 'claude' (Claude Code CLI / Anthropic)
# using the exact binary discovery chains and execution flags from the backend.
# Includes profiling for Standard Mode vs Fast Mode (--disable-slash-commands --effort low).
# ==============================================================================

set -euo pipefail

# ANSI Color Codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default probe prompt
DEFAULT_PROMPT="Respond with: 'SYSTEM_CHECK_OK' followed by your model name and 1 sentence describing your current role."
TEST_PROMPT="${2:-$DEFAULT_PROMPT}"
TARGET_ENGINE="${1:-all}"

# Summary metrics array
declare -a SUMMARY_NAMES=()
declare -a SUMMARY_STATUS=()
declare -a SUMMARY_TIMES=()

echo -e "${BOLD}${CYAN}======================================================${NC}"
echo -e "${BOLD}${CYAN}   NexusDesk Inference Engines Verification Suite     ${NC}"
echo -e "${BOLD}${CYAN}======================================================${NC}"
echo -e "Prompt: \"${YELLOW}${TEST_PROMPT}${NC}\""
echo ""

# Helper to locate binary
find_binary() {
    local target_user="$1"
    local bin_name="$2"
    local candidates=(
        "/home/${target_user}/.local/bin/${bin_name}"
        "/usr/local/bin/${bin_name}"
        "/usr/bin/${bin_name}"
    )

    for cand in "${candidates[@]}"; do
        if [[ -x "$cand" ]]; then
            echo "$cand"
            return 0
        fi
    done

    # Fallback to which
    if command -v "$bin_name" >/dev/null 2>&1; then
        command -v "$bin_name"
        return 0
    fi

    # Known fallback paths
    if [[ "$bin_name" == "claude" && -x "/home/freecoder/.local/bin/claude" ]]; then
        echo "/home/freecoder/.local/bin/claude"
        return 0
    fi
    if [[ "$bin_name" == "agy" && -x "/home/myvirtualcoder/.local/bin/agy" ]]; then
        echo "/home/myvirtualcoder/.local/bin/agy"
        return 0
    fi

    echo ""
}

# ------------------------------------------------------------------------------
# Test AGY Engine (Standard or Fast Mode)
# ------------------------------------------------------------------------------
test_agy_instance() {
    local mode="$1" # "standard" or "fast"
    local user="myvirtualcoder"
    local model="gemini-3.8-flash"
    local bin
    bin=$(find_binary "$user" "agy")

    local title="AGY (${mode^^})"
    echo -e "${BOLD}${BLUE}>>> Testing Engine: ${title} (Google Antigravity CLI / Gemini)${NC}"
    echo -e "  User  : ${user}"
    echo -e "  Model : ${model}"
    echo -e "  Binary: ${bin:-NOT FOUND}"

    if [[ -z "$bin" ]]; then
        echo -e "${RED}[FAIL] agy binary not found in candidate paths.${NC}\n"
        SUMMARY_NAMES+=("$title")
        SUMMARY_STATUS+=("FAIL (No Binary)")
        SUMMARY_TIMES+=("0.00s")
        return 1
    fi

    local -a cmd_args=(
        "sudo" "-u" "$user" "-H" "--" "$bin"
        "-p" "$TEST_PROMPT"
        "--dangerously-skip-permissions"
        "--output-format" "text"
        "--model" "$model"
    )

    if [[ "$mode" == "fast" ]]; then
        cmd_args+=("--disable-slash-commands" "--effort" "low")
        echo -e "  Flags : ${MAGENTA}--disable-slash-commands --effort low (Bypass skill-indexing & low reasoning latency)${NC}"
    else
        echo -e "  Flags : ${CYAN}Default settings (Full plugin & skill indexing + medium effort)${NC}"
    fi

    local start_time
    start_time=$(date +%s%N)

    local output=""
    local status=0

    set +e
    output=$("${cmd_args[@]}" 2>&1)
    status=$?
    set -e

    local end_time
    end_time=$(date +%s%N)
    local elapsed
    elapsed=$(echo "scale=2; ($end_time - $start_time) / 1000000000" | bc)

    SUMMARY_NAMES+=("$title")
    SUMMARY_TIMES+=("${elapsed}s")

    if [[ $status -eq 0 && -n "$output" ]]; then
        echo -e "  ${GREEN}[PASS] Responded in ${elapsed}s${NC}"
        SUMMARY_STATUS+=("PASS")
        echo -e "  ${BOLD}Output:${NC}"
        echo "------------------------------------------------------"
        echo "$output" | sed 's/^/  /'
        echo "------------------------------------------------------"
    else
        echo -e "  ${RED}[FAIL] Command exited with code ${status} after ${elapsed}s${NC}"
        SUMMARY_STATUS+=("FAIL")
        echo -e "  ${BOLD}Error / Output:${NC}"
        echo "$output" | sed 's/^/  /'
    fi
    echo ""
}

# ------------------------------------------------------------------------------
# Test Claude Engine
# ------------------------------------------------------------------------------
test_claude() {
    local user="freecoder"
    local model="claude-sonnet-5-5"
    local bin
    bin=$(find_binary "$user" "claude")
    local title="Claude Code (Sonnet 5.5)"

    echo -e "${BOLD}${YELLOW}>>> Testing Engine: ${title} (Anthropic)${NC}"
    echo -e "  User  : ${user}"
    echo -e "  Model : ${model}"
    echo -e "  Binary: ${bin:-NOT FOUND}"

    if [[ -z "$bin" ]]; then
        echo -e "${RED}[FAIL] claude binary not found in candidate paths.${NC}\n"
        SUMMARY_NAMES+=("$title")
        SUMMARY_STATUS+=("FAIL (No Binary)")
        SUMMARY_TIMES+=("0.00s")
        return 1
    fi

    echo -e "  Executing: ${CYAN}sudo -u ${user} -H -- ${bin} -p ... --output-format text --model ${model}${NC}"

    local start_time
    start_time=$(date +%s%N)

    local output=""
    local status=0

    set +e
    output=$(sudo -u "$user" -H -- "$bin" \
        -p "$TEST_PROMPT" \
        --output-format text \
        --model "$model" 2>&1)
    status=$?

    # Fallback retry if model access error occurs (matches backend logic)
    if [[ "$output" == *"issue with the selected model"* || "$output" == *"may not exist or you may not have access"* ]]; then
        echo -e "  ${YELLOW}[RETRY] Model '${model}' triggered fallback. Retrying with 'sonnet'...${NC}"
        output=$(sudo -u "$user" -H -- "$bin" \
            -p "$TEST_PROMPT" \
            --output-format text \
            --model sonnet 2>&1)
        status=$?
    fi
    set -e

    local end_time
    end_time=$(date +%s%N)
    local elapsed
    elapsed=$(echo "scale=2; ($end_time - $start_time) / 1000000000" | bc)

    SUMMARY_NAMES+=("$title")
    SUMMARY_TIMES+=("${elapsed}s")

    if [[ $status -eq 0 && -n "$output" ]]; then
        echo -e "  ${GREEN}[PASS] Responded in ${elapsed}s${NC}"
        SUMMARY_STATUS+=("PASS")
        echo -e "  ${BOLD}Output:${NC}"
        echo "------------------------------------------------------"
        echo "$output" | sed 's/^/  /'
        echo "------------------------------------------------------"
    else
        echo -e "  ${RED}[FAIL] Command exited with code ${status} after ${elapsed}s${NC}"
        SUMMARY_STATUS+=("FAIL")
        echo -e "  ${BOLD}Error / Output:${NC}"
        echo "$output" | sed 's/^/  /'
    fi
    echo ""
}

# ------------------------------------------------------------------------------
# Dispatch
# ------------------------------------------------------------------------------
case "$TARGET_ENGINE" in
    agy)
        test_agy_instance "standard"
        ;;
    agy-fast)
        test_agy_instance "fast"
        ;;
    claude)
        test_claude
        ;;
    all)
        test_agy_instance "fast"
        test_agy_instance "standard"
        test_claude
        ;;
    *)
        echo -e "${RED}Usage: $0 [all|agy|agy-fast|claude] [optional_prompt]${NC}"
        exit 1
        ;;
esac

# ------------------------------------------------------------------------------
# Latency Summary Table
# ------------------------------------------------------------------------------
echo -e "${BOLD}${CYAN}======================================================${NC}"
echo -e "${BOLD}${CYAN}            Inference Performance Summary             ${NC}"
echo -e "${BOLD}${CYAN}======================================================${NC}"
printf "%-30s | %-10s | %-10s\n" "Engine / Mode" "Status" "Latency"
echo "------------------------------------------------------"
for i in "${!SUMMARY_NAMES[@]}"; do
    stat="${SUMMARY_STATUS[$i]}"
    if [[ "$stat" == "PASS" ]]; then
        stat_colored="${GREEN}${stat}${NC}"
    else
        stat_colored="${RED}${stat}${NC}"
    fi
    printf "%-30s | %-19b | %-10s\n" "${SUMMARY_NAMES[$i]}" "$stat_colored" "${SUMMARY_TIMES[$i]}"
done
echo "------------------------------------------------------"
echo -e "${BOLD}${GREEN}Verification suite complete.${NC}\n"
