import os from 'node:os'

let previousCpu = process.cpuUsage()
let previousAt = process.hrtime.bigint()

export interface SystemStats {
  cpuPercent: number
  rssMb: number
  heapUsedMb: number
  heapTotalMb: number
  logicalCores: number
}

export const getSystemStats = (): SystemStats => {
  const now = process.hrtime.bigint()
  const elapsedMs = Number(now - previousAt) / 1_000_000
  const cpu = process.cpuUsage(previousCpu)
  previousCpu = process.cpuUsage()
  previousAt = now

  const cpuMs = (cpu.user + cpu.system) / 1_000
  const logicalCores = Math.max(1, os.cpus().length)
  const cpuPercent = elapsedMs > 0 ? (cpuMs / elapsedMs / logicalCores) * 100 : 0
  const memory = process.memoryUsage()
  const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10

  return {
    cpuPercent: Math.round(Math.min(100, Math.max(0, cpuPercent)) * 10) / 10,
    rssMb: toMb(memory.rss),
    heapUsedMb: toMb(memory.heapUsed),
    heapTotalMb: toMb(memory.heapTotal),
    logicalCores
  }
}
