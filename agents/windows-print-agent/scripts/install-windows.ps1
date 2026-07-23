#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$taskName = "PrintDesk Agent"
$sourceRoot = $PSScriptRoot
$targetRoot = Join-Path $env:ProgramData "PrintDesk"
$targetExe = Join-Path $targetRoot "printdesk-agent.exe"
$targetConfig = Join-Path $targetRoot "config.json"
$credentials = Join-Path $targetRoot "credentials.json"

if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "printdesk-agent.exe"))) {
  throw "printdesk-agent.exe no está junto al instalador"
}
if (-not (Test-Path -LiteralPath $credentials)) {
  throw "Falta la credencial local: $credentials"
}

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
Copy-Item -LiteralPath (Join-Path $sourceRoot "printdesk-agent.exe") -Destination $targetExe -Force
foreach ($script in @("status-windows.ps1", "uninstall-windows.ps1")) {
  Copy-Item -LiteralPath (Join-Path $sourceRoot $script) -Destination (Join-Path $targetRoot $script) -Force
}
if (-not (Test-Path -LiteralPath $targetConfig)) {
  Copy-Item -LiteralPath (Join-Path $sourceRoot "config.json.example") -Destination $targetConfig
}

$acl = Get-Acl -LiteralPath $targetRoot
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @("S-1-5-18", "S-1-5-32-544")) {
  $identity = [System.Security.Principal.SecurityIdentifier]::new($sid)
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $identity,
    "FullControl",
    "ContainerInherit,ObjectInherit",
    "None",
    "Allow"
  )
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $targetRoot -AclObject $acl

$action = New-ScheduledTaskAction -Execute $targetExe -WorkingDirectory $targetRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $taskName `
  -Description "Recibe tickets PrintDesk y los entrega por TCP 9100." `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2

$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Output "PrintDesk Agent instalado sin ventana visible."
Write-Output "Último resultado: $($info.LastTaskResult)"
Write-Output "Log: $(Join-Path $targetRoot 'logs\agent.log')"
