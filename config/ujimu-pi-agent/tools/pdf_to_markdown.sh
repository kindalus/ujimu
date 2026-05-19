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
- Write the complete Markdown conversion directly to ${target_rel}.
- Do not return the converted document on stdout; stdout may be truncated for long PDFs.
- Process the complete PDF from first page to last page; do not stop at a cover page or table of contents.
- Preserve the original language and wording as faithfully as possible.
- Do not summarize, omit, modernize, translate, or invent content.
- Preserve headings, articles, lists, tables, references, and visible structure where possible.
- Do not wrap the file content in a Markdown code fence."

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

set +e
timeout 600s gemini -y -p "$prompt" > /dev/null 2>"$stderr_tmp"
gemini_status=$?
set -e

if [ "$gemini_status" -ne 0 ]; then
  stderr_text="$(cat "$stderr_tmp" 2>/dev/null || true)"
  if printf '%s' "$stderr_text" | grep -Eiq 'auth|unauthori[sz]ed|credential|api[ _-]?key|permission|login'; then
    fail "GEMINI_CLI_AUTH_FAILED" "Gemini CLI authentication or configuration failed."
  fi
  fail "GEMINI_CONVERSION_FAILED" "Gemini CLI failed with exit code ${gemini_status}."
fi

if [ ! -f "$target_real" ]; then
  fail "GEMINI_CONVERSION_FAILED" "Gemini did not create the expected Markdown file."
fi

case "$(realpath "$target_real" 2>/dev/null)" in
  "$raw_real"/*) ;;
  *) fail "GEMINI_CONVERSION_FAILED" "Gemini wrote the Markdown target outside raw/." ;;
esac

nonwhite_count="$(tr -d '[:space:]' < "$target_real" | wc -c | tr -d ' ')"
if [ "${nonwhite_count:-0}" -lt 20 ]; then
  fail "GEMINI_CONVERSION_FAILED" "Gemini output file is too small to be a safe Markdown conversion."
fi

bytes="$(wc -c < "$target_real" | tr -d ' ')"
chmod 600 "$target_real" 2>/dev/null || true
node -e 'console.log(JSON.stringify({ status: "converted", markdownPath: process.argv[1], bytes: Number(process.argv[2]) }))' "$target_rel" "$bytes"
