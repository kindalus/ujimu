#!/usr/bin/env bash
set -euo pipefail

fail() {
  local code="$1"
  local message="$2"
  echo "${code}: ${message}" >&2
  exit 1
}

if [ "$#" -ne 1 ]; then
  fail "INVALID_PDF_INPUT" "Expected exactly one relative PDF path under raw/."
fi

pdf_rel="$1"

case "$pdf_rel" in
  raw/*) ;;
  *) fail "INVALID_PDF_INPUT" "PDF path must be relative and start with raw/." ;;
esac

case "$pdf_rel" in
  /*) fail "INVALID_PDF_INPUT" "Absolute PDF paths are not allowed." ;;
esac

case "$pdf_rel" in
  */../*|../*|*/..|..) fail "INVALID_PDF_INPUT" "Path traversal is not allowed." ;;
esac

case "$pdf_rel" in
  *.[pP][dD][fF]) ;;
  *) fail "INVALID_PDF_INPUT" "Input must have a .pdf extension." ;;
esac

if [ -z "${GEMINI_API_KEY:-}" ]; then
  fail "GEMINI_API_KEY_MISSING" "GEMINI_API_KEY must be set in the environment."
fi

if ! command -v gemini >/dev/null 2>&1; then
  fail "GEMINI_CLI_UNAVAILABLE" "gemini CLI is not available on PATH."
fi

if ! command -v timeout >/dev/null 2>&1; then
  fail "TIMEOUT_COMMAND_UNAVAILABLE" "timeout command is not available on PATH."
fi

if [ ! -d raw ]; then
  fail "INVALID_PDF_INPUT" "raw/ directory does not exist in the current specialist root."
fi

raw_real="$(realpath raw 2>/dev/null)" || fail "INVALID_PDF_INPUT" "Cannot resolve raw/ directory."
source_real="$(realpath "$pdf_rel" 2>/dev/null)" || fail "INVALID_PDF_INPUT" "PDF input does not exist."

case "$source_real" in
  "$raw_real"/*) ;;
  *) fail "INVALID_PDF_INPUT" "Resolved PDF path escapes raw/." ;;
esac

if [ -L "$pdf_rel" ]; then
  fail "INVALID_PDF_INPUT" "Symlink PDF inputs are not allowed."
fi

if [ ! -f "$source_real" ]; then
  fail "INVALID_PDF_INPUT" "PDF input must be a regular file."
fi

target_rel="${pdf_rel}.md"
target_dir_rel="$(dirname "$target_rel")"
target_base="$(basename "$target_rel")"
target_dir_real="$(realpath "$target_dir_rel" 2>/dev/null)" || fail "INVALID_PDF_INPUT" "Cannot resolve target directory."
target_real="${target_dir_real}/${target_base}"

case "$target_real" in
  "$raw_real"/*) ;;
  *) fail "INVALID_PDF_INPUT" "Resolved Markdown target escapes raw/." ;;
esac

if [ -L "$target_rel" ]; then
  fail "INVALID_PDF_INPUT" "Symlink Markdown targets are not allowed."
fi

prompt="Convert @${pdf_rel} into faithful Markdown.

Input PDF: ${pdf_rel}
Final Markdown filename: ${target_rel}

Rules:
- Return only the Markdown content on stdout.
- Do not write files directly; the wrapper script will write ${target_rel}.
- Preserve the original language and wording as faithfully as possible.
- Do not summarize, omit, modernize, translate, or invent content.
- Preserve headings, articles, lists, tables, references, and visible structure where possible.
- Do not wrap the response in a Markdown code fence."

stderr_tmp="$(mktemp "${target_real}.stderr.XXXXXX")"
tmp_path=""
cleanup() {
  if [ -n "${tmp_path:-}" ] && [ -e "$tmp_path" ]; then
    rm -f "$tmp_path"
  fi
  if [ -n "${stderr_tmp:-}" ] && [ -e "$stderr_tmp" ]; then
    rm -f "$stderr_tmp"
  fi
}
trap cleanup EXIT

if command -v pdftotext >/dev/null 2>&1; then
  set +e
  pdftotext_output="$(pdftotext -layout "$pdf_rel" - 2>/dev/null)"
  pdftotext_status=$?
  set -e

  pdftotext_nonwhite_count="$(printf '%s' "$pdftotext_output" | tr -d '[:space:]' | wc -c | tr -d ' ')"
  if [ "$pdftotext_status" -eq 0 ] && [ "${pdftotext_nonwhite_count:-0}" -ge 20 ]; then
    tmp_path="$(mktemp "${target_real}.tmp.XXXXXX")"
    printf '%s\n' "$pdftotext_output" > "$tmp_path"
    bytes="$(wc -c < "$tmp_path" | tr -d ' ')"
    mv "$tmp_path" "$target_real"
    tmp_path=""

    node -e 'console.log(JSON.stringify({ status: "converted", markdownPath: process.argv[1], bytes: Number(process.argv[2]) }))' "$target_rel" "$bytes"
    exit 0
  fi
fi

set +e
gemini_output="$(timeout 600s gemini -y -p "$prompt" 2>"$stderr_tmp")"
gemini_status=$?
set -e

if [ "$gemini_status" -ne 0 ]; then
  stderr_text="$(cat "$stderr_tmp" 2>/dev/null || true)"
  if printf '%s' "$stderr_text" | grep -Eiq 'auth|unauthori[sz]ed|credential|api[ _-]?key|permission|login'; then
    fail "GEMINI_CLI_AUTH_FAILED" "Gemini CLI authentication or configuration failed."
  fi
  fail "GEMINI_CONVERSION_FAILED" "Gemini CLI failed with exit code ${gemini_status}."
fi

normalized="$(printf '%s' "$gemini_output" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const trimmed = input.trim();
  const match = trimmed.match(/^```(?:markdown)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  process.stdout.write(match ? `${match[1]}\n` : input);
});
')"

nonwhite_count="$(printf '%s' "$normalized" | tr -d '[:space:]' | wc -c | tr -d ' ')"
if [ "${nonwhite_count:-0}" -lt 20 ]; then
  fail "GEMINI_CONVERSION_FAILED" "Gemini output is too small to be a safe Markdown conversion."
fi

tmp_path="$(mktemp "${target_real}.tmp.XXXXXX")"
printf '%s' "$normalized" > "$tmp_path"
bytes="$(wc -c < "$tmp_path" | tr -d ' ')"
mv "$tmp_path" "$target_real"
tmp_path=""

node -e 'console.log(JSON.stringify({ status: "converted", markdownPath: process.argv[1], bytes: Number(process.argv[2]) }))' "$target_rel" "$bytes"
