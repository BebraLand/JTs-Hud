import type { TelnetCommandOptions, TelnetCommandResult } from '../../../camera/telnet'
import type { TelnetConnectionSettings } from '../settings/telnetSettings'
import type {
  AutoDirectorSettings,
  CameraCommandResult,
  CameraTransport,
  PlayerScore
} from './autoDirector.types'
import type { AerialCameraAnchor } from './aerial/aerialCameraRegistry'

const safePlayerName = (name: string): string =>
  name
    .replace(/[\r\n;]/g, ' ')
    .replace(/["\\]/g, '')
    .trim()
    .slice(0, 64)

export class CameraController {
  constructor(
    private readonly readTelnetSettings: () => Promise<TelnetConnectionSettings>,
    private readonly sendTelnet: (
      command: string,
      options?: TelnetCommandOptions
    ) => Promise<TelnetCommandResult>,
    private readonly sendObserverKey: (observerSlot: number) => Promise<void>
  ) {}

  async switchTo(
    player: PlayerScore,
    settings: AutoDirectorSettings
  ): Promise<CameraCommandResult> {
    const keyboardAllowed = settings.autoFallback
    const attempts: NonNullable<CameraCommandResult['attempts']> = []
    let telnetError: Error | null = null

    try {
      const name = safePlayerName(player.name)
      if (!name) throw new Error('Player name is empty after command sanitization')
      const telnet = await this.readTelnetSettings()
      await this.sendTelnet(`spec_player "${name}"\nspec_mode 1`, {
        host: telnet.host,
        port: telnet.port,
        timeoutMs: 3000,
        requireAck: true
      })
      attempts.push({ transport: 'telnet', ok: true, message: 'Command acknowledged' })
      return {
        ok: true,
        transport: 'telnet',
        message: `Switched to ${player.name} through Telnet`,
        at: Date.now(),
        attempts
      }
    } catch (error) {
      telnetError = error instanceof Error ? error : new Error(String(error))
      attempts.push({ transport: 'telnet', ok: false, message: telnetError.message })
      if (!keyboardAllowed) {
        return {
          ok: false,
          transport: 'telnet',
          message: telnetError.message,
          at: Date.now(),
          attempts
        }
      }
    }

    try {
      await this.sendObserverKey(player.observerSlot)
      attempts.push({ transport: 'keyboard', ok: true, message: 'Observer key sent' })
      return {
        ok: true,
        transport: 'keyboard',
        message: telnetError
          ? `Telnet failed (${telnetError.message}); switched to ${player.name} with keyboard fallback`
          : `Switched to ${player.name} with keyboard fallback`,
        at: Date.now(),
        attempts
      }
    } catch (error) {
      const keyboardError = error instanceof Error ? error : new Error(String(error))
      attempts.push({ transport: 'keyboard', ok: false, message: keyboardError.message })
      return {
        ok: false,
        transport: 'keyboard',
        message: telnetError
          ? `Telnet: ${telnetError.message}; keyboard: ${keyboardError.message}`
          : keyboardError.message,
        at: Date.now(),
        attempts
      }
    }
  }

  /**
   * Reuses the exact NetCon pose command produced by the calibration app.
   * Keyboard fallback is deliberately unavailable for non-player presentation.
   */
  async moveToAerial(
    anchor: AerialCameraAnchor,
    presentationAngles: AerialCameraAnchor['angles'] = anchor.angles
  ): Promise<CameraCommandResult> {
    const values = [...anchor.position, ...presentationAngles]
    if (values.some((value) => !Number.isFinite(value))) {
      return {
        ok: false,
        transport: 'telnet',
        message: `Aerial anchor ${anchor.id} has an invalid pose`,
        at: Date.now(),
        attempts: [{ transport: 'telnet', ok: false, message: 'Invalid Aerial pose' }]
      }
    }
    try {
      const telnet = await this.readTelnetSettings()
      const position = anchor.position.map((value) => String(value)).join(' ')
      // Static spectator cameras use CS2's spec_goto path. Unlike setpos_exact
      // and setang_exact, spec_goto applies the roaming camera pose after the
      // observer leaves the player POV. Player POV restoration remains handled
      // by switchTo() with spec_mode 1.
      const pitch = String(presentationAngles[0])
      const yaw = String(presentationAngles[1])
      await this.sendTelnet(`spec_mode 5\nspec_mode 6\nspec_goto ${position} ${pitch} ${yaw}`, {
        host: telnet.host,
        port: telnet.port,
        timeoutMs: 3000,
        requireAck: true
      })
      return {
        ok: true,
        transport: 'telnet',
        message: `Moved to calibrated Aerial camera: ${anchor.label}`,
        at: Date.now(),
        attempts: [{ transport: 'telnet', ok: true, message: 'Aerial pose acknowledged' }]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        transport: 'telnet',
        message,
        at: Date.now(),
        attempts: [{ transport: 'telnet', ok: false, message }]
      }
    }
  }

  async test(
    transport: CameraTransport,
    _settings: AutoDirectorSettings,
    observerSlot = 1
  ): Promise<CameraCommandResult> {
    try {
      if (transport === 'telnet') {
        const telnet = await this.readTelnetSettings()
        await this.sendTelnet('echo JTsHudAutoDirector_test', {
          host: telnet.host,
          port: telnet.port,
          timeoutMs: 3000,
          requireAck: true
        })
      } else {
        await this.sendObserverKey(observerSlot)
      }
      return {
        ok: true,
        transport,
        message:
          transport === 'telnet'
            ? 'Telnet acknowledged the test'
            : `Sent observer key for slot ${observerSlot}`,
        at: Date.now(),
        attempts: [{ transport, ok: true, message: 'Transport test passed' }]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        transport,
        message,
        at: Date.now(),
        attempts: [{ transport, ok: false, message }]
      }
    }
  }

  async probeHlae(): Promise<CameraCommandResult> {
    try {
      const telnet = await this.readTelnetSettings()
      const result = await this.sendTelnet('mirv_campath', {
        host: telnet.host,
        port: telnet.port,
        timeoutMs: 3000,
        requireAck: true
      })
      if (/unknown command|not found/i.test(result.response)) {
        throw new Error('HLAE commands are unavailable in the current CS2 session')
      }
      return {
        ok: true,
        transport: 'telnet',
        message: 'HLAE commands are available',
        at: Date.now(),
        attempts: [{ transport: 'telnet', ok: true, message: 'HLAE probe passed' }]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        transport: 'telnet',
        message,
        at: Date.now(),
        attempts: [{ transport: 'telnet', ok: false, message }]
      }
    }
  }

  async loadHlaePath(sourcePath: string, durationSeconds?: number): Promise<CameraCommandResult> {
    try {
      const telnet = await this.readTelnetSettings()
      const safePath = sourcePath.replace(/["\r\n]/g, '')
      const durationCommand = Number.isFinite(durationSeconds)
        ? `\nmirv_campath edit duration ${Math.max(0.5, Math.min(300, Number(durationSeconds))).toFixed(1)}`
        : ''
      await this.sendTelnet(
        `mirv_campath load "${safePath}"\nmirv_campath edit start${durationCommand}\nmirv_campath enabled 1`,
        {
          host: telnet.host,
          port: telnet.port,
          timeoutMs: 5000,
          requireAck: true
        }
      )
      return {
        ok: true,
        transport: 'telnet',
        message: `Loaded HLAE campath ${sourcePath}`,
        at: Date.now(),
        attempts: [{ transport: 'telnet', ok: true, message: 'HLAE campath enabled' }]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        transport: 'telnet',
        message,
        at: Date.now(),
        attempts: [{ transport: 'telnet', ok: false, message }]
      }
    }
  }

  async disableHlae(): Promise<CameraCommandResult> {
    try {
      const telnet = await this.readTelnetSettings()
      await this.sendTelnet('mirv_campath enabled 0', {
        host: telnet.host,
        port: telnet.port,
        timeoutMs: 3000,
        requireAck: true
      })
      return {
        ok: true,
        transport: 'telnet',
        message: 'HLAE campath disabled',
        at: Date.now(),
        attempts: [{ transport: 'telnet', ok: true, message: 'HLAE disabled' }]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        transport: 'telnet',
        message,
        at: Date.now(),
        attempts: [{ transport: 'telnet', ok: false, message }]
      }
    }
  }

  async setHlaeDuration(durationSeconds: number): Promise<CameraCommandResult> {
    try {
      const telnet = await this.readTelnetSettings()
      const duration = Math.max(0.5, Math.min(300, Number(durationSeconds)))
      if (!Number.isFinite(duration)) throw new Error('Invalid HLAE duration')
      await this.sendTelnet(`mirv_campath edit duration ${duration.toFixed(1)}`, {
        host: telnet.host,
        port: telnet.port,
        timeoutMs: 3000,
        requireAck: true
      })
      return {
        ok: true,
        transport: 'telnet',
        message: `HLAE campath duration set to ${duration.toFixed(1)}s`,
        at: Date.now(),
        attempts: [{ transport: 'telnet', ok: true, message: 'HLAE duration updated' }]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        transport: 'telnet',
        message,
        at: Date.now(),
        attempts: [{ transport: 'telnet', ok: false, message }]
      }
    }
  }
}
