import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon } from './Icon';
import { useBackdropDismiss } from './useBackdropDismiss';

/**
 * Takes a photograph, or accepts one from the device.
 *
 * ===========================================================================
 * TWO SOURCES, ONE RESULT
 * ===========================================================================
 * The camera is the point — a superintendent standing in front of the defect
 * should not have to leave the app, take a photo, come back and find it. But
 * the camera is also the fragile path: it needs a permission the user may
 * refuse, hardware a desktop may not have, and a secure context that a plain
 * `http://` address on a site LAN does not provide.
 *
 * So upload is not a fallback, it is a peer. The dialog opens on whichever is
 * available, and either way hands back one Blob. Everything downstream — the
 * downscale, the store, the annotation, the PDF — is identical.
 *
 * ---------------------------------------------------------------------------
 * THE STREAM MUST BE STOPPED, ALWAYS
 * ---------------------------------------------------------------------------
 * A MediaStream keeps the camera active until every track is stopped. Leaving
 * one running leaves the recording light on after the dialog closes, which on a
 * customer's device is not a bug, it is a trust problem. It is stopped on
 * unmount, on switching to upload, and after a capture — three paths, all of
 * them routed through `stopStream` so none can be forgotten.
 */

/**
 * @returns {{ ask: (request: object) => Promise<Blob|null>, dialog: React.ReactNode }}
 */
export function usePhotoCapture() {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const settle = useCallback((blob) => {
    resolverRef.current?.(blob);
    resolverRef.current = null;
    setRequest(null);
  }, []);

  const ask = useCallback(
    (next) =>
      new Promise((resolve) => {
        resolverRef.current?.(null);
        resolverRef.current = resolve;
        setRequest(next ?? {});
      }),
    [],
  );

  const dialog = request ? (
    <PhotoCaptureDialog
      {...request}
      onAccept={(blob) => settle(blob)}
      onCancel={() => settle(null)}
    />
  ) : null;

  return { ask, dialog };
}

const MODE = { CHOOSE: 'choose', CAMERA: 'camera', PREVIEW: 'preview' };

export function PhotoCaptureDialog({
  title = 'Add a photo',
  hint = 'Take one now, or choose a file.',
  confirmLabel = 'Add photo',
  onAccept,
  onCancel,
}) {
  const [mode, setMode] = useState(MODE.CHOOSE);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [facing, setFacing] = useState('environment');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  const backdrop = useBackdropDismiss(onCancel);

  // The single stop path. See the class comment for why this is not inlined.
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopStream, [stopStream]);

  // Object URLs for the preview are revoked here rather than through the shared
  // cache: this one is never stored, and it dies with the dialog.
  useEffect(() => {
    if (!captured) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(captured);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [captured]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const cameraSupported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const startCamera = useCallback(
    async (preferred) => {
      setError(null);
      setBusy(true);
      stopStream();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // `ideal` rather than `exact`: a laptop has no rear camera, and
          // `exact` would fail outright instead of using the one it has.
          video: { facingMode: { ideal: preferred }, width: { ideal: 1920 } },
          audio: false,
        });

        streamRef.current = stream;
        setMode(MODE.CAMERA);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // iOS Safari will not autoplay without this, and a black rectangle
          // looks identical to a broken camera.
          await videoRef.current.play().catch(() => {});
        }
      } catch (cause) {
        stopStream();
        setMode(MODE.CHOOSE);
        setError(describeCameraError(cause));
      } finally {
        setBusy(false);
      }
    },
    [stopStream],
  );

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('The photo could not be captured. Try again.');
          return;
        }
        // Stopped as soon as we have the frame — the preview step does not need
        // the camera, and holding it there is what leaves the light on.
        stopStream();
        setCaptured(blob);
        setMode(MODE.PREVIEW);
      },
      'image/jpeg',
      0.92,
    );
  }, [stopStream]);

  const chooseFile = useCallback((file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That is not an image file.');
      return;
    }
    setError(null);
    setCaptured(file);
    setMode(MODE.PREVIEW);
  }, []);

  const retake = useCallback(() => {
    setCaptured(null);
    setError(null);
    setMode(MODE.CHOOSE);
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" {...backdrop}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="photo-title">{title}</h2>
        <p className="modal-hint">{hint}</p>

        {error && (
          <p className="notice notice-incomplete" role="alert">
            <Icon name="alert" size={18} /> {error}
          </p>
        )}

        <div className="photo-stage">
          {mode === MODE.CHOOSE && (
            <div className="photo-choices">
              <button
                type="button"
                className="photo-choice"
                onClick={() => void startCamera(facing)}
                disabled={!cameraSupported || busy}
              >
                <Icon name="camera" size={32} />
                <span className="photo-choice-label">Take a photo</span>
                <span className="photo-choice-hint">
                  {cameraSupported
                    ? 'Uses the device camera'
                    : 'Not available on this device or connection'}
                </span>
              </button>

              <button
                type="button"
                className="photo-choice"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                <Icon name="upload" size={32} />
                <span className="photo-choice-label">Choose a file</span>
                <span className="photo-choice-hint">JPEG, PNG, HEIC or WebP</span>
              </button>
            </div>
          )}

          {mode === MODE.CAMERA && (
            <div className="photo-camera">
              {/* muted + playsInline are both required for iOS to show a live
                  preview rather than taking over the screen with a player. */}
              <video ref={videoRef} className="photo-video" muted playsInline />
              <div className="photo-camera-actions">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    const next = facing === 'environment' ? 'user' : 'environment';
                    setFacing(next);
                    void startCamera(next);
                  }}
                  aria-label="Switch camera"
                  title="Switch camera"
                >
                  <Icon name="switchCamera" size={22} />
                </button>
                <button type="button" className="shutter" onClick={capture} aria-label="Capture photo">
                  <span className="shutter-ring" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    stopStream();
                    setMode(MODE.CHOOSE);
                  }}
                  aria-label="Back"
                  title="Back"
                >
                  <Icon name="close" size={22} />
                </button>
              </div>
            </div>
          )}

          {mode === MODE.PREVIEW && previewUrl && (
            <div className="photo-preview">
              <img src={previewUrl} alt="The photo you are about to add" />
              <p className="photo-preview-note">
                Resized to 1600px on the longest edge before it is saved, so the
                export stays openable.
              </p>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            chooseFile(event.target.files?.[0]);
            // Reset so picking the SAME file twice still fires a change event.
            event.target.value = '';
          }}
        />

        <div className="modal-actions">
          {mode === MODE.PREVIEW ? (
            <>
              <button type="button" onClick={retake}>
                Choose another
              </button>
              <button type="button" className="primary" onClick={() => onAccept(captured)}>
                {confirmLabel}
              </button>
            </>
          ) : (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Turns a getUserMedia rejection into something the user can act on.
 *
 * The browser's own messages are written for developers ("Requested device not
 * found"), and on a site the difference between "you said no" and "this address
 * is not HTTPS" decides whether the user taps allow or gives up.
 */
function describeCameraError(cause) {
  const name = cause?.name ?? '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    // The insecure-context case reports as NotAllowedError in several browsers,
    // and it is the one a team hits first when testing over a LAN address.
    return window.isSecureContext
      ? 'Camera access was blocked. Allow it in your browser settings, or choose a file instead.'
      : 'The camera needs a secure (https) connection. Choose a file instead, or open the app over https.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device. Choose a file instead.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is being used by another app. Close it and try again.';
  }
  return 'The camera could not be opened. Choose a file instead.';
}
