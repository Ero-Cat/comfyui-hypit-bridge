# aria2-ltx25-official-extras.ps1 - official encoder int8 + both VAEs from ModelScope.
$exe = 'C:\Users\deploy\aria2\aria2-1.37.0-win-64bit-build1\aria2c.exe'
$items = @(
  @{ d='G:/AI/ComfyUI/models/text_encoders'; o='gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors';
     u='https://modelscope.cn/models/Lightricks/LTX-2.5/resolve/master/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors' },
  @{ d='G:/AI/ComfyUI/models/vae'; o='ltx-2.5-video-vae-bf16.safetensors';
     u='https://modelscope.cn/models/Lightricks/LTX-2.5/resolve/master/vae/ltx-2.5-video-vae-bf16.safetensors' },
  @{ d='G:/AI/ComfyUI/models/vae'; o='ltx-2.5-audio-vae-bf16.safetensors';
     u='https://modelscope.cn/models/Lightricks/LTX-2.5/resolve/master/vae/ltx-2.5-audio-vae-bf16.safetensors' }
)
foreach ($item in $items) {
  Write-Output ("=== fetching " + $item.o + " ===")
  & $exe '-x16', '-s32', '-k8M', '-c', '--file-allocation=none',
    '--auto-save-interval=10', '--auto-file-renaming=false', '--allow-overwrite=true',
    '--lowest-speed-limit=20K', '--max-tries=0', '--retry-wait=5',
    '--timeout=60', '--connect-timeout=20', '--summary-interval=30',
    '-d', $item.d, '-o', $item.o, $item.u *>> 'C:\Users\deploy\aria2-official.log'
  Write-Output ("  exit " + $LASTEXITCODE)
  if ($LASTEXITCODE -ne 0) { Write-Output 'EXTRAS-FAILED'; exit 1 }
}
Write-Output 'EXTRAS-DONE'
exit 0
