# Smoke test for comments API (PowerShell)
# Usage: Open PowerShell in repo root and run: .\tests\smoke-comments.ps1

$base = 'http://localhost:3000'
Write-Host "Checking server at $base..."
try {
  $courses = Invoke-RestMethod -Uri "$base/api/courses" -Method Get -ErrorAction Stop
  Write-Host "OK: /api/courses reachable. Found courses:" $courses.courses.Count
} catch {
  Write-Host "ERROR: Server not reachable or /api/courses failed. Start the server (node server.js) and try again." -ForegroundColor Red
  exit 1
}

# 1) Create parent comment
$parentBody = @{ text = ("Smoke parent " + (Get-Random)) } | ConvertTo-Json
Write-Host "Posting parent comment..."
try {
  $parent = Invoke-RestMethod -Uri "$base/api/courses/test_course/lessons/test_l1/comments" -Method Post -Body $parentBody -ContentType 'application/json' -ErrorAction Stop
  Write-Host "PARENT RESPONSE:`n" ($parent | ConvertTo-Json -Depth 5)
} catch {
  Write-Host "Parent POST failed: $_" -ForegroundColor Red
  exit 1
}

# 2) Post reply to parent
Write-Host "Posting reply to parent id=$($parent.id)..."
$replyBody = @{ text = 'Reply to parent (smoke)'; parentId = $parent.id } | ConvertTo-Json
try {
  $reply = Invoke-RestMethod -Uri "$base/api/courses/test_course/lessons/test_l1/comments" -Method Post -Body $replyBody -ContentType 'application/json' -ErrorAction Stop
  Write-Host "REPLY RESPONSE:`n" ($reply | ConvertTo-Json -Depth 5)
} catch {
  Write-Host "Reply POST failed: $_" -ForegroundColor Red
  exit 1
}

# 3) Fetch comments
Write-Host "Fetching comments before delete..."
try {
  $comments = Invoke-RestMethod -Uri "$base/api/courses/test_course/lessons/test_l1/comments" -Method Get -ErrorAction Stop
  Write-Host "COMMENTS_BEFORE_DELETE:`n" ($comments | ConvertTo-Json -Depth 10)
} catch {
  Write-Host "Comments GET failed: $_" -ForegroundColor Red
  exit 1
}

# 4) Delete parent if deletion_token present
if ($parent.deletion_token) {
  Write-Host 'Found deletion_token for parent — attempting delete using x-deletion-token header...'
  $hdrs = @{ 'x-deletion-token' = $parent.deletion_token }
  try {
    $del = Invoke-RestMethod -Uri "$base/api/courses/test_course/lessons/test_l1/comments/$($parent.id)" -Method Delete -Headers $hdrs -ErrorAction Stop
    Write-Host "DELETE RESULT:`n" ($del | ConvertTo-Json -Depth 5)
  } catch {
    Write-Host "Delete failed: $_" -ForegroundColor Yellow
  }
} else {
  Write-Host "No deletion_token returned for parent comment; cannot test anonymous delete."
}

# 5) Fetch comments again
Write-Host "Fetching comments after delete..."
try {
  $comments_after = Invoke-RestMethod -Uri "$base/api/courses/test_course/lessons/test_l1/comments" -Method Get -ErrorAction Stop
  Write-Host "COMMENTS_AFTER_DELETE:`n" ($comments_after | ConvertTo-Json -Depth 10)
} catch {
  Write-Host "Comments GET after delete failed: $_" -ForegroundColor Red
  exit 1
}

Write-Host "Smoke test finished." -ForegroundColor Green
