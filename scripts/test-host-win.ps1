param(
  [string]$ExePath = "",
  [switch]$RequireExe,
  [switch]$SidecarOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$tmpConfig = Join-Path ([System.IO.Path]::GetTempPath()) ("wide-host-test-" + [System.Diagnostics.Process]::GetCurrentProcess().Id + "-" + (Get-Random))
New-Item -ItemType Directory -Force -Path $tmpConfig | Out-Null

function Invoke-SidecarEarlyReadiness {
  $sidecarPath = Join-Path $RepoRoot "sidecar\sidecar.cjs"
  if (-not (Test-Path $sidecarPath)) {
    throw "sidecar.cjs not found at $sidecarPath"
  }

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = "`"$sidecarPath`""
  $psi.WorkingDirectory = $RepoRoot
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables["APPDATA"] = $tmpConfig
  $psi.EnvironmentVariables["XDG_CONFIG_HOME"] = $tmpConfig

  $proc = [System.Diagnostics.Process]::Start($psi)
  try {
    $payload = '{"t":"invoke","id":"early-ready-1","channel":"workspace:recents","args":[]}'
    $proc.StandardInput.WriteLine($payload)
    $proc.StandardInput.Flush()

    $deadline = (Get-Date).AddSeconds(12)
    $matched = $null
    $readTask = $proc.StandardOutput.ReadLineAsync()
    while ((Get-Date) -lt $deadline) {
      if (-not $readTask.Wait(150)) {
        if ($proc.HasExited) { break }
        continue
      }
      $line = $readTask.Result
      if ($null -eq $line) { break }
      $readTask = $proc.StandardOutput.ReadLineAsync()
      if (-not $line.Trim().StartsWith("{")) { continue }
      try {
        $obj = $line | ConvertFrom-Json
        if ($obj.t -eq "host") {
          $replyPayload = '{"t":"hostReply","id":' + ($obj.id | ConvertTo-Json -Compress) + ',"result":null}'
          $proc.StandardInput.WriteLine($replyPayload)
          $proc.StandardInput.Flush()
          continue
        }
        if ($obj.type -eq "reply" -and $obj.replyId -eq "early-ready-1") {
          $matched = $obj
          break
        }
      } catch {
      }
    }

    if ($null -eq $matched) {
      throw "Sidecar early-invoke gate timed out waiting for replyId=early-ready-1"
    }
    if ($matched.error) {
      throw "Sidecar early-invoke returned error: $($matched.error)"
    }
    if ($null -eq $matched.result -or $null -eq $matched.result.projects) {
      throw "Sidecar early-invoke result missing projects array"
    }
    Write-Output "[host-win] PASS sidecar early-invoke readiness (workspace:recents)"
  } finally {
    try { $proc.StandardInput.Close() } catch {}
    if (-not $proc.HasExited) {
      Start-Sleep -Milliseconds 150
      if (-not $proc.HasExited) { $proc.Kill() }
    }
    $proc.Dispose()
  }
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class WideWinHostProbe {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  public static IntPtr FindMainWindow(uint pid, string expectedTitle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      uint wpid;
      GetWindowThreadProcessId(hWnd, out wpid);
      if (wpid == pid && IsWindowVisible(hWnd)) {
        var sb = new StringBuilder(256);
        GetWindowText(hWnd, sb, 256);
        string t = sb.ToString();
        if (t == expectedTitle || t.StartsWith("Wide")) {
          found = hWnd;
          return false;
        }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static List<string> FindDialogs(uint pid, IntPtr ownerHwnd, string dialogClass) {
    var res = new List<string>();
    EnumWindows((hWnd, lParam) => {
      uint wpid;
      GetWindowThreadProcessId(hWnd, out wpid);
      if (IsWindowVisible(hWnd) && (wpid == pid || (ownerHwnd != IntPtr.Zero && GetWindow(hWnd, 4) == ownerHwnd))) {
        var cls = new StringBuilder(256);
        var txt = new StringBuilder(256);
        GetClassName(hWnd, cls, 256);
        GetWindowText(hWnd, txt, 256);
        if (cls.ToString() == dialogClass) {
          res.Add(hWnd + "|" + txt.ToString());
        }
      }
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
"@

function Resolve-TargetExe {
  if ($ExePath) { return $ExePath }
  $candidates = @(
    (Join-Path $RepoRoot "dist\wide\wide.exe"),
    (Join-Path $RepoRoot "dist\wide-app\wide-app.exe"),
    (Join-Path $RepoRoot "native-host\target\release\wide.exe"),
    (Join-Path $RepoRoot "native-host\target\release\wide-app.exe")
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  return ""
}

function Resolve-ExpectedTitle {
  $pkgPath = Join-Path $RepoRoot "package.json"
  if (Test-Path $pkgPath) {
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    if ($pkg.name -eq "wide-app") { return "Wide App" }
  }
  return "Wide IDE"
}

try {
  Invoke-SidecarEarlyReadiness

  if ($SidecarOnly) {
    exit 0
  }

  $targetExe = Resolve-TargetExe
  if (-not $targetExe) {
    if ($RequireExe) {
      throw "No packaged Windows executable found under dist/"
    }
    Write-Output "[host-win] SKIP packaged UI check (no exe found under dist/)"
    exit 0
  }

  $expectedTitle = Resolve-ExpectedTitle
  $prevXdg = $env:XDG_CONFIG_HOME
  $env:XDG_CONFIG_HOME = $tmpConfig
  $proc = Start-Process -FilePath $targetExe -PassThru
  try {
    $hwnd = [IntPtr]::Zero
    for ($i = 0; $i -lt 45; $i++) {
      Start-Sleep -Milliseconds 300
      $hwnd = [WideWinHostProbe]::FindMainWindow([uint32]$proc.Id, $expectedTitle)
      if ($hwnd -ne [IntPtr]::Zero) { break }
    }
    if ($hwnd -eq [IntPtr]::Zero) {
      throw "Main window not visible for $targetExe (pid $($proc.Id))"
    }

    Start-Sleep -Milliseconds 2500

    $rect = New-Object WideWinHostProbe+RECT
    [void][WideWinHostProbe]::GetWindowRect($hwnd, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $zoomed = [WideWinHostProbe]::IsZoomed($hwnd)

    if (-not $zoomed) {
      throw "Expected main window to open maximized (IsZoomed=False, rect=${width}x${height})"
    }
    if ($width -lt 400 -or $height -lt 300) {
      throw "Window dimensions too small: ${width}x${height}"
    }

    $dlgClass = ([char]35 + "32770")
    $dialogs = [WideWinHostProbe]::FindDialogs([uint32]$proc.Id, $hwnd, $dlgClass)
    if ($dialogs.Count -gt 0) {
      throw ("Unexpected native modal dialogs open: " + ($dialogs -join "; "))
    }

    $rootEl = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if ($null -eq $rootEl) {
      throw "UIAutomation returned null root element"
    }
    $restoreEl = $rootEl.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Restore"))
    )
    $closeEl = $rootEl.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Close"))
    )
    $uiaReady = ($null -ne $restoreEl) -or ($null -ne $closeEl)
    if (-not $uiaReady) {
      throw "UIAutomation could not find window caption controls (Restore/Close)"
    }

    Write-Output "[host-win] PASS packaged host window ($expectedTitle, Zoomed=$zoomed, Rect=${width}x${height}, UIAReady=$uiaReady)"
  } finally {
    $env:XDG_CONFIG_HOME = $prevXdg
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    if ($proc -and -not $proc.HasExited) {
      cmd.exe /c "taskkill /PID $($proc.Id) /T /F >nul 2>&1"
    }
    $ErrorActionPreference = $prevPref
  }
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmpConfig
}
