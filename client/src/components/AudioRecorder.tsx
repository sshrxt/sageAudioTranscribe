// File: src/components/AudioRecorder.tsx
import React, { useState, useEffect, useRef } from 'react';

interface Clip { url: string; index: number; }

const AudioRecorder: React.FC = () => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [recording, setRecording] = useState<boolean>(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [fullUrl, setFullUrl] = useState<string>('');
  const [transcript, setTranscript] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fullChunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationIdRef = useRef<number | null>(null);

  // Enumerate microphones
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices()
      .then(infos => infos.filter(d => d.kind === 'audioinput'))
      .then(mics => {
        setDevices(mics);
        if (mics.length) setSelectedDeviceId(mics[0].deviceId);
      });
  }, []);

  // Draw waveform
  const drawVisualizer = () => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    if (!canvas || !analyser || !dataArray) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = 'rgb(200, 200, 200)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgb(0, 0, 0)';
    ctx.beginPath();

    const sliceWidth = WIDTH / dataArray.length;
    let x = 0;
    dataArray.forEach((vByte, i) => {
      const v = vByte / 128.0;
      const y = (v * HEIGHT) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceWidth;
    });
    ctx.lineTo(WIDTH, HEIGHT / 2);
    ctx.stroke();

    animationIdRef.current = requestAnimationFrame(drawVisualizer);
  };

  // Send full blob to Whisper API
  const processTranscription = async (blob: Blob) => {
    setIsProcessing(true);
    const formData = new FormData();
    formData.append('audio', blob, 'recording.wav');
  
    try {
      // ← HERE is the fetch to your API
      const res = await fetch('http://localhost:8000/transcribe', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setTranscript(data.transcript);
    } catch (err) {
      console.error('Transcription error', err);
    } finally {
      setIsProcessing(false);
    }
  };
  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined }
    });

    // Visualizer setup
    const audioCtx = new AudioContext();
    audioContextRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    drawVisualizer();

    // Recorder setup (3s chunks)
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;
    fullChunksRef.current = [];
    setClips([]);
    setFullUrl('');
    setTranscript('');

    recorder.ondataavailable = (e: BlobEvent) => {
      if (!e.data.size) return;
      // Accumulate for full
      fullChunksRef.current.push(e.data);
      // Show clip
      setClips(prev => [
        ...prev,
        { url: URL.createObjectURL(e.data), index: prev.length + 1 }
      ]);
    };

    recorder.onstop = () => {
      // Tear down visualizer
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
      audioContextRef.current?.close();

      // Build full blob
      const fullBlob = new Blob(fullChunksRef.current, { type: fullChunksRef.current[0]?.type });
      const url = URL.createObjectURL(fullBlob);
      setFullUrl(url);

      // Trigger Whisper
      processTranscription(fullBlob);

      stream.getTracks().forEach(t => t.stop());
    };

    recorder.start(3000);
    setRecording(true);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    mediaRecorderRef.current = null;
  };

  return (
    <div className="p-4 bg-white rounded shadow w-full max-w-md">
      <h2 className="text-lg font-semibold mb-2">Audio Recorder</h2>
      <canvas ref={canvasRef} width={300} height={100} className="border mb-4 w-full" />
      <select
        value={selectedDeviceId}
        onChange={e => setSelectedDeviceId(e.target.value)}
        className="border p-2 mb-4 w-full"
      >
        {devices.map(mic => (
          <option key={mic.deviceId} value={mic.deviceId}>
            {mic.label || mic.deviceId}
          </option>
        ))}
      </select>
      <div className="space-x-2 mb-4">
        <button
          onClick={startRecording}
          disabled={recording}
          className="px-4 py-2 bg-green-500 text-white rounded disabled:opacity-50"
        >Start</button>
        <button
          onClick={stopRecording}
          disabled={!recording}
          className="px-4 py-2 bg-red-500 text-white rounded disabled:opacity-50"
        >Stop</button>
      </div>
      <div className="space-y-4 mb-4">
        {clips.map(clip => (
          <div key={clip.index}>
            <p className="font-medium mb-1">Clip {clip.index}</p>
            <audio controls src={clip.url} className="w-full" />
            <button
              onClick={() => new Audio(clip.url).play()}
              className="ml-2 px-2 py-1 bg-gray-200 rounded"
            >Replay</button>
          </div>
        ))}
      </div>
      {fullUrl && (
        <div className="mt-4">
          <h3 className="text-md font-semibold mb-1">Full Recording</h3>
          <audio controls src={fullUrl} className="w-full mb-2" />
          <div className="mb-2">
            {isProcessing ? (
              <p className="text-sm text-gray-500">Transcribing...</p>
            ) : (
              <p className="whitespace-pre-wrap bg-gray-100 p-2 rounded">{transcript}</p>
            )}
          </div>
          <a
            href={fullUrl}
            download="full_recording.wav"
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >Download Full Recording</a>
        </div>
      )}
    </div>
  );
};

export default AudioRecorder;
