# run-comfyui-fg.ps1 — ComfyUI 前台运行器（供保持的 SSH 会话内使用）
# 背景: start-comfyui-h3hypit.ps1 用 Start-Process, SSH 会话结束后子进程死亡（PATCHES.md 记载）。
# 本脚本直接前台执行 python（& 调用），进程随 SSH 会话存活；stdout 原样输出到会话。
$env:PYTHONUNBUFFERED = '1'
Set-Location 'G:\Comfy-Desktop\ComfyUI-Installs\ComfyUI'
& 'G:\AI\ComfyUI\.venv\Scripts\python.exe' -s ComfyUI\main.py `
  --feature-flag show_signin_button=true `
  --feature-flag enable_telemetry=true `
  --base-directory 'G:\AI\ComfyUI' `
  --user-directory 'G:\AI\ComfyUI\user' `
  --database-url 'sqlite:///G:/AI/ComfyUI/user/comfyui.db' `
  --listen 0.0.0.0 --port 8000 --enable-manager --fast `
  --extra-model-paths-config 'C:\Users\EroCat\AppData\Roaming\Comfy Desktop\instance-model-paths\inst-1782466490942.yaml' `
  --input-directory 'G:\AI\ComfyUI\input' `
  --output-directory 'G:\AI\ComfyUI\output'
