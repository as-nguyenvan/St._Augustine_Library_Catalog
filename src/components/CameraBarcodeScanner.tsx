import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  HTMLCanvasElementLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
} from '@zxing/library';
import { BookRecord, cleanIsbn } from '../utils/isbn';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  AlertCircle,
  ScanLine,
  Volume2,
} from 'lucide-react';

export interface ScanDetectedResult {
  book: BookRecord;
  incrementedCopy: boolean;
}

interface CameraBarcodeScannerProps {
  onBarcodeDetected: (
    isbn: string,
    overrideTitle?: string,
    overrideAuthor?: string,
    overrideRoom?: string
  ) => Promise<ScanDetectedResult | null>;
  isProcessingScan: boolean;
}

/**
 * Plays a crisp two-tone confirmation chime using the Web Audio API
 * (works on iPhone Safari and desktop browsers without external audio files).
 */
function playScanSuccessChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Tone 1: A5 (880 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.11);

    // Tone 2: E6 (1318.5 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.5, now + 0.09);
    gain2.gain.setValueAtTime(0.22, now + 0.09);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.26);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 350);
  } catch {
    // Ignore if audio is muted or blocked
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(100);
    }
  } catch {
    // Ignore if vibration is unsupported
  }
}

export const CameraBarcodeScanner: React.FC<CameraBarcodeScannerProps> = ({
  onBarcodeDetected,
  isProcessingScan,
}) => {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [defaultRoom, setDefaultRoom] = useState('Main Reading Room');
  const [manualIsbn, setManualIsbn] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualAuthor, setManualAuthor] = useState('');
  const [recentScans, setRecentScans] = useState<BookRecord[]>([]);
  const [isScanSuccessGreen, setIsScanSuccessGreen] = useState(false);
  const [scanStatusMessage, setScanStatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const zxingReaderRef = useRef<MultiFormatReader | null>(null);
  const lastScannedRef = useRef<{ isbn: string; time: number }>({
    isbn: '',
    time: 0,
  });
  const greenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getZxingReader = () => {
    if (!zxingReaderRef.current) {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new MultiFormatReader();
      reader.setHints(hints);
      zxingReaderRef.current = reader;
    }
    return zxingReaderRef.current;
  };

  const stopCamera = useCallback(() => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
      if (greenTimerRef.current) {
        clearTimeout(greenTimerRef.current);
      }
    };
  }, [stopCamera]);

  const triggerGreenSuccessFeedback = useCallback(
    (outcome: ScanDetectedResult) => {
      playScanSuccessChime();
      setIsScanSuccessGreen(true);
      if (greenTimerRef.current) {
        clearTimeout(greenTimerRef.current);
      }
      greenTimerRef.current = setTimeout(() => {
        setIsScanSuccessGreen(false);
      }, 4000);

      const { book, incrementedCopy } = outcome;
      setRecentScans((prev) => [
        book,
        ...prev.filter((b) => b.id !== book.id).slice(0, 4),
      ]);
      setScanStatusMessage({
        type: 'success',
        text: incrementedCopy
          ? `Scan Successful! Incremented copy count for "${book.title}" to ${book.copyCount} copies (${book.formattedIsbn}).`
          : `Scan Successful! Appended "${book.title}" by ${book.author} (Copies: ${book.copyCount}) to master dataset.`,
      });
    },
    []
  );

  const handleDecodedIsbn = useCallback(
    async (rawCode: string) => {
      const cleaned = cleanIsbn(rawCode);
      if (cleaned.length < 10) return;

      // Prevent duplicate accidental frame reads within 2.5 seconds
      const now = Date.now();
      if (
        lastScannedRef.current.isbn === cleaned &&
        now - lastScannedRef.current.time < 2500
      ) {
        return;
      }
      lastScannedRef.current = { isbn: cleaned, time: now };

      setScanStatusMessage({
        type: 'info',
        text: `Detected barcode ${cleaned} — updating master dataset...`,
      });

      const outcome = await onBarcodeDetected(
        cleaned,
        undefined,
        undefined,
        defaultRoom
      );
      if (outcome) {
        triggerGreenSuccessFeedback(outcome);
      }
    },
    [defaultRoom, onBarcodeDetected, triggerGreenSuccessFeedback]
  );

  const startLiveCamera = async () => {
    setCameraError(null);
    setScanStatusMessage(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Camera access is not available in this browser context. Please ensure you are visiting over HTTPS and have granted camera permission.'
      );
      return;
    }

    try {
      stopCamera();

      // Request rear camera first, with fallback to any available video camera
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      }

      streamRef.current = stream;
      const videoEl = videoRef.current;
      if (!videoEl) {
        throw new Error('Camera video element not ready.');
      }

      // Critical iOS Safari attributes so the video element renders live frames instead of a black box
      videoEl.setAttribute('playsinline', 'true');
      videoEl.setAttribute('webkit-playsinline', 'true');
      videoEl.setAttribute('autoplay', 'true');
      videoEl.muted = true;
      videoEl.srcObject = stream;

      setIsCameraActive(true);
      await videoEl.play();

      // Set up optional native BarcodeDetector if supported by the browser
      type NativeBarcodeDetector = {
        detect: (
          source: HTMLVideoElement | HTMLCanvasElement
        ) => Promise<Array<{ rawValue?: string }>>;
      };
      let nativeDetector: NativeBarcodeDetector | null = null;
      const WinWithDetector = window as unknown as {
        BarcodeDetector?: new (opts?: { formats: string[] }) => NativeBarcodeDetector;
      };
      if (WinWithDetector.BarcodeDetector) {
        try {
          nativeDetector = new WinWithDetector.BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
          });
        } catch {
          nativeDetector = null;
        }
      }

      const zxingReader = getZxingReader();
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      // Continuous frame scanner (every 180ms)
      scanTimerRef.current = setInterval(async () => {
        if (
          !videoRef.current ||
          videoRef.current.readyState < 2 ||
          videoRef.current.videoWidth === 0
        ) {
          return;
        }

        const v = videoRef.current;

        // 1. Try native BarcodeDetector first if available
        if (nativeDetector) {
          try {
            const results = await nativeDetector.detect(v);
            if (results && results.length > 0 && results[0].rawValue) {
              handleDecodedIsbn(results[0].rawValue);
              return;
            }
          } catch {
            // Fall through to ZXing canvas decoder
          }
        }

        // 2. Decode via ZXing from offscreen canvas frame
        if (ctx) {
          try {
            const vw = v.videoWidth;
            const vh = v.videoHeight;
            canvas.width = vw;
            canvas.height = vh;
            ctx.drawImage(v, 0, 0, vw, vh);

            const luminanceSource = new HTMLCanvasElementLuminanceSource(canvas);
            const binaryBitmap = new BinaryBitmap(
              new HybridBinarizer(luminanceSource)
            );
            const result = zxingReader.decode(binaryBitmap);
            if (result && result.getText()) {
              handleDecodedIsbn(result.getText());
            }
          } catch {
            // No barcode in current frame — continue scanning next frame
          }
        }
      }, 180);
    } catch (err: unknown) {
      stopCamera();
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not start iPhone camera stream.';
      setCameraError(
        `Camera error: ${msg}. Please allow camera access in Safari Settings.`
      );
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualIsbn.trim()) {
      setScanStatusMessage({
        type: 'error',
        text: 'Please enter or scan a 10 or 13-digit ISBN.',
      });
      return;
    }
    const outcome = await onBarcodeDetected(
      manualIsbn.trim(),
      manualTitle.trim() || undefined,
      manualAuthor.trim() || undefined,
      defaultRoom.trim() || 'Main Reading Room'
    );
    if (outcome) {
      triggerGreenSuccessFeedback(outcome);
      setManualIsbn('');
      setManualTitle('');
      setManualAuthor('');
    }
  };

  return (
    <div
      className={`rounded-lg border-2 p-4 sm:p-6 space-y-5 transition-all duration-300 ${
        isScanSuccessGreen
          ? 'border-emerald-500 bg-emerald-50/40 ring-4 ring-emerald-500/20'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base sm:text-lg font-semibold text-slate-900">
              In-Site iPhone Camera ISBN Barcode Scanner
            </h2>
            {isScanSuccessGreen && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Scan Successful</span>
              </span>
            )}
          </div>
          <p className="mt-1 text-xs sm:text-sm text-slate-600">
            Open your iPhone camera below to scan any publisher ISBN or custom 7×11 cut-out barcode. Scanning an existing ISBN automatically increments its copy count and plays a confirmation chime.
          </p>
        </div>

        {/* Default Room Location for Camera Scans */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 w-full lg:w-auto">
          <label
            htmlFor="scanner-default-room"
            className="text-xs font-medium text-slate-700"
          >
            Default Room for Scans:
          </label>
          <input
            id="scanner-default-room"
            type="text"
            value={defaultRoom}
            onChange={(e) => setDefaultRoom(e.target.value)}
            placeholder="e.g. Patristic Hall · Room 101"
            className="w-full sm:w-52 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
          />
        </div>
      </div>

      {/* Camera Launch Controls & Viewfinder */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div
          data-testid="scanner-viewfinder"
          className={`lg:col-span-7 flex flex-col justify-between rounded-lg border-2 p-3 sm:p-4 text-white min-h-[260px] relative overflow-hidden transition-colors duration-300 ${
            isScanSuccessGreen
              ? 'border-emerald-400 bg-emerald-950'
              : 'border-slate-200 bg-slate-950'
          }`}
        >
          {/* Idle overlay when camera is not active */}
          {!isCameraActive && (
            <div className="my-auto py-6 px-3 text-center space-y-4">
              {isScanSuccessGreen ? (
                <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto" />
              ) : (
                <Camera className="h-8 w-8 text-slate-400 mx-auto" />
              )}
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">
                  {isScanSuccessGreen
                    ? 'Barcode Scanned Successfully — Catalog Updated Live!'
                    : 'Ready to Scan ISBN Barcodes with Your iPhone'}
                </p>
                <p
                  className={`text-xs max-w-md mx-auto ${
                    isScanSuccessGreen ? 'text-emerald-200' : 'text-slate-400'
                  }`}
                >
                  Tap below to start the live rear camera barcode scanner and point your camera at any book ISBN barcode.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={startLiveCamera}
                  className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-xs font-semibold transition-colors ${
                    isScanSuccessGreen
                      ? 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300'
                      : 'bg-white text-slate-950 hover:bg-slate-100'
                  }`}
                >
                  <Camera className="h-4 w-4 shrink-0" />
                  <span>Open iPhone Live Camera Scanner</span>
                </button>
              </div>
            </div>
          )}

          {/* Always-mounted video container so videoRef.current is immediately available on tap in iOS Safari */}
          <div
            className={
              isCameraActive
                ? 'flex flex-col h-full justify-between space-y-3'
                : 'hidden'
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-200">
              <span className="inline-flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>
                  {isScanSuccessGreen
                    ? 'Scan Confirmed! Ready for Next Book'
                    : 'Live Camera Active — Center Barcode in Frame'}
                </span>
              </span>
              <button
                type="button"
                onClick={stopCamera}
                className="inline-flex items-center gap-1.5 rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
              >
                <CameraOff className="h-3.5 w-3.5" />
                <span>Stop Camera</span>
              </button>
            </div>

            <div className="relative w-full aspect-video rounded overflow-hidden bg-black border border-slate-800">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="w-full h-full object-cover"
              />
              {/* Barcode Targeting Guide Overlay — switches to green on scan success */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
                <div
                  className={`w-full max-w-[240px] h-24 sm:h-28 border-2 rounded-md flex items-center justify-center transition-colors duration-200 ${
                    isScanSuccessGreen
                      ? 'border-emerald-400 bg-emerald-500/25'
                      : 'border-white/80'
                  }`}
                >
                  <div
                    className={`w-full h-0.5 ${
                      isScanSuccessGreen ? 'bg-emerald-400' : 'bg-red-500/80'
                    }`}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Recent Live Scans & Manual / Handheld Scanner Input */}
        <div className="lg:col-span-5 flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/60 p-4 sm:p-5 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <h3 className="text-xs font-semibold text-slate-900">
                Manual / Handheld Scanner Input
              </h3>
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                EAN-13 / ISBN-13
              </span>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="manual-isbn-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  ISBN Barcode Number *
                </label>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    id="manual-isbn-input"
                    type="text"
                    value={manualIsbn}
                    onChange={(e) => setManualIsbn(e.target.value)}
                    placeholder="e.g. 9780140449136 or 979000..."
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isProcessingScan}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium text-white transition-colors shrink-0 disabled:opacity-50 ${
                      isScanSuccessGreen
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-slate-900 hover:bg-slate-800'
                    }`}
                  >
                    <ScanLine className="h-3.5 w-3.5" />
                    <span>{isProcessingScan ? 'Adding...' : 'Scan & Append'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="manual-title-override"
                    className="block text-[11px] font-medium text-slate-600 mb-1"
                  >
                    Title Override (Optional)
                  </label>
                  <input
                    id="manual-title-override"
                    type="text"
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    placeholder="Auto-resolved"
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="manual-author-override"
                    className="block text-[11px] font-medium text-slate-600 mb-1"
                  >
                    Author Override (Optional)
                  </label>
                  <input
                    id="manual-author-override"
                    type="text"
                    value={manualAuthor}
                    onChange={(e) => setManualAuthor(e.target.value)}
                    placeholder="Auto-resolved"
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>
            </form>
          </div>

          {/* Live Status Feedback */}
          {cameraError && (
            <div
              role="alert"
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{cameraError}</span>
            </div>
          )}

          {scanStatusMessage && (
            <div
              role="status"
              className={`rounded-md border p-3 text-xs font-medium flex items-start gap-2 ${
                scanStatusMessage.type === 'success'
                  ? 'border-emerald-500 bg-emerald-600 text-white'
                  : scanStatusMessage.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="break-words">{scanStatusMessage.text}</span>
            </div>
          )}

          {/* Session Scanned Books Feed */}
          <div className="pt-2 border-t border-slate-200">
            <div className="text-[11px] font-semibold text-slate-500 mb-2">
              Recently Scanned in This Session ({recentScans.length})
            </div>
            {recentScans.length === 0 ? (
              <p className="text-xs text-slate-500">
                Scan a barcode with your iPhone camera or enter an ISBN above to append it live or increment its copy count in the master dataset.
              </p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {recentScans.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 rounded border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5"
                  >
                    <div className="truncate">
                      <span className="font-semibold text-slate-900">{b.title}</span>
                      <span className="text-slate-600"> · {b.author}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums text-[11px]">
                      <span className="font-semibold text-emerald-800">
                        Copies: {b.copyCount || 1}
                      </span>
                      <span className="text-slate-500">{b.formattedIsbn}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
