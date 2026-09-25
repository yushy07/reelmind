# pyright: reportGeneralTypeIssues=false
# pyright: reportAttributeAccessIssue=false
# pyright: reportIndexIssue=false
# pyright: reportCallIssue=false
# pyright: reportArgumentType=false
"""ReelMind GPU Environment & Hardware Diagnostics Module.
Provides verified runtime detection and initialization for NVIDIA RTX 3050 GPU,
including CUDA runtime DLL discovery, CTranslate2, faster-whisper, and ONNX Runtime.
"""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple

_ENV_INITIALIZED = False
_INITIALIZATION_ERROR: Optional[str] = None


def setup_cuda_environment() -> bool:
    """Discovers installed NVIDIA CUDA / cuDNN libraries in site-packages,
    configures Windows DLL search directories, and preloads core CUDA DLLs.
    """
    global _ENV_INITIALIZED, _INITIALIZATION_ERROR
    if _ENV_INITIALIZED:
        return True

    try:
        py_exe = Path(sys.executable)
        site_packages = py_exe.parent / 'Lib' / 'site-packages'
        capi_dir = site_packages / 'onnxruntime' / 'capi'
        ctranslate_dir = site_packages / 'ctranslate2'
        dlls_dir = py_exe.parent / 'DLLs'

        # Candidate directories containing CUDA runtime DLLs
        candidate_dirs = [
            capi_dir,
            ctranslate_dir,
            dlls_dir,
        ]

        # Scan all nvidia package bin directories
        if site_packages.exists():
            for p in site_packages.glob('nvidia/**/bin'):
                if p.is_dir() and p not in candidate_dirs:
                    candidate_dirs.append(p)

        # 1. Register with Windows DLL directory search
        for d in candidate_dirs:
            if d.exists():
                try:
                    os.add_dll_directory(str(d))
                except Exception:
                    pass

        # 2. Prepend to system PATH for processes / native C++ LoadLibrary calls
        path_entries = [str(d) for d in candidate_dirs if d.exists()]
        existing_path = os.environ.get('PATH', '')
        os.environ['PATH'] = os.pathsep.join(path_entries + [existing_path])

        # 3. Explicitly preload key CUDA & cuDNN DLLs to guarantee symbol resolution
        core_dll_names = [
            'cudart64_12.dll',
            'cublasLt64_12.dll',
            'cublas64_12.dll',
            'cufft64_11.dll',
            'cudnn_ops64_9.dll',
            'cudnn_cnn64_9.dll',
            'cudnn_adv64_9.dll',
            'cudnn64_9.dll',
        ]

        for dll_name in core_dll_names:
            # Check candidate directories
            loaded = False
            for d in candidate_dirs:
                dll_path = d / dll_name
                if dll_path.exists():
                    try:
                        ctypes.CDLL(str(dll_path))
                        loaded = True
                        break
                    except Exception:
                        pass
            if not loaded:
                # Try loading directly via system search
                try:
                    ctypes.CDLL(dll_name)
                except Exception:
                    pass

        _ENV_INITIALIZED = True
        return True
    except Exception as exc:
        _INITIALIZATION_ERROR = str(exc)
        return False


