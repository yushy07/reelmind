$ErrorActionPreference = 'Stop'
$helper = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../workers/credentials.ps1'))
foreach ($provider in @('gemini','openrouter')) {
 $secure = Read-Host ($provider + ' key') -AsSecureString
 $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
 try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = 'powershell.exe'
  $info.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $helper + '"'
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $child = New-Object Diagnostics.Process
  $child.StartInfo = $info
  [void]$child.Start()
  $child.StandardInput.Write((@{action='set';provider=$provider;key=$plain} | ConvertTo-Json -Compress))
  $child.StandardInput.Close()
  $plain = $null
  $null = $child.StandardOutput.ReadToEnd()
  $failure = $child.StandardError.ReadToEnd()
  $child.WaitForExit()
  if ($child.ExitCode -ne 0) { if ($failure -match 'Windows error (\d+)') { throw ('Credential storage failed: Windows error '+$Matches[1]) }; throw 'Credential storage failed.' }
  Write-Output ($provider + ': stored securely')
 } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose(); $plain=$null }
}
