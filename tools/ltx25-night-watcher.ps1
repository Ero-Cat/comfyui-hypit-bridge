# ltx25-night-watcher.ps1 - WMI-detached overnight finisher for the uncensored DiT (2026-10-01).
# The tail (~1GB) is hostage to cross-border peak-hour congestion; this watcher relays aria2
# sessions until the exact byte count lands, then writes the .ok marker the ps1 downloader uses.
$exe = 'C:\Users\deploy\aria2\aria2-1.37.0-win-64bit-build1\aria2c.exe'
$dir = 'G:/AI/ComfyUI/models/diffusion_models'
$name = 'ltx25_uncensored_v1.1-fp8_scaled.safetensors'
$target = 21473651432
$log = 'C:\Users\deploy\aria2-dit.log'
function W([string]$m) { Add-Content -Path 'C:\Users\deploy\ltx25-watcher.log' -Value ("{0} {1}" -f (Get-Date -Format 'MM-dd HH:mm:ss'), $m) }
W 'watcher started'
for ($i = 1; $i -le 240; $i++) {
  $f = Get-Item (Join-Path $dir $name) -ErrorAction SilentlyContinue
  $ctrl = Test-Path (Join-Path $dir ($name + '.aria2'))
  if ($f -and -not $ctrl -and $f.Length -eq $target) {
    Set-Content -Path ((Join-Path $dir $name) + '.ok') -Value $target
    W 'WATCHER-DONE file complete'
    exit 0
  }
  if (@(Get-Process aria2c -ErrorAction SilentlyContinue).Count -eq 0) {
    W ("relay attempt " + $i + " (file at " + $(if ($f) { $f.Length } else { 0 }) + "B)")
    & $exe '-x16', '-s32', '-k8M', '-c', '--file-allocation=none',
      '--auto-save-interval=10', '--auto-file-renaming=false', '--allow-overwrite=true',
      '--lowest-speed-limit=20K', '--max-tries=0', '--retry-wait=5',
      '--timeout=60', '--connect-timeout=20', '--summary-interval=60',
      '-d', $dir, '-o', $name,
      'https://hf-mirror.com/ChrisColeTech/LTX-2.5-uncensored-v1.1-FP8/resolve/main/split/diffusion_models/ltx25_uncensored_v1.1-fp8_scaled.safetensors' *>> $log
    W ("aria2 exited " + $LASTEXITCODE)
    Start-Sleep 120
  } else {
    Start-Sleep 60
  }
}
W 'WATCHER-GAVE-UP (240 rounds)'
exit 1
