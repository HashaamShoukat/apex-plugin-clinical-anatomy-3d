param([Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,[Parameter(Mandatory=$true)][string]$ProjectPath)
$ErrorActionPreference='Stop'
$releasePath=Join-Path $ProjectPath 'dist\release'
$archivePath=Join-Path $ProjectPath ('dist\clinical-anatomy-3d-'+$Version+'.zip')
Compress-Archive -Path (Join-Path $releasePath '*') -DestinationPath $archivePath -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$releaseZip=[IO.Compression.ZipFile]::OpenRead($archivePath)
try {
 $expected=@(Get-ChildItem -LiteralPath $releasePath -Recurse -File | ForEach-Object { $_.FullName.Substring($releasePath.Length+1).Replace('\','/') })
 $actual=@($releaseZip.Entries | Where-Object { -not $_.FullName.EndsWith('/') } | ForEach-Object { $_.FullName.Replace('\','/') })
 if (@(Compare-Object $expected $actual).Count) { throw 'Archive file list differs from release' }
 foreach($entry in $releaseZip.Entries) {
  if($entry.FullName.EndsWith('/')) { continue }
  $stream=$entry.Open();$hasher=[Security.Cryptography.SHA256]::Create()
  try {
   $hash=([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','')
   $sourceHash=(Get-FileHash -LiteralPath (Join-Path $releasePath $entry.FullName) -Algorithm SHA256).Hash
   if($hash -ne $sourceHash) { throw ('Archive content differs: '+$entry.FullName) }
  } finally { $stream.Dispose();$hasher.Dispose() }
 }
} finally { $releaseZip.Dispose() }
