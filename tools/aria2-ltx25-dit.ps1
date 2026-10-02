# aria2-ltx25-dit.ps1 - v5 FINAL: clean-slate single-session strategy.
# Lessons: (1) control-file autosave defaults to 60s - short-lived retry attempts never persist
# their piece map, so every attempt restarted from 0; (2) the CDN rate-limits this IP with a
# token bucket (150s burst at ~110MB/s, then a long trickle), so the winning play is one full
# uninterrupted session fired when the bucket is full. This script deletes the poisoned file,
# then tries up to 10 full sessions with 5-minute cooldowns between them, autosaving every 10s.
$exe = 'C:\Users\deploy\aria2\aria2-1.37.0-win-64bit-build1\aria2c.exe'
$dir = 'G:/AI/ComfyUI/models/diffusion_models'
$name = 'ltx25_uncensored_v1.1-fp8_scaled.safetensors'
Remove-Item (Join-Path $dir $name) -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dir ($name + '.aria2')) -Force -ErrorAction SilentlyContinue
$opts = @(
  '-x16', '-s32', '-k8M', '-c', '--file-allocation=none',
  '--auto-save-interval=10', '--auto-file-renaming=false', '--allow-overwrite=true',
  '--lowest-speed-limit=20K', '--max-tries=0', '--retry-wait=5',
  '--timeout=60', '--connect-timeout=20', '--summary-interval=30',
  '-d', $dir, '-o', $name,
  'https://hf-mirror.com/ChrisColeTech/LTX-2.5-uncensored-v1.1-FP8/resolve/main/split/diffusion_models/ltx25_uncensored_v1.1-fp8_scaled.safetensors'
)
for ($attempt = 1; $attempt -le 10; $attempt++) {
  Write-Output ("=== full-session attempt " + $attempt + " " + (Get-Date -Format HH:mm:ss) + " ===")
  & $exe @opts *>> 'C:\Users\deploy\aria2-dit.log'
  if ($LASTEXITCODE -eq 0) { Write-Output 'ARIA2-DONE'; exit 0 }
  Write-Output ("attempt " + $attempt + " exit " + $LASTEXITCODE + " - cooldown 300s for the rate-limit bucket")
  Start-Sleep 300
}
Write-Output 'ARIA2-GAVE-UP'
exit 1
