import os from 'node:os';
import path from 'node:path';
import { run } from './process';

export interface GpuTelemetry {
  gpuUtilPct: number;
  encoderUtilPct: number;
  decoderUtilPct: number;
  vramUsedMb: number;
  vramTotalMb: number;
  temperatureC: number;
}

export interface HardwareInfo {
  // Legacy / core compatibility fields
  nvenc: boolean;
  cudaSpeechCandidate: boolean;
  cpuThreads: number;
  vramMb: number;
  display: string;

  // Real capability verification (distinguishing detected vs usable)
  gpuDetected: boolean;
  gpuName: string;
  driverVersion?: string;
  cudaAvailable: boolean;
  cudaDeviceCount: number;
  cudaRuntimeAvailable: boolean;
  ctranslate2Cuda: boolean;
  whisperCuda: boolean;
  whisperComputeType: string;
  onnxGpu: boolean;
  onnxActiveProvider: string;
  ffmpegNvenc: boolean;
  ffmpegNvdec: boolean;
  ffmpegCudaFilters: boolean;
  overallAcceleration: 'ACTIVE' | 'PARTIAL' | 'CPU';
  diagnosticsReport: string;
  errors?: Record<string, string>;
}

export function defaultHardware(): HardwareInfo {
  return {
    nvenc: false,
    cudaSpeechCandidate: false,
    cpuThreads: Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2))),
    vramMb: 0,
    display: 'CPU processing · NVIDIA GPU not detected',

    gpuDetected: false,
    gpuName: 'None',
    driverVersion: undefined,
    cudaAvailable: false,
    cudaDeviceCount: 0,
    cudaRuntimeAvailable: false,
    ctranslate2Cuda: false,
    whisperCuda: false,
    whisperComputeType: 'int8',
    onnxGpu: false,
    onnxActiveProvider: 'CPUExecutionProvider',
    ffmpegNvenc: false,
    ffmpegNvdec: false,
    ffmpegCudaFilters: false,
    overallAcceleration: 'CPU',
    diagnosticsReport: 'REELMIND GPU DIAGNOSTICS: NVIDIA GPU not detected. Using CPU.',
    errors: {},
  };
}

export function configureHardware(hardware: HardwareInfo, vramMb: number): HardwareInfo {
  hardware.vramMb = vramMb;
  hardware.nvenc = vramMb >= 2048;
  hardware.ffmpegNvenc = hardware.nvenc;
  if (hardware.whisperCuda) {
    hardware.cudaSpeechCandidate = true;
  } else {
    // If not verified via real probe, require high VRAM as minimal prerequisite
    hardware.cudaSpeechCandidate = vramMb >= 4096;
  }
  if (vramMb && vramMb < 4096) hardware.cpuThreads = Math.min(4, hardware.cpuThreads);
  return hardware;
}

export function hardwareSummary(hw: HardwareInfo): string {
  if (!hw.gpuDetected && !hw.vramMb) return 'CPU processing · NVIDIA GPU not detected';
  const name = hw.gpuName || 'NVIDIA GPU';
  const vramGb = Math.round(hw.vramMb / 1024);

  if (hw.whisperCuda && hw.ffmpegNvenc) {
    return `${name} · ${vramGb} GB VRAM · CUDA & NVENC active`;
  }
  if (hw.ffmpegNvenc) {
    return `${name} · ${vramGb} GB VRAM · NVENC encode active (CPU Whisper)`;
  }
  return `${name} · ${vramGb} GB VRAM · CPU processing`;
}

export function buildDiagnosticsReport(hw: HardwareInfo): string {
  const lines = [
    '========================================',
    '      REELMIND GPU DIAGNOSTICS',
    '========================================',
    `GPU: ${hw.gpuName}`,
    `VRAM: ${hw.vramMb} MB`,
    `Driver Version: ${hw.driverVersion || 'Unknown'}`,
    '',
    'CUDA',
    `Available: ${hw.cudaAvailable ? 'YES' : 'NO'}`,
    `Device Count: ${hw.cudaDeviceCount}`,
    '',
    'CTranslate2',
    `CUDA Available: ${hw.ctranslate2Cuda ? 'YES' : 'NO'}`,
    '',
    'Whisper',
    `Device: ${hw.whisperCuda ? 'CUDA' : 'CPU'}`,
    `Compute Type: ${hw.whisperComputeType}`,
    `Status: ${hw.whisperCuda ? 'GPU acceleration active' : 'CPU fallback'}`,
    hw.errors?.whisper ? `Reason: ${hw.errors.whisper}` : '',
    '',
    'ONNX Runtime',
    `CUDA Provider: ${hw.onnxGpu ? 'AVAILABLE' : 'UNAVAILABLE'}`,
    `Active Provider: ${hw.onnxActiveProvider}`,
    hw.errors?.onnx ? `Reason: ${hw.errors.onnx}` : '',
    '',
    'FFmpeg',
    `NVENC: ${hw.ffmpegNvenc ? 'AVAILABLE' : 'UNAVAILABLE'}`,
    `NVDEC: ${hw.ffmpegNvdec ? 'AVAILABLE' : 'UNAVAILABLE'}`,
    `CUDA Filters: ${hw.ffmpegCudaFilters ? 'AVAILABLE' : 'UNAVAILABLE'}`,
    '',
    'Renderer',
    `Decode: ${hw.ffmpegNvdec ? 'GPU (NVDEC)' : 'CPU'}`,
    'Filters: Hybrid',
    `Encode: ${hw.ffmpegNvenc ? 'NVENC (h264_nvenc)' : 'CPU (libopenh264)'}`,
    '',
    'Overall GPU Acceleration',
    `STATUS: ${hw.overallAcceleration}`,
    '========================================',
  ].filter(l => l !== undefined);

  return lines.join('\n');
}

