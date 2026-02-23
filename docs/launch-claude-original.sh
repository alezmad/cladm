#!/bin/bash
# Launch Claude Code in new Terminal windows for selected project folders
# Discovers projects from Claude's own conversation history + filesystem scan
#
# Usage:
#   ./launch-claude.sh              # Interactive picker (default: history mode)
#   ./launch-claude.sh --all        # Launch all detected projects
#   ./launch-claude.sh --scan       # Filesystem scan mode (ignore history)
#   ./launch-claude.sh --depth 5    # Scan depth for filesystem mode (default: 3)
#   ./launch-claude.sh arrio nuc    # Launch specific folders directly

# ─── CONFIG ───────────────────────────────────────────────────────────
SCAN_ROOT="$HOME/Desktop"
MAX_DEPTH=3
CLAUDE_HISTORY="$HOME/.claude/history.jsonl"
CLAUDE_PROJECTS="$HOME/.claude/projects"
# ──────────────────────────────────────────────────────────────────────

MODE="history"  # history or scan

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --depth) MAX_DEPTH="$2"; shift 2 ;;
    --scan)  MODE="scan"; shift ;;
    --all)   MODE="all"; shift ;;
    *)       break ;;
  esac
done

# ─── HELPERS ──────────────────────────────────────────────────────────

is_project() {
  local dir="$1"
  [ -d "$dir/.git" ] || [ -f "$dir/package.json" ] || [ -f "$dir/pyproject.toml" ] || \
  [ -f "$dir/setup.py" ] || [ -f "$dir/requirements.txt" ] || [ -f "$dir/Cargo.toml" ] || \
  [ -f "$dir/go.mod" ] || [ -f "$dir/Gemfile" ] || [ -f "$dir/composer.json" ] || \
  [ -f "$dir/CLAUDE.md" ] || [ -f "$dir/Dockerfile" ] || [ -f "$dir/docker-compose.yml" ] || \
  [ -f "$dir/docker-compose.yaml" ]
}

