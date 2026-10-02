# aria2-ltx25-official.ps1 - official LTX-2.5 distilled int8 from the ModelScope China CDN.
# 2026-10-01 evening: cross-border (HF/GitHub) collapsed into ~50KB/s peak-hour congestion while
# ModelScope served 2.7MB/s single-stream; the Lightricks/LTX-2.5 mirror there is ungated, which
# also removes the HF-token blocker for the official lane.
$exe = 'C:\Users\deploy\aria2\aria2-1.37.0-win-64bit-build1\aria2c.exe'
$dir = 'G:/AI/ComfyUI/models/diffusion_models'
$name = 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors'
$opts = @(
  '-x16', '-s32', '-k8M', '-c', '--file-allocation=none',
  '--auto-save-interval=10', '--auto-file-renaming=false', '--allow-overwrite=true',
  '--lowest-speed-limit=20K', '--max-tries=0', '--retry-wait=5',
  '--timeout=60', '--connect-timeout=20', '--summary-interval=30',
  '-d', $dir, '-o', $name,
  'https://modelscope.cn/models/Lightricks/LTX-2.5/resolve/master/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors'
)
for ($attempt = 1; $attempt -le 10; $attempt++) {
  Write-Output ("=== official attempt " + $attempt + " " + (Get-Date -Format HH:mm:ss) + " ===")
  & $exe @opts *>> 'C:\Users\deploy\aria2-official.log'
  if ($LASTEXITCODE -eq 0) { Write-Output 'OFFICIAL-DONE'; exit 0 }
  Write-Output ("attempt " + $attempt + " exit " + $LASTEXITCODE + " - cooldown 120s")
  Start-Sleep 120
}
Write-Output 'OFFICIAL-GAVE-UP'
exit 1