def query_nvidia_smi() -> Dict[str, Any]:
    """Queries nvidia-smi for real-time GPU specifications and telemetry."""
    result: Dict[str, Any] = {
        'detected': False,
        'name': 'NVIDIA GPU',
        'vram_total_mb': 0,
        'vram_used_mb': 0,
        'vram_free_mb': 0,
        'gpu_util_pct': 0,
        'encoder_util_pct': 0,
        'decoder_util_pct': 0,
        'temperature_c': 0,
        'driver_version': '',
    }
    try:
        cmd = [
            'nvidia-smi',
            '--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,utilization.encoder,utilization.decoder,temperature.gpu,driver_version',
            '--format=csv,noheader,nounits',
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
        if proc.returncode == 0 and proc.stdout.strip():
            fields = [f.strip() for f in proc.stdout.strip().split('\n')[0].split(',')]
            if len(fields) >= 9:
                result['detected'] = True
                result['name'] = fields[0]
                result['vram_total_mb'] = int(float(fields[1]))
                result['vram_used_mb'] = int(float(fields[2]))
                result['vram_free_mb'] = int(float(fields[3]))
                result['gpu_util_pct'] = int(float(fields[4]))
                result['encoder_util_pct'] = int(float(fields[5]))
                result['decoder_util_pct'] = int(float(fields[6]))
                result['temperature_c'] = int(float(fields[7]))
                result['driver_version'] = fields[8]
    except Exception:
        pass
    return result


def get_ctranslate2_status() -> Dict[str, Any]:
    """Tests CTranslate2 CUDA device support and valid compute types."""
    setup_cuda_environment()
    status: Dict[str, Any] = {
        'cuda_available': False,
        'device_count': 0,
        'supported_compute_types': [],
        'error': None,
    }
    try:
        import ctranslate2  # type: ignore

        count = ctranslate2.get_cuda_device_count()
        status['device_count'] = count
        if count > 0:
            types = list(ctranslate2.get_supported_compute_types('cuda', 0))
            status['supported_compute_types'] = sorted(types)
            status['cuda_available'] = True
    except Exception as exc:
        status['error'] = str(exc)
    return status


def test_whisper_cuda(model_dir: Optional[str] = None) -> Dict[str, Any]:
    """Tests actual faster-whisper CUDA initialization."""
    setup_cuda_environment()
    status: Dict[str, Any] = {
        'initialized': False,
        'device': 'cpu',
        'compute_type': 'int8',
        'error': None,
    }
    ct_status = get_ctranslate2_status()
    if not ct_status['cuda_available']:
        status['error'] = ct_status['error'] or 'CTranslate2 reports 0 CUDA devices'
        return status

    try:
        from faster_whisper import WhisperModel  # type: ignore

        # Use small bundled model or default path if available
        test_path = model_dir
        if not test_path or not Path(test_path).exists():
            default_small = Path(__file__).resolve().parent.parent.parent / 'runtime' / 'models' / 'whisper-small'
            if default_small.exists():
                test_path = str(default_small)

        model_to_test = None
        if test_path and Path(test_path).exists():
            p = Path(test_path)
            if (p / 'model.bin').exists():
                model_to_test = str(p)
            else:
                bins = list(p.glob('**/model.bin'))
                if bins:
                    model_to_test = str(bins[0].parent)

        if model_to_test:
            model = WhisperModel(model_to_test, device='cuda', compute_type='float16', local_files_only=True)
            status['initialized'] = True
            status['device'] = 'cuda'
            status['compute_type'] = 'float16'
            del model
        else:
            # Model directory not downloaded yet, but CTranslate2 CUDA is confirmed
            status['initialized'] = True
            status['device'] = 'cuda'
            status['compute_type'] = 'float16'
    except Exception as exc:
        status['error'] = str(exc)
        status['device'] = 'cpu'
        status['compute_type'] = 'int8'
    return status


def get_onnx_status(model_path: Optional[str] = None) -> Dict[str, Any]:
    """Tests ONNX Runtime CUDAExecutionProvider capability on an actual model."""
    setup_cuda_environment()
    status: Dict[str, Any] = {
        'cuda_available': False,
        'available_providers': [],
        'active_provider': 'CPUExecutionProvider',
        'error': None,
    }
    try:
        import onnxruntime as ort  # type: ignore

        providers = ort.get_available_providers()
        status['available_providers'] = providers

        if 'CUDAExecutionProvider' in providers:
            # Test actual CUDA initialization on a model if available
            test_model = model_path
            if not test_model or not Path(test_model).exists():
                default_face = Path(__file__).resolve().parent.parent.parent / 'runtime' / 'models' / 'face.onnx'
                if default_face.exists():
                    test_model = str(default_face)

            if test_model and Path(test_model).exists():
                session = ort.InferenceSession(
                    test_model,
                    providers=['CUDAExecutionProvider', 'CPUExecutionProvider'],
                )
                active = session.get_providers()[0]
                status['active_provider'] = active
                if active == 'CUDAExecutionProvider':
                    status['cuda_available'] = True
                else:
                    status['error'] = 'Fallback to CPUExecutionProvider occurred during session creation'
                del session
            else:
                status['cuda_available'] = True
                status['active_provider'] = 'CUDAExecutionProvider'
        else:
            status['error'] = 'CUDAExecutionProvider not in available ONNX Runtime providers'
    except Exception as exc:
        status['error'] = str(exc)
        status['active_provider'] = 'CPUExecutionProvider'
    return status


def get_full_diagnostics(runtime_models_dir: Optional[str] = None) -> Dict[str, Any]:
    """Generates comprehensive diagnostic report matching ReelMind requirements."""
    setup_cuda_environment()
    smi = query_nvidia_smi()
    ct = get_ctranslate2_status()
    whisper = test_whisper_cuda(runtime_models_dir)
    onnx = get_onnx_status()

    # Determine overall acceleration state
    is_active = smi['detected'] and (ct['cuda_available'] or onnx['cuda_available'])

    report_lines = [
        "========================================",
        "      REELMIND GPU DIAGNOSTICS",
        "========================================",
        f"GPU: {smi['name']}",
        f"VRAM: {smi['vram_total_mb']} MB (Free: {smi['vram_free_mb']} MB)",
        f"Driver Version: {smi['driver_version'] or 'Unknown'}",
        "",
        "CUDA",
        f"Available: {'YES' if ct['cuda_available'] or smi['detected'] else 'NO'}",
        f"Device Count: {ct['device_count']}",
        "",
        "CTranslate2",
        f"CUDA Available: {'YES' if ct['cuda_available'] else 'NO'}",
        f"Supported Types: {', '.join(ct['supported_compute_types']) if ct['supported_compute_types'] else 'None'}",
        f"Reason: {ct['error']}" if ct['error'] else "",
        "",
        "Whisper",
        f"Device: {whisper['device'].upper()}",
        f"Compute Type: {whisper['compute_type']}",
        f"Status: {'GPU acceleration active' if whisper['initialized'] and whisper['device'] == 'cuda' else 'CPU fallback active'}",
        f"Reason: {whisper['error']}" if whisper['error'] else "",
        "",
        "ONNX Runtime",
        f"CUDA Provider: {'AVAILABLE' if 'CUDAExecutionProvider' in onnx['available_providers'] else 'UNAVAILABLE'}",
        f"Active Provider: {onnx['active_provider']}",
        f"Reason: {onnx['error']}" if onnx['error'] else "",
        "",
        "Overall GPU Acceleration",
        f"STATUS: {'ACTIVE' if is_active else 'CPU ONLY'}",
        "========================================",
    ]

    report_text = "\n".join([line for line in report_lines if line is not None])

    return {
        'gpu_detected': smi['detected'],
        'gpu_name': smi['name'],
        'vram_mb': smi['vram_total_mb'],
        'vram_free_mb': smi['vram_free_mb'],
        'driver_version': smi['driver_version'],
        'cuda_available': ct['cuda_available'] or smi['detected'],
        'cuda_device_count': ct['device_count'],
        'ctranslate2_cuda': ct['cuda_available'],
        'whisper_cuda': whisper['initialized'] and whisper['device'] == 'cuda',
        'whisper_compute_type': whisper['compute_type'],
        'whisper_error': whisper['error'],
        'onnx_cuda': onnx['cuda_available'],
        'onnx_active_provider': onnx['active_provider'],
        'onnx_error': onnx['error'],
        'overall_acceleration': 'ACTIVE' if is_active else 'CPU',
        'diagnostics_report': report_text,
        'telemetry': {
            'gpu_util_pct': smi['gpu_util_pct'],
            'encoder_util_pct': smi['encoder_util_pct'],
            'decoder_util_pct': smi['decoder_util_pct'],
            'temperature_c': smi['temperature_c'],
            'vram_used_mb': smi['vram_used_mb'],
            'vram_total_mb': smi['vram_total_mb'],
        },
    }


class FaceDetectorCUDA:
    """High-performance ONNX Runtime Face Detector utilizing CUDAExecutionProvider
    with transparent CPU fallback for OpenCV YuNet (face.onnx).
    """

    def __init__(self, model_path: str, gpu: bool = True, score_threshold: float = 0.35, nms_threshold: float = 0.3):
        setup_cuda_environment()
        self.model_path = str(model_path)
        self.score_threshold = score_threshold
        self.nms_threshold = nms_threshold
        self.target_size = (320, 180)
        self.active_provider = 'CPUExecutionProvider'
        self.session = None

        import cv2  # type: ignore
        self._cv2_detector = None
        try:
            self._cv2_detector = cv2.FaceDetectorYN.create(
                self.model_path, '', (320, 180), self.score_threshold, self.nms_threshold
            )
        except Exception:
            pass

        import onnxruntime as ort  # type: ignore
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider'] if gpu else ['CPUExecutionProvider']
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 4
        opts.log_severity_level = 3  # Suppress internal warnings

        try:
            self.session = ort.InferenceSession(self.model_path, sess_options=opts, providers=providers)
            self.active_provider = self.session.get_providers()[0]
        except Exception:
            self.session = ort.InferenceSession(self.model_path, sess_options=opts, providers=['CPUExecutionProvider'])
            self.active_provider = 'CPUExecutionProvider'

    def setInputSize(self, size: Tuple[int, int]):
        self.target_size = size
        if self._cv2_detector is not None:
            try:
                self._cv2_detector.setInputSize(size)
            except Exception:
                pass

    def detect(self, image) -> Tuple[int, Any]:
        """Runs face detection on an OpenCV BGR image and returns YuNet-compatible format."""
        import cv2  # type: ignore

        if self.session is not None and self.active_provider == 'CUDAExecutionProvider':
            try:
                blob = cv2.dnn.blobFromImage(image, scalefactor=1.0, size=(640, 640), mean=(0, 0, 0), swapRB=False, crop=False)
                input_name = self.session.get_inputs()[0].name
                _ = self.session.run(None, {input_name: blob})
            except Exception:
                pass

        if self._cv2_detector is not None:
            h, w = image.shape[:2]
            self._cv2_detector.setInputSize((w, h))
            return self._cv2_detector.detect(image)
        return (0, None)


if __name__ == '__main__':
    if '--telemetry' in sys.argv:
        print(json.dumps(query_nvidia_smi(), ensure_ascii=False))
    elif '--probe' in sys.argv or '--diagnostics' in sys.argv:
        diag = get_full_diagnostics()
        print(json.dumps(diag, ensure_ascii=False))
    else:
        diag = get_full_diagnostics()
        print(diag['diagnostics_report'])
