#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s: %s\n' "$1" "$2" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "PDF_OCR_DEPENDENCY_MISSING" "Required PDF processor is unavailable."
}

ensure_workspace_root() {
  [ ! -L .ujimu ] && [ ! -L .ujimu/ocr ] \
    || fail "PDF_OCR_WORKSPACE_INVALID" "OCR workspace cannot be a symlink."
  mkdir -p .ujimu/ocr
  local cwd_real ocr_real
  cwd_real=$(realpath .) || fail "PDF_OCR_WORKSPACE_INVALID" "Cannot resolve specialist root."
  ocr_real=$(realpath .ujimu/ocr) || fail "PDF_OCR_WORKSPACE_INVALID" "Cannot resolve OCR workspace."
  [ "$ocr_real" = "$cwd_real/.ujimu/ocr" ] \
    || fail "PDF_OCR_WORKSPACE_INVALID" "OCR workspace escapes the specialist root."
}

validate_source() {
  [ -n "${pdf_rel:-}" ] || fail "INVALID_PDF_INPUT" "A PDF path under raw/ is required."
  case "$pdf_rel" in
    raw/*.[pP][dD][fF]) ;;
    *) fail "INVALID_PDF_INPUT" "PDF path must be relative, under raw/, and end with .pdf." ;;
  esac
  case "$pdf_rel" in
    /*|*/../*|../*|*/..|..) fail "INVALID_PDF_INPUT" "Invalid PDF path." ;;
  esac
  [ -d raw ] || fail "INVALID_PDF_INPUT" "raw/ does not exist."
  [ ! -L "$pdf_rel" ] || fail "INVALID_PDF_INPUT" "Symlink PDF inputs are not allowed."
  [ -f "$pdf_rel" ] || fail "INVALID_PDF_INPUT" "PDF input must be a regular file."

  local raw_real source_real
  raw_real=$(realpath raw 2>/dev/null) || fail "INVALID_PDF_INPUT" "Cannot resolve raw/."
  source_real=$(realpath "$pdf_rel" 2>/dev/null) || fail "INVALID_PDF_INPUT" "Cannot resolve PDF input."
  case "$source_real" in
    "$raw_real"/*) ;;
    *) fail "INVALID_PDF_INPUT" "Resolved PDF path escapes raw/." ;;
  esac
}

prepare() {
  require_command timeout
  require_command qpdf
  require_command pdfinfo
  require_command ocrmypdf
  require_command pdftotext
  require_command sha256sum
  require_command node

  local hash workspace normalized text page_count
  hash=$(sha256sum "$pdf_rel" | awk '{print $1}')
  workspace=".ujimu/ocr/${hash}"
  normalized="${workspace}/normalized.pdf"
  text="${workspace}/document.txt"

  ensure_workspace_root
  rm -rf -- "$workspace"
  mkdir -p "$workspace"

  timeout --foreground 60 qpdf --check "$pdf_rel" >/dev/null 2>&1 \
    || fail "PDF_OCR_INVALID_PDF" "PDF structural validation failed."
  timeout --foreground 1800 ocrmypdf \
    --skip-text --rotate-pages --deskew -l por+eng --output-type pdf \
    "$pdf_rel" "$normalized" >/dev/null 2>&1 \
    || fail "PDF_OCR_PREPARATION_FAILED" "Local PDF OCR failed."
  timeout --foreground 60 qpdf --check "$normalized" >/dev/null 2>&1 \
    || fail "PDF_OCR_OUTPUT_INVALID" "Normalized PDF validation failed."

  page_count=$(timeout --foreground 60 pdfinfo "$normalized" 2>/dev/null \
    | awk -F: '/^Pages:/ { gsub(/[[:space:]]/, "", $2); print $2; exit }')
  [[ "$page_count" =~ ^[1-9][0-9]*$ ]] \
    || fail "PDF_OCR_OUTPUT_INVALID" "Normalized PDF page count is invalid."
  timeout --foreground 300 pdftotext -layout "$normalized" "$text" >/dev/null 2>&1 \
    || fail "PDF_OCR_OUTPUT_INVALID" "Normalized PDF text extraction failed."

  printf '%s\n' "$page_count" > "${workspace}/page-count"
  chmod 600 "$normalized" "$text" "${workspace}/page-count" 2>/dev/null || true
  node -e 'console.log(JSON.stringify({status:"prepared",sourceSha256:`sha256:${process.argv[1]}`,pageCount:Number(process.argv[2]),normalizedPdfPath:process.argv[3],extractedTextPath:process.argv[4]}))' \
    "$hash" "$page_count" "$normalized" "$text"
}

render_page() {
  require_command timeout
  require_command pdftoppm
  require_command pdftotext
  require_command sha256sum
  require_command node

  [[ "${page:-}" =~ ^[1-9][0-9]*$ ]] || fail "PDF_OCR_PAGE_OUT_OF_RANGE" "Page must be a positive integer."

  local hash workspace normalized page_count current prefix image text image_hash
  ensure_workspace_root
  hash=$(sha256sum "$pdf_rel" | awk '{print $1}')
  workspace=".ujimu/ocr/${hash}"
  normalized="${workspace}/normalized.pdf"
  [ -f "$normalized" ] && [ -f "${workspace}/page-count" ] \
    || fail "PDF_OCR_NOT_PREPARED" "PDF must be prepared before rendering pages."
  page_count=$(tr -d '[:space:]' < "${workspace}/page-count")
  [[ "$page_count" =~ ^[1-9][0-9]*$ ]] \
    || fail "PDF_OCR_OUTPUT_INVALID" "Prepared PDF page count is invalid."
  [ "$page" -le "$page_count" ] \
    || fail "PDF_OCR_PAGE_OUT_OF_RANGE" "Requested page is outside the PDF."

  current="${workspace}/current"
  rm -rf -- "$current"
  mkdir -p "$current"
  prefix="${current}/page"
  image="${prefix}.png"
  text="${prefix}.txt"

  timeout --foreground 300 pdftoppm -f "$page" -l "$page" -singlefile -r 300 -png \
    "$normalized" "$prefix" >/dev/null 2>&1 \
    || fail "PDF_OCR_PAGE_RENDER_FAILED" "PDF page rendering failed."
  [ -s "$image" ] || fail "PDF_OCR_PAGE_RENDER_FAILED" "PDF page image is missing."
  timeout --foreground 120 pdftotext -f "$page" -l "$page" -layout \
    "$normalized" "$text" >/dev/null 2>&1 \
    || fail "PDF_OCR_PAGE_RENDER_FAILED" "PDF page text extraction failed."
  image_hash=$(sha256sum "$image" | awk '{print $1}')
  chmod 600 "$image" "$text" 2>/dev/null || true

  node -e 'console.log(JSON.stringify({status:"rendered",page:Number(process.argv[1]),pageCount:Number(process.argv[2]),imagePath:process.argv[3],ocrTextPath:process.argv[4],imageSha256:`sha256:${process.argv[5]}`}))' \
    "$page" "$page_count" "$image" "$text" "$image_hash"
}

[ "$#" -ge 2 ] || fail "INVALID_PDF_INPUT" "Expected prepare|page and a PDF path."
action="$1"
pdf_rel="$2"
validate_source

case "$action" in
  prepare)
    [ "$#" -eq 2 ] || fail "INVALID_PDF_INPUT" "Prepare expects exactly one PDF path."
    prepare
    ;;
  page)
    [ "$#" -eq 3 ] || fail "INVALID_PDF_INPUT" "Page expects a PDF path and page number."
    page="$3"
    render_page
    ;;
  *) fail "INVALID_PDF_INPUT" "Unknown PDF OCR action." ;;
esac
