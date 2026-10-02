# kill-ltx25-pids.ps1 — 按 PID 处决两个 download-ltx25 主进程 + job hosts + curl
$MainPids = @(37328, 24432)

# job hosts = Start-Job 的 "-Version 5.1 -s -NoLogo" 宿主（两个主进程的子进程）
$jobHosts = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -match '-Version 5\.1 -s -NoLogo' }
foreach ($h in $jobHosts) {
  Write-Output ("kill jobhost " + $h.ProcessId)
  Stop-Process -Id $h.ProcessId -Force -ErrorAction SilentlyContinue
}
foreach ($p in $MainPids) {
  Write-Output ("kill main " + $p)
  Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}
& taskkill.exe /IM curl.exe /F 2>$null | Out-Null
Start-Sleep 3
& taskkill.exe /IM curl.exe /F 2>$null | Out-Null
Start-Sleep 2
$left = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -match 'download-ltx25\.ps1' })
Write-Output ("main scripts left: " + $left.Count)
Write-Output ("curl left: " + @(Get-Process curl -ErrorAction SilentlyContinue).Count)
Remove-Item 'G:\AI\ComfyUI\models\diffusion_models\*.ltxpart*' -Force -ErrorAction SilentlyContinue
Remove-Item 'G:\AI\ComfyUI\models\diffusion_models\ltx25_uncensored_v1.1-fp8_scaled.safetensors' -Force -ErrorAction SilentlyContinue
Remove-Item 'G:\AI\ComfyUI\models\diffusion_models\*.aria2' -Force -ErrorAction SilentlyContinue
Write-Output "diffusion_models ltx files cleaned"
