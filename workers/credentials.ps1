$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ReelCredential {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
 [DllImport("advapi32.dll",EntryPoint="CredWriteW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Write(ref CREDENTIAL c,uint flags);
 [DllImport("advapi32.dll",EntryPoint="CredReadW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Read(string name,uint type,uint flags,out IntPtr ptr);
 [DllImport("advapi32.dll",EntryPoint="CredDeleteW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Delete(string name,uint type,uint flags);
 [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr ptr);
}
'@
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.provider -notin @('gemini','openrouter')) { throw 'Invalid provider' }
$target = 'REELMIND/' + $request.provider
if ($request.action -eq 'get') {
 $ptr = [IntPtr]::Zero
 if ([ReelCredential]::Read($target,1,0,[ref]$ptr)) {
  try { $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][ReelCredential+CREDENTIAL]); [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob,$credential.CredentialBlobSize/2)) } finally { [ReelCredential]::CredFree($ptr) }
 }
} elseif ($request.action -eq 'set') {
 if ([string]::IsNullOrEmpty($request.key)) { [void][ReelCredential]::Delete($target,1,0); exit }
 $blob = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni($request.key)
 try { $credential = New-Object ReelCredential+CREDENTIAL; $credential.Type=1; $credential.TargetName=$target; $credential.UserName='REELMIND'; $credential.CredentialBlob=$blob; $credential.CredentialBlobSize=[Text.Encoding]::Unicode.GetByteCount($request.key); $credential.Persist=2; if (-not [ReelCredential]::Write([ref]$credential,0)) { $code=[Runtime.InteropServices.Marshal]::GetLastWin32Error(); throw ('Windows Credential Manager could not save the key. Windows error '+$code) } } finally { [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($blob) }
}
