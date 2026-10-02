# download-ltx25.ps1 — LTX-2.5 uncensored split pack 分段并行下载器（2026-10-01）
# 路由: hf-mirror.com -> huggingface.co -> us.aws.cdn.hf.co（5090 机器实测单流 ~1.2MB/s，10 路并行）
# 机制: 按 parts 数切 range 并行 curl；断点以 .cNN 续段文件实现（curl -C - 与 -r 禁同用，见 PATCHES.md）
#       逐段校验大小 -> .NET FileStream 顺序拼接 -> 总长校验 -> 写 .ok 标记并清理分段
# 幂等: 带 .ok 且总长正确的文件自动跳过；重复运行安全。
# 运行: powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\deploy\download-ltx25.ps1
# 日志: C:\Users\deploy\ltx25-download.log

$ErrorActionPreference = 'Continue'
$log = 'C:/Users/deploy/ltx25-download.log'
function L([string]$m) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) }

$repo = 'ChrisColeTech/LTX-2.5-uncensored-v1.1-FP8'
$jobs = @(
  @{ path='split/vae/ltx25_uncensored_audio_vae.safetensors';   dst='G:/AI/ComfyUI/models/vae/ltx25_uncensored_audio_vae.safetensors';   size=364866540L;   parts=1 }
  @{ path='split/vae/ltx25_uncensored_video_vae.safetensors';   dst='G:/AI/ComfyUI/models/vae/ltx25_uncensored_video_vae.safetensors';   size=1472223346L;  parts=3 }
  @{ path='split/latent_upscale_models/ltx-2.5-latent-temporal-upscaler-x2-bf16-1.0.safetensors'; dst='G:/AI/ComfyUI/models/latent_upscale_models/ltx-2.5-latent-temporal-upscaler-x2-bf16-1.0.safetensors'; size=261944000L; parts=1 }
  @{ path='split/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors'; dst='G:/AI/ComfyUI/models/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors'; size=995778752L; parts=3 }
  @{ path='split/text_encoders/gemma4_12b_ltx25_uncensored-int8.safetensors'; dst='G:/AI/ComfyUI/models/text_encoders/gemma4_12b_ltx25_uncensored-int8.safetensors'; size=13157517698L; parts=6 }
  @{ path='split/diffusion_models/ltx25_uncensored_v1.1-fp8_scaled.safetensors'; dst='G:/AI/ComfyUI/models/diffusion_models/ltx25_uncensored_v1.1-fp8_scaled.safetensors'; size=21473651432L; parts=10 }
)

function SegTotal([string]$pfx) {
  $t = [int64]0
  if (Test-Path -LiteralPath $pfx) { $t += (Get-Item -LiteralPath $pfx).Length }
  for ($k = 1; $k -le 99; $k++) {
    $c = ('{0}.c{1:d2}' -f $pfx, $k)
    if (Test-Path -LiteralPath $c) { $t += (Get-Item -LiteralPath $c).Length } else { break }
  }
  return $t
}
function SegList([string]$pfx) {
  $r = @()
  if (Test-Path -LiteralPath $pfx) { $r += $pfx }
  for ($k = 1; $k -le 99; $k++) {
    $c = ('{0}.c{1:d2}' -f $pfx, $k)
    if (Test-Path -LiteralPath $c) { $r += $c } else { break }
  }
  return $r
}

