#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$taskName = "PrintDesk Agent"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Write-Output "Inicio automático eliminado. Configuración, credencial, logs y spool se conservan."
