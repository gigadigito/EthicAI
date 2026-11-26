#!/usr/bin/env bash
set -euo pipefail
ROOT="${CANDLE_BATTLE_PUBLICATIONS_ROOT:-/home/admin/stacks/binance-square/candle-battle-publications}"
CAPTURE_ROOT="${BROWSERLESS_CAPTURE_ROOT:-/tmp/arena-pressure-phase2/out}"
TOOLS="${CANDLE_BATTLE_TOOLS_ROOT:-/home/admin/stacks/binance-square/candle-battle-tools}"
mode="${1:-}"
emit(){ printf '%s=%s\n' "$1" "$2"; }
[[ "$ROOT" == /home/admin/stacks/binance-square/candle-battle-publications || "$ROOT" == /home/admin/stacks/binance-square/homologation/candle-battle-publications ]] || { emit CV_STATUS unsafe_root; exit 2; }
safe_job(){ [[ "$1" =~ ^${ROOT}/candle-battle-video-v[0-9]+-[0-9]+$ ]] || { emit CV_STATUS unsafe_path; exit 2; }; [[ ! -L "$1" ]] || { emit CV_STATUS unsafe_path; exit 2; }; }
if [[ "$mode" == preflight ]]; then [[ -e "$CAPTURE_ROOT/browserless-preview.lock" ]] && { emit CV_STATUS capture_busy; exit 3; }; emit CV_STATUS available; exit 0; fi
match_id="${2:-}"; version="${3:-v1}"; [[ "$match_id" =~ ^[1-9][0-9]*$ && "$version" =~ ^v[0-9]+$ ]] || { emit CV_STATUS invalid_arguments; exit 2; }
job="$ROOT/candle-battle-video-$version-$match_id"; safe_job "$job"
if [[ "$mode" == capture ]]; then
 [[ -e "$CAPTURE_ROOT/browserless-preview.lock" ]] && { emit CV_STATUS capture_busy; exit 3; }
 mkdir -p "$job"; [[ ! -e "$job/publish-attempt.lock" ]] || { emit CV_STATUS reconciliation_required; exit 4; }
 printf 'capturing\n' > "$job/state.txt"
 set +e; output="$(node "$TOOLS/capture-full-candle-battle.mjs" --match-id "$match_id" --output "$CAPTURE_ROOT" 2>"$job/capture.log")"; code=$?; set -e
 printf '%s\n' "$output" >> "$job/capture.log"; [[ $code -eq 0 ]] || { printf 'capture_failed\n' > "$job/state.txt"; printf '%s\n' "$output"; exit "$code"; }
 source_video="$(printf '%s\n' "$output" | sed -n 's/^CV_VIDEO_PATH=//p' | tail -1)"; source_webm="$(printf '%s\n' "$output" | sed -n 's/^CV_WEBM_PATH=//p' | tail -1)"; source_report="$(printf '%s\n' "$output" | sed -n 's/^CV_REPORT_PATH=//p' | tail -1)"
 [[ "$source_video" == "$CAPTURE_ROOT"/* && -f "$source_video" && "$source_webm" == "$CAPTURE_ROOT"/* && -f "$source_webm" && "$source_report" == "$CAPTURE_ROOT"/* && -f "$source_report" ]] || { emit CV_STATUS capture_invalid; exit 5; }
 mv -- "$source_video" "$job/video.mp4"; mv -- "$source_report" "$job/report.json"; printf '%s\n' "$source_webm" > "$job/browserless-source-path.txt"
 node -e "const fs=require('fs'),p=process.argv[1],v=process.argv[2],r=JSON.parse(fs.readFileSync(p));r.videoPath=v;fs.writeFileSync(p,JSON.stringify(r,null,2)+'\\n')" "$job/report.json" "$job/video.mp4"
 printf '{"kind":"candle-battle","videoVersion":"%s","matchId":%s}\n' "$version" "$match_id" > "$job/details.json"; printf 'captured\n' > "$job/state.txt"
 emit CV_STATUS captured; emit CV_MATCH_ID "$match_id"; emit CV_JOB_DIR "$job"; emit CV_VIDEO_PATH "$job/video.mp4"; emit CV_FRAMES 3600; emit CV_PUBLISH_READY 1; exit 0
fi
if [[ "$mode" == publish ]]; then
 [[ "${4:-}" == CONFIRM_PUBLISH ]] || { emit CV_STATUS confirmation_required; exit 2; }; [[ "$(tr -d '\r\n' < "$job/state.txt")" == captured && -s "$job/video.mp4" && -s "$job/post.txt" ]] || { emit CV_STATUS not_captured; exit 5; }
 text_flag="${BINANCE_POST_VIDEO_TEXT_FLAG:-}"; [[ "$text_flag" == --text || "$text_flag" == --text-file ]] || { emit CV_STATUS publisher_contract_unverified; exit 6; }
 ( set -o noclobber; printf '%s\n' "$(date -u +%FT%TZ)" > "$job/publish-attempt.lock" ) 2>/dev/null || { emit CV_STATUS reconciliation_required; exit 4; }
 publisher=(node /home/admin/stacks/binance-square/scripts/post-video.mjs --video "$job/video.mp4")
 if [[ "$text_flag" == --text-file ]]; then publisher+=(--text-file "$job/post.txt"); else publisher+=(--text "$(<"$job/post.txt")"); fi
 printf 'publication_result_unknown\n' > "$job/state.txt"; set +e; "${publisher[@]}" > "$job/post-result.json" 2>"$job/publish.log"; code=$?; set -e
 [[ $code -eq 0 ]] || { printf 'reconciliation_required\n' > "$job/state.txt"; emit CV_STATUS reconciliation_required; exit 4; }
 post_id="$(node --input-type=module -e "import{readFileSync}from'node:fs';import{parseBinanceReceipt}from'file://${TOOLS}/publication-utils.mjs';const r=parseBinanceReceipt(JSON.parse(readFileSync(process.argv[1],'utf8')));if(r)process.stdout.write(r.postId)" "$job/post-result.json")"
 [[ "$post_id" =~ ^[0-9]+$ ]] || { printf 'reconciliation_required\n' > "$job/state.txt"; emit CV_STATUS reconciliation_required; exit 4; }
 post_url="https://www.binance.com/pt-BR/square/post/$post_id"; printf 'posted\n' > "$job/state.txt"; emit CV_STATUS posted; emit CV_MATCH_ID "$match_id"; emit CV_POST_ID "$post_id"; emit CV_POST_URL "$post_url"; exit 0
fi
if [[ "$mode" == cleanup-posted ]]; then
 apply="${4:---dry-run}"; [[ "$(tr -d '\r\n' < "$job/state.txt")" == posted && -s "$job/post-result.json" && -s "$job/publish-attempt.lock" ]] || { emit CV_STATUS cleanup_refused; exit 5; }
 [[ "$apply" == --apply || "$apply" == --dry-run ]] || { emit CV_STATUS invalid_arguments; exit 2; }
 source_webm="$(cat "$job/browserless-source-path.txt" 2>/dev/null || true)"; [[ -z "$source_webm" || "$source_webm" == "$CAPTURE_ROOT"/candle-battle-match-"$match_id"-*.webm ]] || { emit CV_STATUS cleanup_refused; exit 5; }
 if [[ "$apply" == --apply ]]; then rm -f -- "$job/video.mp4"; [[ -z "$source_webm" ]] || rm -f -- "$source_webm"; fi
 emit CV_STATUS cleanup_ready; emit CV_CLEANUP_MODE "$apply"; emit CV_VIDEO_PATH "$job/video.mp4"; exit 0
fi
emit CV_STATUS invalid_mode; exit 2
