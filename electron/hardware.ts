import os from 'node:os';
import { run } from './process';

export interface HardwareInfo {
  nvenc: boolean;
  cudaSpeechCandidate: boolean;
  cpuThreads: number;
  vramMb: number;
  display: string;
}

export function defaultHardware(): HardwareInfo {
  return {
    nvenc: false,
    cudaSpeechCandidate: false,
    cpuThreads: Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2))),
    vramMb: 0,
    display: 'CPU encoding available · NVIDIA GPU not detected',
  };
}

export function configureHardware(hardware: HardwareInfo, vramMb: number): HardwareInfo {
  hardware.vramMb = vramMb;
  hardware.nvenc = vramMb >= 2048;
  hardware.cudaSpeechCandidate = vramMb >= 4096;
  if (vramMb && vramMb < 4096) hardware.cpuThreads = Math.min(4, hardware.cpuThreads);
  return hardware;
}

export function hardwareSummary(vramMb: number, gpuName?: string): string {
  if (!gpuName && !vramMb) return 'CPU encoding available · NVIDIA GPU not detected';
  const name = gpuName?.trim() || 'NVIDIA GPU';
  return `${name} · ${Math.round(vramMb / 1024)} GB VRAM · ${vramMb >= 2048 ? 'NVENC enabled' : 'CPU encoding'}`;
}

export async function probe(runner?: (cmd: string, args: string[]) => Promise<string>): Promise<HardwareInfo> {
  const hw = defaultHardware();
  try {
    const runCmd = runner || run;
    const value = await runCmd('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
    const fields = value.trim().split(',');
    const vram = Number(fields.at(-1)?.trim() || 0);
    const gpuName = fields.slice(0, -1).join(',').trim();
    configureHardware(hw, vram);
    hw.display = hardwareSummary(vram, gpuName);
  } catch {
    // Falls back to CPU
  }
  return hw;
}
