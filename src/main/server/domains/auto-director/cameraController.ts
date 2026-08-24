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
  async moveToAerial(anchor: AerialCameraAnchor): Promise<CameraCommandResult> {
    const values = [...anchor.position, ...anchor.angles]
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
      const angles = anchor.angles.map((value) => String(value)).join(' ')
      // CS2 ignores setpos_exact while the observer is still attached to a
      // player POV. Enter roaming/free-camera mode before applying the pose.
      // Player POV restoration remains handled by switchTo() with spec_mode 1.
      await this.sendTelnet(`spec_mode 6\nsetpos_exact ${position}\nsetang_exact ${angles}`, {
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
}
