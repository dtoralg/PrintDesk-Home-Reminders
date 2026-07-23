$taskName = "PrintDesk Agent"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$info = Get-ScheduledTaskInfo -TaskName $taskName
[pscustomobject]@{
  State = $task.State
  LastRunTime = $info.LastRunTime
  LastTaskResult = $info.LastTaskResult
  NextRunTime = $info.NextRunTime
  Log = Join-Path $env:ProgramData "PrintDesk\logs\agent.log"
}
