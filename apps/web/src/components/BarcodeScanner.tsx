import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader, BarcodeFormat } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { Button, Card, StateBlock, Icon, Text, Title } from "../components/controls";

export interface BarcodeScannerProps {
  onScan: (barcode: string, format: BarcodeFormat) => void;
  onClose: () => void;
  facingMode?: "environment" | "user";
}

const SUPPORTED_FORMATS: BarcodeFormat[] = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
];

export function BarcodeScanner({ onScan, onClose, facingMode = "environment" }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const scannedCodesRef = useRef<Set<string>>(new Set());

  // Initialize code reader
  useEffect(() => {
    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
    readerRef.current = new BrowserMultiFormatReader(hints);
    return () => {
      readerRef.current = null;
    };
  }, []);

  // Enumerate video devices
  useEffect(() => {
    async function enumerateDevices() {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((d) => d.kind === "videoinput");
        setDevices(videoDevices);
        if (videoDevices.length > 0) {
          // Prefer back camera
          const backCamera = videoDevices.find((d) =>
            d.label.toLowerCase().includes("back") ||
            d.label.toLowerCase().includes("rear") ||
            d.label.toLowerCase().includes("environment")
          );
          const firstDevice = videoDevices[0];
          if (firstDevice) {
            setSelectedDeviceId(backCamera?.deviceId ?? firstDevice.deviceId);
          }
        }
      } catch {
        // Permission denied or no camera
      }
    }
    enumerateDevices();
  }, []);

  const startScanning = useCallback(async () => {
    if (!readerRef.current || !videoRef.current || !selectedDeviceId) return;

    setError(null);
    setIsScanning(true);

    try {
      await readerRef.current.decodeFromVideoDevice(
        selectedDeviceId,
        videoRef.current,
        (result) => {
          if (result) {
            const code = result.getText();
            // Debounce: only trigger once per code per session
            if (!scannedCodesRef.current.has(code)) {
              scannedCodesRef.current.add(code);
              const format = result.getBarcodeFormat();
              onScan(code, format);
            }
          }
        }
      );
      setHasPermission(true);
    } catch (err) {
      setIsScanning(false);
      if (err instanceof Error) {
        if (err.name === "NotAllowedError") {
          setError("Camera permission denied. Please allow camera access to scan barcodes.");
        } else if (err.name === "NotFoundError") {
          setError("No camera found. Please connect a camera to scan barcodes.");
        } else if (err.name === "NotReadableError") {
          setError("Camera is already in use by another application.");
        } else {
          setError(`Failed to start scanner: ${err.message}`);
        }
      } else {
        setError("Failed to start scanner. Please try again.");
      }
    }
  }, [selectedDeviceId, onScan]);

  const stopScanning = useCallback(() => {
    setIsScanning(false);
  }, []);

  useEffect(() => {
    if (hasPermission) {
      startScanning();
    }
    return () => stopScanning();
  }, [hasPermission, startScanning, stopScanning]);

  const handlePermissionGranted = async () => {
    try {
      const deviceId = selectedDeviceId ?? undefined;
      await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId ? { exact: deviceId } : undefined } });
      setHasPermission(true);
    } catch {
      setError("Camera permission denied. Please allow camera access in your browser settings.");
    }
  };

  if (!hasPermission && !error) {
    return (
      <Card style={{ maxWidth: 400, margin: "auto", padding: 24, textAlign: "center" }}>
        <Icon name="barcode" style={{ fontSize: 48, marginBottom: 16, color: "var(--color-primary)" }} />
        <Title level={2} style={{ marginBottom: 8 }}>Scan Barcode</Title>
        <Text variant="body" tone="muted" style={{ marginBottom: 24, display: "block" }}>
          Point your camera at a product barcode to look up nutrition information.
        </Text>
        <Button variant="primary" size="large" full onClick={handlePermissionGranted}>
          Allow Camera Access
        </Button>
        <Button variant="ghost" onClick={onClose} style={{ marginTop: 12, display: "block" }}>
          Cancel
        </Button>
      </Card>
    );
  }

  if (error) {
    return (
      <Card style={{ maxWidth: 400, margin: "auto", padding: 24, textAlign: "center" }}>
        <StateBlock kind="error" title="Camera Error" body={error} action={<Button variant="primary" onClick={handlePermissionGranted}>Retry</Button>} />
        <Button variant="ghost" onClick={onClose} style={{ marginTop: 12, display: "block" }}>
          Cancel
        </Button>
      </Card>
    );
  }

  return (
    <Card style={{ maxWidth: 400, margin: "auto", overflow: "hidden" }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "4/3", background: "#000" }}>
        <video
          ref={videoRef}
          data-testid="scanner-video"
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: facingMode === "user" ? "scaleX(-1)" : "none" }}
          playsInline
          muted
        />
        {/* Scanning overlay */}
        <div data-testid="scanning-overlay" style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}>
          <div style={{
            width: "70%",
            height: "40px",
            border: "2px solid var(--color-primary)",
            borderRadius: "8px",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
            position: "relative",
          }}>
            <div style={{
              position: "absolute",
              top: "-8px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "40px",
              height: "4px",
              background: "var(--color-primary)",
              borderRadius: "2px",
              animation: "pulse 1.5s ease-in-out infinite",
            }} />
          </div>
        </div>
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
        <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
          Position the barcode within the frame. Scanning starts automatically.
        </Text>
        <div style={{ display: "flex", gap: 8, width: "100%" }}>
          <Button variant="secondary" onClick={stopScanning} disabled={!isScanning} style={{ flex: 1 }}>
            Pause
          </Button>
          <Button variant="ghost" onClick={onClose} style={{ flex: 1 }}>
            Close
          </Button>
        </div>
        {devices.length > 1 && (
          <select
            value={selectedDeviceId ?? ""}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        )}
      </div>
    </Card>
  );
}