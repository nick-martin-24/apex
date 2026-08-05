#!/bin/bash
set -e

echo "=== File checksums ==="
if command -v sha256sum >/dev/null; then
  sha256sum app/dashboard/page.tsx app/dashboard/WeekTabs.tsx app/dashboard/PlanForm.tsx app/globals.css
else
  shasum -a 256 app/dashboard/page.tsx app/dashboard/WeekTabs.tsx app/dashboard/PlanForm.tsx app/globals.css
fi

echo ""
echo "=== Line counts ==="
wc -l app/dashboard/page.tsx app/dashboard/WeekTabs.tsx app/dashboard/PlanForm.tsx

echo ""
echo "=== File type / encoding ==="
file app/dashboard/page.tsx

echo ""
echo "=== Line 108-118 hex dump (region around the error) ==="
sed -n '108,118p' app/dashboard/page.tsx | cat -A | head -20

echo ""
echo "=== Byte-level check for null bytes or BOM ==="
head -c 3 app/dashboard/page.tsx | xxd
echo "(if that starts with 'ef bb bf', there's a UTF-8 BOM)"

echo ""
echo "=== Odd file: app/dashboard/.gitignore ==="
if [ -f app/dashboard/.gitignore ]; then
  echo "Contents:"
  cat app/dashboard/.gitignore
else
  echo "(not found)"
fi

echo ""
echo "=== Everything tracked under app/dashboard ==="
git ls-files app/dashboard

echo ""
echo "=== git attributes in effect for page.tsx ==="
git check-attr -a app/dashboard/page.tsx

echo ""
echo "=== Committed content vs working tree diff (should be empty) ==="
git diff HEAD -- app/dashboard/page.tsx

echo ""
echo "=== Done ==="
