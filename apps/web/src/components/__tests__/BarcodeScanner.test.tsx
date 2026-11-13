import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { BarcodeScanner } from "../BarcodeScanner";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

// Mock @zxing/browser
const mockDecodeFromVideoDevice = vi.fn();
let mockReader = {
  decodeFromVideoDevice: mockDecodeFromVideoDevice,
};

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: vi.fn().mockImplementation(() => mockReader),
  BarcodeFormat: {
    EAN_13: "EAN_13",
    EAN_8: "EAN_8",
    UPC_A: "UPC_A",
    UPC_E: "UPC_E",
    CODE_128: "CODE_128",
    CODE_39: "CODE_39",
    ITF: "ITF",
  },
}));

// Mock navigator.mediaDevices
const mockGetUserMedia = vi.fn();
const mockEnumerateDevices = vi.fn();

const mockMediaStream = {
  getTracks: () => [{ stop: vi.fn() }],
  getVideoTracks: () => [{ stop: vi.fn() }],
  getAudioTracks: () => [],
  addTrack: vi.fn(),
  removeTrack: vi.fn(),
  clone: vi.fn(),
  active: true,
  id: "mock-stream",
};

Object.defineProperty(navigator, "mediaDevices", {
  value: {
    getUserMedia: mockGetUserMedia,
    enumerateDevices: mockEnumerateDevices,
  },
  configurable: true,
});

// Mock requestAnimationFrame
global.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(cb, 16)) as unknown as (callback: FrameRequestCallback) => number;
global.cancelAnimationFrame = vi.fn();

// Mock media device info
const mockVideoDevices: MediaDeviceInfo[] = [
  { deviceId: "front-camera", kind: "videoinput", label: "Front Camera", groupId: "group1", toJSON: () => "" },
  { deviceId: "back-camera", kind: "videoinput", label: "Back Camera", groupId: "group2", toJSON: () => "" },
];

