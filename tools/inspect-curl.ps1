# inspect-powershell.ps1 — 列出全部 powershell 进程定位下载脚本真身
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object {
  $cl = if ($_.CommandLine) { ($_.CommandLine -replace '\s+', ' ') } else { '<NULL>' }
  [PSCustomObject]@{
    Pid     = $_.ProcessId
    Parent  = $_.ParentProcessId
    Created = $_.CreationDate.ToString('HH:mm:ss')
    Cmd     = $cl.Substring(0, [Math]::Min(180, $cl.Length))
  }
} | Format-List