foreach ($j in $jobs) {
  $url = ('https://hf-mirror.com/{0}/resolve/main/{1}' -f $repo, $j.path)
  $dst = $j.dst; $size = [int64]$j.size; $n = [int]$j.parts
  if ((Test-Path -LiteralPath ($dst + '.ok')) -and (Test-Path -LiteralPath $dst) -and ((Get-Item -LiteralPath $dst).Length -eq $size)) { L ("SKIP " + $dst); continue }
  $dir = Split-Path $dst -Parent
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  L ("START " + $dst + " size=" + $size + " parts=" + $n)
  $chunk = [int64][math]::Floor($size / $n)
  $plist = @()
  for ($i = 0; $i -lt $n; $i++) {
    $s = [int64]($i * $chunk)
    if ($i -eq ($n - 1)) { $e = [int64]($size - 1) } else { $e = [int64](($i + 1) * $chunk - 1) }
    $plist += @{ s = $s; e = $e; exp = [int64]($e - $s + 1); pfx = ('{0}.ltxpart{1:d2}' -f $dst, $i) }
  }
  for ($round = 1; $round -le 12; $round++) {
    $todo = @()
    foreach ($p in $plist) {
      $have = SegTotal $p.pfx
      if ($have -gt $p.exp) {
        L ("OVERSIZE reset " + $p.pfx + " have=" + $have + " exp=" + $p.exp)
        Get-ChildItem -Path ($p.pfx + '*') -File | Remove-Item -Force
        $have = [int64]0
      }
      if ($have -lt $p.exp) { $todo += @{ p = $p; from = [int64]($p.s + $have) } }
    }
    if ($todo.Count -eq 0) { break }
    L ("round " + $round + ": " + $todo.Count + " segment(s) to fetch")
    $rj = @()
    foreach ($t in $todo) {
      $pfx = $t.p.pfx
      $from = [int64]$t.from; $to = [int64]$t.p.e
      if ($from -gt $to) { continue }
      $segs = @(SegList $pfx)
      if ($segs.Count -eq 0) { $out = $pfx } else { $out = ('{0}.c{1:d2}' -f $pfx, $segs.Count) }
      L ("  fetch " + $out + " range " + $from + "-" + $to + " (" + ($to - $from + 1) + "B)")
      $rj += Start-Job -ScriptBlock {
        param($u, $a, $b, $o)
        # --speed-limit/--speed-time: a CDN-throttled connection (below 50KB/s for 90s) aborts and
        # lets the retry/round logic re-open fresh ones (2026-10-01 stall incident: hung transfers
        # without this flag blocked a whole file's round loop indefinitely).
        & curl.exe -sS -L --fail --retry 5 --retry-delay 3 --connect-timeout 30 `
          --speed-limit 51200 --speed-time 90 -r ('{0}-{1}' -f $a, $b) -o $o $u
        if ($LASTEXITCODE -ne 0) { Write-Output ("curl exit " + $LASTEXITCODE + " on " + $o) }
      } -ArgumentList $url, $from, $to, $out
    }
    if ($rj.Count -gt 0) {
      Wait-Job -Job $rj | Out-Null
      foreach ($jb in $rj) { $ro = Receive-Job $jb; if ($ro) { L ("  " + ($ro -join ' ; ')) } }
      Remove-Job $rj -Force
    }
  }
  $ok = $true
  foreach ($p in $plist) {
    $tot = SegTotal $p.pfx
    if ($tot -ne $p.exp) { $ok = $false; L ("INCOMPLETE " + $p.pfx + " total=" + $tot + " exp=" + $p.exp) }
  }
  if (-not $ok) { L ("GIVEUP " + $dst + " (parts kept for resume)"); continue }
  L ("assemble " + $dst)
  $fs = [System.IO.File]::Create($dst)
  try {
    foreach ($p in $plist) {
      foreach ($seg in (SegList $p.pfx)) {
        $in = [System.IO.File]::OpenRead($seg)
        try { [void]$in.CopyTo($fs) } finally { $in.Close() }
      }
    }
  } finally { $fs.Close() }
  $final = (Get-Item -LiteralPath $dst).Length
  if ($final -eq $size) {
    Set-Content -Path ($dst + '.ok') -Value $size
    foreach ($p in $plist) { Get-ChildItem -Path ($p.pfx + '*') -File | Remove-Item -Force }
    L ("DONE " + $dst + " " + $final)
  } else {
    L ("ASSEMBLE-MISMATCH " + $dst + " got=" + $final + " exp=" + $size + " (dst deleted)")
    Remove-Item -LiteralPath $dst -Force
  }
}
L 'ALL-JOBS-PROCESSED'