describe("BarcodeScanner", () => {
  const onScan = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    // Clear mocks individually to avoid clearing BrowserMultiFormatReader mock constructor
    mockGetUserMedia.mockClear();
    mockEnumerateDevices.mockClear();
    mockDecodeFromVideoDevice.mockReset(); // Reset implementation to avoid test pollution
    onScan.mockClear();
    onClose.mockClear();
    mockGetUserMedia.mockResolvedValue(mockMediaStream);
    mockEnumerateDevices.mockResolvedValue(mockVideoDevices);
  });

  afterEach(() => {
    // Don't use vi.resetAllMocks() as it resets the @zxing/browser module mock
    // Individual mocks are reset in beforeEach
  });

  test("renders permission request screen initially", () => {
    render(<BarcodeScanner onScan={onScan} onClose={onClose} />);

    expect(screen.getByText("Scan Barcode")).toBeInTheDocument();
    expect(screen.getByText("Point your camera at a product barcode to look up nutrition information.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow Camera Access" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  test("calls onClose when Cancel button is clicked", () => {
    render(<BarcodeScanner onScan={onScan} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("requests camera permission when Allow Camera Access is clicked", async () => {
    render(<BarcodeScanner onScan={onScan} onClose={onClose} />);

    // Wait for device enumeration to complete
    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({ video: true });
    });

    fireEvent.click(screen.getByRole("button", { name: "Allow Camera Access" }));

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({ video: { deviceId: { exact: "back-camera" } } });
    });
  });

  test("shows error when camera permission is denied", async () => {
    // First call (enumerateDevices) succeeds, second call (handlePermissionGranted) fails
    mockGetUserMedia
      .mockResolvedValueOnce({} as MediaStream) // enumerateDevices
      .mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError")); // handlePermissionGranted

    render(<BarcodeScanner onScan={onScan} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Allow Camera Access" }));

    await waitFor(() => {
      expect(screen.getByText("Camera permission denied. Please allow camera access in your browser settings.")).toBeInTheDocument();
    });
  });

  test("shows error when no camera is found", async () => {
    // First call (enumerateDevices) succeeds, second call (handlePermissionGranted) fails
    mockGetUserMedia
      .mockResolvedValueOnce({} as MediaStream) // enumerateDevices
      .mockRejectedValueOnce(new DOMException("No camera found", "NotFoundError")); // handlePermissionGranted

    render(<BarcodeScanner onScan={onScan} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Allow Camera Access" }));

    await waitFor(() => {
      expect(screen.getByText("Camera permission denied. Please allow camera access in your browser settings.")).toBeInTheDocument();
    });
  });

  test("starts scanning after permission granted", async () => {
    mockDecodeFromVideoDevice.mockImplementation(() => {});

    render(<BarcodeScanner onScan={onScan} onClose={onClose} />);

    // Wait for device enumeration to complete (getUserMedia + enumerateDevices)
    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({ video: true });
    });
    await waitFor(() => {
      expect(mockEnumerateDevices).toHaveBeenCalled();
    });

    // Flush pending React state updates (selectedDeviceId, devices) from enumerateDevices
    await act(async () => {
      await Promise.resolve();
    });

    // Click Allow Camera Access - this triggers getUserMedia and starts scanning
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow Camera Access" }));
      await Promise.resolve();
    });

    // Wait for scanning UI to appear (Pause/Close buttons)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });

    // Wait for the useEffect to fire and decodeFromVideoDevice to be called
    await waitFor(() => {
      expect(mockDecodeFromVideoDevice).toHaveBeenCalled();
    });
  });

  test("calls onScan when barcode is detected", async () => {
    mockDecodeFromVideoDevice.mockImplementation((_deviceId, _videoElement, callback) => {
      // Simulate a barcode detection - call callback synchronously for testing
      const mockResult = {
        getText: () => "1234567890123",
        getBarcodeFormat: () => "EAN_13",
      };
      callback(mockResult);
    });

    render(<BarcodeScanner onScan={onScan} onClose={onClose} />);

    // Wait for device enumeration to complete (getUserMedia + enumerateDevices)
    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({ video: true });
    });
    await waitFor(() => {
      expect(mockEnumerateDevices).toHaveBeenCalled();
    });

    // Flush pending React state updates (selectedDeviceId, devices) from enumerateDevices
    await act(async () => {
      await Promise.resolve();
    });

    // Click Allow Camera Access - this triggers getUserMedia and starts scanning
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow Camera Access" }));
      await Promise.resolve();
    });

    // Wait for scanning UI to appear (Pause/Close buttons)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });

    // Wait for the useEffect to fire and decodeFromVideoDevice to be called
    await waitFor(() => {
      expect(mockDecodeFromVideoDevice).toHaveBeenCalled();
    });

    // Wait for onScan to be called
    await waitFor(() => {
      expect(onScan).toHaveBeenCalledWith("1234567890123", "EAN_13");
    });
  });

  test("debounces duplicate scans", async () => {
    mockDecodeFromVideoDevice.mockImplementation((_deviceId, _videoElement, callback) => {
      const mockResult = {
        getText: () => "1234567890123",
        getBarcodeFormat: () => "EAN_13",
      };
      // Call callback multiple times synchronously
      callback(mockResult);
      callback(mockResult);
      callback(mockResult);
    });

    render(<BarcodeScanner onScan={onScan} onClose={onClose} />);

    // Wait for device enumeration to complete (getUserMedia + enumerateDevices)
    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({ video: true });
    });
    await waitFor(() => {
      expect(mockEnumerateDevices).toHaveBeenCalled();
    });

    // Flush pending React state updates (selectedDeviceId, devices) from enumerateDevices
    await act(async () => {
      await Promise.resolve();
    });

    // Click Allow Camera Access - this triggers getUserMedia and starts scanning
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow Camera Access" }));
      await Promise.resolve();
    });

    // Wait for scanning UI to appear (Pause/Close buttons)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });

    // Wait for the useEffect to fire and decodeFromVideoDevice to be called
    await waitFor(() => {
      expect(mockDecodeFromVideoDevice).toHaveBeenCalled();
    });

    // Wait for onScan to be called once (debounced)
    await waitFor(() => {
      expect(onScan).toHaveBeenCalledTimes(1);
    });
  });

  test("shows camera selector when multiple cameras available", async () => {
    render(<BarcodeScanner onScan={onScan} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Allow Camera Access" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    const options = screen.getByRole("combobox").querySelectorAll("option");
    expect(options).toHaveLength(2);
  });

  test("shows pause/close controls when scanning", async () => {
    mockDecodeFromVideoDevice.mockImplementation(() => {});

    render(<BarcodeScanner onScan={onScan} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Allow Camera Access" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });
  });

  test("shows scanning overlay with animated frame", async () => {
    mockDecodeFromVideoDevice.mockImplementation(() => {});

    render(<BarcodeScanner onScan={onScan} onClose={onClose} />);

    // Wait for device enumeration to complete (getUserMedia + enumerateDevices)
    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({ video: true });
    });
    await waitFor(() => {
      expect(mockEnumerateDevices).toHaveBeenCalled();
    });

    // Flush pending React state updates (selectedDeviceId, devices) from enumerateDevices
    await act(async () => {
      await Promise.resolve();
    });

    // Click Allow Camera Access - wrap in act and flush microtasks for handlePermissionGranted
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow Camera Access" }));
      await Promise.resolve();
    });

    // Wait for scanning UI to appear
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });

    // Verify video element exists in the scanning UI
    const video = screen.getByTestId("scanner-video");
    expect(video).toBeInTheDocument();
    // Verify scanning overlay (animated frame) exists - look for the frame with border
    const overlay = screen.getByTestId("scanning-overlay");
    expect(overlay).toBeInTheDocument();
  });
});