export async function queryGpuTelemetry(
  runner?: (cmd: string, args: string[]) => Promise<string>
): Promise<GpuTelemetry | null> {
  try {
    const runCmd = runner || run;
    const stdout = await runCmd('nvidia-smi', [
      '--query-gpu=utilization.gpu,utilization.encoder,utilization.decoder,memory.used,memory.total,temperature.gpu',
      '--format=csv,noheader,nounits',
    ]);
    const fields = stdout.trim().split('\n')[0].split(',').map(s => Number(s.trim()) || 0);
    if (fields.length >= 6) {
      return {
        gpuUtilPct: fields[0],
        encoderUtilPct: fields[1],
        decoderUtilPct: fields[2],
        vramUsedMb: fields[3],
        vramTotalMb: fields[4],
        temperatureC: fields[5],
      };
    }
  } catch {
    // Return null if GPU telemetry unavailable
  }
  return null;
}

export async function probe(
  runner?: (cmd: string, args: string[]) => Promise<string>,
  runtimeDir?: string,
  workersDir?: string
): Promise<HardwareInfo> {
  const hw = defaultHardware();
  const runCmd = runner || run;
  const errors: Record<string, string> = {};

  // 1. Probe NVIDIA hardware via nvidia-smi
  try {
    const smiOut = await runCmd('nvidia-smi', [
      '--query-gpu=name,memory.total,driver_version',
      '--format=csv,noheader,nounits',
    ]);
    const fields = smiOut.trim().split('\n')[0].split(',');
    if (fields.length >= 2) {
      hw.gpuDetected = true;
      hw.gpuName = fields.slice(0, -2).join(',').trim() || fields[0].trim();
      hw.vramMb = Number(fields[fields.length - 2]?.trim() || 0);
      hw.driverVersion = fields[fields.length - 1]?.trim();
    }
  } catch (err: any) {
    errors.smi = err.message || 'nvidia-smi failed or not installed';
  }

  // 2. Probe FFmpeg NVENC, NVDEC, and CUDA filters
  const ffmpegExe = runtimeDir ? path.join(runtimeDir, 'ffmpeg.exe') : 'ffmpeg.exe';
  try {
    const [encoders, hwaccels, decoders, filters] = await Promise.all([
      runCmd(ffmpegExe, ['-hide_banner', '-encoders']).catch(() => ''),
      runCmd(ffmpegExe, ['-hide_banner', '-hwaccels']).catch(() => ''),
      runCmd(ffmpegExe, ['-hide_banner', '-decoders']).catch(() => ''),
      runCmd(ffmpegExe, ['-hide_banner', '-filters']).catch(() => ''),
    ]);

    hw.ffmpegNvenc = encoders.includes('h264_nvenc');
    hw.nvenc = hw.ffmpegNvenc;
    hw.ffmpegNvdec = hwaccels.includes('cuda') || decoders.includes('h264_cuvid');
    hw.ffmpegCudaFilters = filters.includes('scale_cuda');
  } catch (err: any) {
    errors.ffmpeg = err.message || 'FFmpeg probe failed';
  }

  // 3. Probe Python runtime: CTranslate2, faster-whisper, and ONNX Runtime
  const pythonExe = runtimeDir ? path.join(runtimeDir, 'python', 'python.exe') : 'python.exe';
  const gpuPy = workersDir ? path.join(workersDir, 'shared', 'gpu.py') : 'workers/shared/gpu.py';

  try {
    const pyOut = await runCmd(pythonExe, [gpuPy, '--probe']);
    const pyData = JSON.parse(pyOut.trim());

    if (pyData.gpu_detected) {
      hw.gpuDetected = true;
      if (!hw.gpuName || hw.gpuName === 'None') hw.gpuName = pyData.gpu_name;
      if (!hw.vramMb) hw.vramMb = pyData.vram_mb;
      if (!hw.driverVersion) hw.driverVersion = pyData.driver_version;
    }

    hw.cudaAvailable = !!pyData.cuda_available;
    hw.cudaDeviceCount = pyData.cuda_device_count || (hw.cudaAvailable ? 1 : 0);
    hw.ctranslate2Cuda = !!pyData.ctranslate2_cuda;
    hw.whisperCuda = !!pyData.whisper_cuda;
    hw.whisperComputeType = pyData.whisper_compute_type || (hw.whisperCuda ? 'float16' : 'int8');
    if (pyData.whisper_error) errors.whisper = pyData.whisper_error;

    hw.onnxGpu = !!pyData.onnx_cuda;
    hw.onnxActiveProvider = pyData.onnx_active_provider || 'CPUExecutionProvider';
    if (pyData.onnx_error) errors.onnx = pyData.onnx_error;
  } catch (err: any) {
    errors.python = err.message || 'Python GPU diagnostic probe failed';
    // Fallback based on vram if python probe failed
    if (hw.vramMb >= 4096) {
      hw.whisperCuda = false;
    }
  }

  // Crucial: Only enable speech GPU candidate if Whisper CUDA was genuinely verified!
  hw.cudaSpeechCandidate = hw.whisperCuda;
  hw.cudaRuntimeAvailable = hw.cudaAvailable;

  // Determine overall acceleration state
  if (hw.whisperCuda && hw.ffmpegNvenc) {
    hw.overallAcceleration = 'ACTIVE';
  } else if (hw.ffmpegNvenc || hw.whisperCuda || hw.onnxGpu) {
    hw.overallAcceleration = 'PARTIAL';
  } else {
    hw.overallAcceleration = 'CPU';
  }

  hw.errors = errors;
  hw.display = hardwareSummary(hw);
  hw.diagnosticsReport = buildDiagnosticsReport(hw);

  return hw;
}
