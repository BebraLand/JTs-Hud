import { spawn } from 'child_process'

const SLOT_TO_VK: Record<number, number> = {
  0: 0x30,
  1: 0x31,
  2: 0x32,
  3: 0x33,
  4: 0x34,
  5: 0x35,
  6: 0x36,
  7: 0x37,
  8: 0x38,
  9: 0x39
}

const encodePowerShell = (script: string): string =>
  Buffer.from(script, 'utf16le').toString('base64')

export const simulateObserverSlotKey = (observerSlot: number, timeoutMs = 4000): Promise<void> => {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Keyboard fallback is available only on Windows'))
  }
  const virtualKey = SLOT_TO_VK[observerSlot]
  if (!virtualKey) {
    return Promise.reject(new Error(`No keyboard key for observer slot ${observerSlot}`))
  }

  const script = `
$signature = @'
using System;
using System.Runtime.InteropServices;
public static class JtsObserverKeys {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
'@
Add-Type -TypeDefinition $signature
$cs2 = Get-Process -Name cs2 -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $cs2) { throw "CS2 window not found" }
[JtsObserverKeys]::SetForegroundWindow($cs2.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 60
[JtsObserverKeys]::keybd_event([byte]${virtualKey}, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 35
[JtsObserverKeys]::keybd_event([byte]${virtualKey}, 0, 2, [UIntPtr]::Zero)
`

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        encodePowerShell(script)
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
    )
    let stderr = ''
    const timeout = setTimeout(() => child.kill(), timeoutMs)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4096)
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `Keyboard simulation failed (${signal ?? code})`))
    })
  })
}