find_projects_recursive() {
  local dir="$1" depth="$2"
  [[ $depth -gt $MAX_DEPTH ]] && return
  for sub in "$dir"/*/; do
    [[ ! -d "$sub" ]] && continue
    local name=$(basename "$sub")
    [[ "$name" == .* || "$name" == "node_modules" || "$name" == "vendor" || \
       "$name" == "venv" || "$name" == ".venv" || "$name" == "__pycache__" || \
       "$name" == "dist" || "$name" == "build" || "$name" == ".next" || \
       "$name" == "target" ]] && continue
    if is_project "$sub"; then
      echo "$sub"
    else
      find_projects_recursive "$sub" $((depth + 1))
    fi
  done 2>/dev/null
}

get_tags() {
  local dir="$1" tags=""
  [ -d "$dir/.git" ] && tags="${tags}git,"
  [ -f "$dir/package.json" ] && tags="${tags}node,"
  { [ -f "$dir/pyproject.toml" ] || [ -f "$dir/setup.py" ] || [ -f "$dir/requirements.txt" ]; } && tags="${tags}py,"
  [ -f "$dir/Cargo.toml" ] && tags="${tags}rust,"
  [ -f "$dir/go.mod" ] && tags="${tags}go,"
  [ -f "$dir/CLAUDE.md" ] && tags="${tags}claude,"
  { [ -f "$dir/Dockerfile" ] || [ -f "$dir/docker-compose.yml" ] || [ -f "$dir/docker-compose.yaml" ]; } && tags="${tags}docker,"
  echo "${tags%,}"
}

get_relative_path() {
  local rel="${1#$SCAN_ROOT/}"
  echo "${rel%/}"
}

get_git_branch() {
  git -C "$1" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "-"
}

get_last_commit() {
  git -C "$1" log -1 --format="%ar|%s" 2>/dev/null || echo "-|-"
}

get_dirty_status() {
  local dir="$1"
  git -C "$dir" rev-parse --git-dir &>/dev/null || return
  local staged=$(git -C "$dir" diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
  local unstaged=$(git -C "$dir" diff --numstat 2>/dev/null | wc -l | tr -d ' ')
  local untracked=$(git -C "$dir" ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
  local parts=""
  [[ "$staged" -gt 0 ]] && parts="${parts}+${staged} "
  [[ "$unstaged" -gt 0 ]] && parts="${parts}~${unstaged} "
  [[ "$untracked" -gt 0 ]] && parts="${parts}?${untracked} "
  echo "${parts% }"
}

time_ago_epoch_ms() {
  local ms="$1"
  [[ "$ms" == "0" || -z "$ms" ]] && echo "never" && return
  local now_ms=$(($(date +%s) * 1000))
  local diff_s=$(( (now_ms - ms) / 1000 ))
  if (( diff_s < 60 )); then echo "just now"
  elif (( diff_s < 3600 )); then echo "$((diff_s/60))m ago"
  elif (( diff_s < 86400 )); then echo "$((diff_s/3600))h ago"
  elif (( diff_s < 604800 )); then echo "$((diff_s/86400))d ago"
  elif (( diff_s < 2592000 )); then echo "$((diff_s/604800))w ago"
  else echo "$((diff_s/2592000))mo ago"
  fi
}

launch_folders() {
  local count=0
  for dir in "$@"; do
    local name=$(get_relative_path "$dir")
    osascript -e "
      tell application \"Terminal\"
        activate
        do script \"cd '$dir' && claude --dangerously-skip-permissions\"
      end tell
    "
    echo "  ✓ $name"
    ((count++))
    sleep 0.3
  done
  echo ""
  echo "Done! $count terminals launched."
}

# ─── BUILD PROJECT LIST FROM HISTORY ──────────────────────────────────

build_from_history() {
  python3 -c "
import json, os, sys
from collections import defaultdict

scan_root = '$SCAN_ROOT'
projects = defaultdict(lambda: {'sessions': set(), 'msgs': 0, 'last': 0})

with open(os.path.expanduser('$CLAUDE_HISTORY')) as f:
    for line in f:
        try:
            d = json.loads(line)
            p = d.get('project', '')
            ts = d.get('timestamp', 0)
            sid = d.get('sessionId', '')
            # Only include projects under SCAN_ROOT, exclude SCAN_ROOT itself
            if p and p.startswith(scan_root + '/') and p != scan_root:
                projects[p]['sessions'].add(sid)
                projects[p]['msgs'] += 1
                projects[p]['last'] = max(projects[p]['last'], ts)
        except:
            pass

# Output: path|sessions|msgs|last_timestamp_ms
# Only include dirs that still exist
for p, info in sorted(projects.items(), key=lambda x: -x[1]['last']):
    if os.path.isdir(p):
        print(f\"{p}|{len(info['sessions'])}|{info['msgs']}|{info['last']}\")
" 2>/dev/null
}

# ─── BUILD PROJECT LIST FROM FILESYSTEM ───────────────────────────────

build_from_scan() {
  find_projects_recursive "$SCAN_ROOT" 1
}

# ─── DIRECT LAUNCH MODES ─────────────────────────────────────────────

if [[ "$MODE" == "all" ]]; then
  found=()
  while IFS= read -r line; do found+=("$line"); done < <(build_from_history | cut -d'|' -f1)
  if [[ ${#found[@]} -eq 0 ]]; then
    while IFS= read -r line; do found+=("$line"); done < <(build_from_scan)
  fi
  echo "Launching ${#found[@]} projects..."
  launch_folders "${found[@]}"
  exit 0
fi

if [[ $# -gt 0 ]]; then
  folders=()
  for name in "$@"; do
    dir="$SCAN_ROOT/$name"
    [[ -d "$dir" ]] && folders+=("$dir") || echo "⚠ Skipping '$name' — not found"
  done
  launch_folders "${folders[@]}"
  exit 0
fi

# ─── GATHER PROJECT DATA ─────────────────────────────────────────────

clear
history_lines=()
scan_lines=()
if [[ "$MODE" == "history" ]]; then
  printf "\033[1m  Reading Claude history...\033[0m\n"
  while IFS= read -r line; do history_lines+=("$line"); done < <(build_from_history)
else
  printf "\033[1m  Scanning filesystem (depth: %d)...\033[0m\n" "$MAX_DEPTH"
  while IFS= read -r line; do scan_lines+=("$line"); done < <(build_from_scan)
fi

projects=()
project_display=()
project_tags=()
project_branches=()
project_commit_age=()
project_commit_msg=()
project_dirty=()
project_claude_ago=()
project_claude_sessions=()
project_claude_msgs=()

idx=0

if [[ "$MODE" == "history" ]]; then
  for entry in "${history_lines[@]}"; do
    [[ -z "$entry" ]] && continue
    IFS='|' read -r dir sessions msgs last_ts <<< "$entry"

    projects+=("$dir")
    project_display+=("$(get_relative_path "$dir")")
    project_tags+=("$(get_tags "$dir")")
    project_branches+=("$(get_git_branch "$dir")")

    commit_info=$(get_last_commit "$dir")
    project_commit_age+=("${commit_info%%|*}")
    cmsg="${commit_info#*|}"
    [[ ${#cmsg} -gt 30 ]] && cmsg="${cmsg:0:27}..."
    project_commit_msg+=("$cmsg")

    project_dirty+=("$(get_dirty_status "$dir")")
    project_claude_ago+=("$(time_ago_epoch_ms "$last_ts")")
    project_claude_sessions+=("$sessions")
    project_claude_msgs+=("$msgs")

    ((idx++))
    printf "\r\033[K\033[2m  Loading %d projects...\033[0m" "$idx"
  done
else
  for dir in "${scan_lines[@]}"; do
    [[ -z "$dir" ]] && continue

    projects+=("$dir")
    project_display+=("$(get_relative_path "$dir")")
    project_tags+=("$(get_tags "$dir")")
    project_branches+=("$(get_git_branch "$dir")")

    commit_info=$(get_last_commit "$dir")
    project_commit_age+=("${commit_info%%|*}")
    cmsg="${commit_info#*|}"
    [[ ${#cmsg} -gt 30 ]] && cmsg="${cmsg:0:27}..."
    project_commit_msg+=("$cmsg")

    project_dirty+=("$(get_dirty_status "$dir")")
    project_claude_ago+=("-")
    project_claude_sessions+=("-")
    project_claude_msgs+=("-")

    ((idx++))
    printf "\r\033[K\033[2m  Scanned %d projects...\033[0m" "$idx"
  done
fi

total=${#projects[@]}
if [[ $total -eq 0 ]]; then
  echo ""
  echo "No projects found."
  exit 1
fi

# ─── INTERACTIVE PICKER ──────────────────────────────────────────────

selected=()
for ((i=0; i<total; i++)); do selected+=(0); done
cursor=0

sort_mode=0
if [[ "$MODE" == "history" ]]; then
  sort_label="recent (claude)"
else
  sort_label="name"
fi

sort_indices=()
for ((i=0; i<total; i++)); do sort_indices+=($i); done

term_lines=$(tput lines)
term_cols=$(tput cols)
visible=$((term_lines - 8))
[[ $visible -lt 5 ]] && visible=5
scroll_offset=0

tput civis
trap 'tput cnorm; stty sane' EXIT

C_RESET="\033[0m"; C_BOLD="\033[1m"; C_DIM="\033[2m"; C_REV="\033[7m"
C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_CYAN="\033[36m"; C_MAGENTA="\033[35m"

draw() {
  tput cup 0 0

  local sel_count=0
  for s in "${selected[@]}"; do ((sel_count+=s)); done

  local source_label="history"
  [[ "$MODE" == "scan" ]] && source_label="filesystem"

  printf "${C_BOLD}  Claude Code Launcher — %d/%d selected   ${C_DIM}sort: %s │ source: %s${C_RESET}\033[K\n" \
    "$sel_count" "$total" "$sort_label" "$source_label"
  printf "  ${C_DIM}↑↓ navigate │ space toggle │ a all │ n none │ s sort │ enter launch │ q quit${C_RESET}\033[K\n"

  if [[ "$MODE" == "history" ]]; then
    printf "  ${C_DIM}   %-33s %-8s %-11s %-25s %-9s %-9s %4s %5s %s${C_RESET}\033[K\n" \
      "PROJECT" "BRANCH" "COMMIT" "MESSAGE" "DIRTY" "LAST USE" "SESS" "MSGS" "STACK"
  else
    printf "  ${C_DIM}   %-33s %-8s %-11s %-25s %-9s %s${C_RESET}\033[K\n" \
      "PROJECT" "BRANCH" "COMMIT" "MESSAGE" "DIRTY" "STACK"
  fi

  if ((cursor < scroll_offset)); then scroll_offset=$cursor
  elif ((cursor >= scroll_offset + visible)); then scroll_offset=$((cursor - visible + 1)); fi

  local end=$((scroll_offset + visible))
  [[ $end -gt $total ]] && end=$total

  if ((scroll_offset > 0)); then
    printf "  ${C_DIM}    ↑ %d more${C_RESET}\033[K\n" "$scroll_offset"
  else
    printf "\033[K\n"
  fi

  for ((row=scroll_offset; row<end; row++)); do
    local i=${sort_indices[$row]}
    local display="${project_display[$i]}"
    local branch="${project_branches[$i]}"
    local cage="${project_commit_age[$i]}"
    local cmsg="${project_commit_msg[$i]}"
    local dirty="${project_dirty[$i]}"
    local clago="${project_claude_ago[$i]}"
    local clsess="${project_claude_sessions[$i]}"
    local clmsgs="${project_claude_msgs[$i]}"
    local tags="${project_tags[$i]}"
    local check=" "
    [[ ${selected[$i]} -eq 1 ]] && check="✓"

    [[ ${#display} -gt 31 ]] && display="${display:0:28}..."
    [[ ${#branch} -gt 8 ]] && branch="${branch:0:7}…"

    local dirty_col=""
    if [[ -n "$dirty" ]]; then dirty_col="${C_YELLOW}${dirty}${C_RESET}"
    else dirty_col="${C_GREEN}clean${C_RESET}"; fi

    local claude_col=""
    if [[ "$clago" == "never" || "$clago" == "-" ]]; then claude_col="${C_DIM}${clago}${C_RESET}"
    elif [[ "$clago" == *"m ago"* || "$clago" == *"h ago"* || "$clago" == "just now" ]]; then claude_col="${C_CYAN}${clago}${C_RESET}"
    elif [[ "$clago" == *"d ago"* ]]; then claude_col="${C_GREEN}${clago}${C_RESET}"
    else claude_col="${C_DIM}${clago}${C_RESET}"; fi

    # Row highlight
    if [[ $row -eq $cursor ]]; then
      if [[ ${selected[$i]} -eq 1 ]]; then
        printf "  ${C_REV}${C_GREEN} [%s]${C_RESET}${C_REV} %-31s ${C_RESET}" "$check" "$display"
      else
        printf "  ${C_REV} [%s] %-31s ${C_RESET}" "$check" "$display"
      fi
    else
      if [[ ${selected[$i]} -eq 1 ]]; then
        printf "  ${C_GREEN} [%s] %-31s${C_RESET}" "$check" "$display"
      else
        printf "   [%s] %-31s" "$check" "$display"
      fi
    fi

    printf " ${C_MAGENTA}%-8s${C_RESET}" "$branch"
    printf " ${C_DIM}%-11s${C_RESET}" "$cage"
    printf " %-25s" "$cmsg"
    printf " %-11b" "$dirty_col"

    if [[ "$MODE" == "history" ]]; then
      printf " %-11b" "$claude_col"
      printf " ${C_DIM}%4s${C_RESET}" "$clsess"
      printf " ${C_DIM}%5s${C_RESET}" "$clmsgs"
    fi

    printf " ${C_DIM}%s${C_RESET}" "$tags"
    printf "\033[K\n"
  done

  local remaining=$((total - end))
  if ((remaining > 0)); then
    printf "  ${C_DIM}    ↓ %d more${C_RESET}\033[K\n" "$remaining"
  else
    printf "\033[K\n"
  fi

  for ((cl=0; cl<3; cl++)); do printf "\033[K\n"; done
}

clear
draw

while true; do
  IFS= read -rsn1 key

  case "$key" in
    $'\x1b')
      read -rsn2 -t 0.1 seq
      case "$seq" in
        '[A') ((cursor > 0)) && ((cursor--)) ;;
        '[B') ((cursor < total-1)) && ((cursor++)) ;;
        '[5') read -rsn1 -t 0.1; ((cursor -= visible)); ((cursor < 0)) && cursor=0 ;;
        '[6') read -rsn1 -t 0.1; ((cursor += visible)); ((cursor >= total)) && cursor=$((total-1)) ;;
      esac
      ;;
    ' ')
      local_i=${sort_indices[$cursor]}
      selected[$local_i]=$(( 1 - ${selected[$local_i]} ))
      ((cursor < total-1)) && ((cursor++))
      ;;
    'a'|'A')
      for ((i=0; i<total; i++)); do selected[$i]=1; done
      ;;
    'n'|'N')
      for ((i=0; i<total; i++)); do selected[$i]=0; done
      ;;
    's'|'S')
      if [[ "$MODE" == "history" ]]; then
        sort_mode=$(( (sort_mode + 1) % 4 ))
        case $sort_mode in
          0) # Default: by recent claude usage (already sorted from history)
            sort_label="recent (claude)"
            sort_indices=()
            for ((i=0; i<total; i++)); do sort_indices+=($i); done
            ;;
          1) # By name
            sort_label="name"
            declare -a name_pairs=()
            for ((i=0; i<total; i++)); do
              name_pairs+=("${project_display[$i]}|$i")
            done
            sorted=$(printf '%s\n' "${name_pairs[@]}" | sort -t'|' -k1 -f)
            sort_indices=()
            while IFS= read -r line; do sort_indices+=("${line##*|}"); done <<< "$sorted"
            unset name_pairs
            ;;
          2) # By last commit
            sort_label="last commit"
            declare -a epoch_pairs=()
            for ((i=0; i<total; i++)); do
              ep=$(git -C "${projects[$i]}" log -1 --format="%ct" 2>/dev/null || echo "0")
              epoch_pairs+=("$ep:$i")
            done
            sorted=$(printf '%s\n' "${epoch_pairs[@]}" | sort -t: -k1 -nr)
            sort_indices=()
            while IFS= read -r line; do sort_indices+=("${line#*:}"); done <<< "$sorted"
            unset epoch_pairs
            ;;
          3) # By most sessions
            sort_label="most sessions"
            declare -a sess_pairs=()
            for ((i=0; i<total; i++)); do
              sess_pairs+=("${project_claude_sessions[$i]}:$i")
            done
            sorted=$(printf '%s\n' "${sess_pairs[@]}" | sort -t: -k1 -nr)
            sort_indices=()
            while IFS= read -r line; do sort_indices+=("${line#*:}"); done <<< "$sorted"
            unset sess_pairs
            ;;
        esac
      else
        sort_mode=$(( (sort_mode + 1) % 2 ))
        case $sort_mode in
          0) sort_label="name"; sort_indices=(); for ((i=0; i<total; i++)); do sort_indices+=($i); done ;;
          1)
            sort_label="last commit"
            declare -a epoch_pairs=()
            for ((i=0; i<total; i++)); do
              ep=$(git -C "${projects[$i]}" log -1 --format="%ct" 2>/dev/null || echo "0")
              epoch_pairs+=("$ep:$i")
            done
            sorted=$(printf '%s\n' "${epoch_pairs[@]}" | sort -t: -k1 -nr)
            sort_indices=()
            while IFS= read -r line; do sort_indices+=("${line#*:}"); done <<< "$sorted"
            unset epoch_pairs
            ;;
        esac
      fi
      cursor=0; scroll_offset=0
      ;;
    ''|$'\n')
      break
      ;;
    'q'|'Q')
      tput cnorm; clear
      echo "Cancelled."
      exit 0
      ;;
  esac

  draw
done

tput cnorm; clear

chosen=()
for ((i=0; i<total; i++)); do
  [[ ${selected[$i]} -eq 1 ]] && chosen+=("${projects[$i]}")
done

if [[ ${#chosen[@]} -eq 0 ]]; then
  echo "No projects selected."
  exit 0
fi

echo "Launching ${#chosen[@]} projects..."
echo ""
launch_folders "${chosen[@]}"
